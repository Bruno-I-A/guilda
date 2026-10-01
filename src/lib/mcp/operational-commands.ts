import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { accountingPeriodTitle } from "@/domain/accounting-period";
import { isAdminRole } from "@/domain/guild-permissions";
import { CLOSING_YEAR_XP } from "@/domain/xp";
import { abandonChallenge, rollChallenge } from "@/lib/closings/challenge-commands";
import { reconcileClosingYearLedger } from "@/lib/closings/closing-year-xp";
import type { ClosingGroup } from "@/lib/closings-ui";
import {
  createClosingObservation,
  createClosingPeriod,
  deleteClosingPeriod,
  updateClosingPeriod,
} from "@/lib/closings/period-writes";
import { cancelInformative, confirmInformative, type InformativeTaskDecision } from "@/lib/informatives/confirm";
import { saveInformativeDraft } from "@/lib/informatives/draft";
import { informativeTasksRevision } from "@/lib/informatives/revision";
import {
  buildStructuredInformativePayload,
  STRUCTURED_INFORMATIVE_MODEL,
  structuredInformativeSourceText,
  type StructuredInformativeCompany,
} from "@/lib/informatives/structured";
import { publishGuildNotice } from "@/lib/mural/notices";

import type { McpActor } from "./access";

export type OperationalCommandResult =
  | ({ ok: true; resource_id: string; updated_at?: string } & Record<string, unknown>)
  | { ok: false; error: string };

type MutationOutcome = {
  result: OperationalCommandResult;
  resourceId?: string;
  summary: string;
};

async function storedResult(
  tx: OrgTx,
  actor: McpActor,
  idempotencyKey: string,
): Promise<OperationalCommandResult | null> {
  const [receipt] = await tx
    .select({ result: schema.mcpCommandReceipts.result })
    .from(schema.mcpCommandReceipts)
    .where(and(
      eq(schema.mcpCommandReceipts.orgId, actor.orgId),
      eq(schema.mcpCommandReceipts.agentKeyId, actor.agentKeyId),
      eq(schema.mcpCommandReceipts.idempotencyKey, idempotencyKey),
    ));
  return (receipt?.result as OperationalCommandResult | undefined) ?? null;
}

async function runTransactionalCommand(
  actor: McpActor,
  input: {
    tool: string;
    idempotencyKey: string;
    resourceType: string;
    mutate: (tx: OrgTx) => Promise<MutationOutcome>;
  },
): Promise<OperationalCommandResult> {
  if (!isAdminRole(actor.role)) {
    return { ok: false, error: "Esta operação exige o papel admin ou owner." };
  }
  return withOrgTx(actor.orgId, async (tx) => {
    const [reserved] = await tx
      .insert(schema.mcpCommandReceipts)
      .values({
        orgId: actor.orgId,
        agentKeyId: actor.agentKeyId,
        idempotencyKey: input.idempotencyKey,
        tool: input.tool,
        result: { ok: false, error: "Comando em processamento." },
      })
      .onConflictDoNothing({
        target: [schema.mcpCommandReceipts.agentKeyId, schema.mcpCommandReceipts.idempotencyKey],
      })
      .returning({ id: schema.mcpCommandReceipts.id });
    if (!reserved) {
      return (await storedResult(tx, actor, input.idempotencyKey)) ?? {
        ok: false,
        error: "Não foi possível recuperar o resultado do comando.",
      };
    }

    const outcome = await input.mutate(tx);
    await tx.insert(schema.mcpAuditEvents).values({
      orgId: actor.orgId,
      agentKeyId: actor.agentKeyId,
      actingUserId: actor.userId,
      tool: input.tool,
      resourceType: input.resourceType,
      resourceId: outcome.resourceId,
      success: outcome.result.ok,
      summary: `${outcome.summary}; idempotency=${input.idempotencyKey}`,
    });
    await tx
      .update(schema.mcpCommandReceipts)
      .set({ result: outcome.result })
      .where(eq(schema.mcpCommandReceipts.id, reserved.id));
    return outcome.result;
  });
}

async function existingExternalResult(actor: McpActor, idempotencyKey: string) {
  return withOrgTx(actor.orgId, (tx) => storedResult(tx, actor, idempotencyKey));
}

async function saveExternalResult(
  actor: McpActor,
  input: {
    tool: string;
    idempotencyKey: string;
    resourceType: string;
    resourceId?: string;
    result: OperationalCommandResult;
    summary: string;
  },
) {
  return withOrgTx(actor.orgId, async (tx) => {
    await tx.insert(schema.mcpAuditEvents).values({
      orgId: actor.orgId,
      agentKeyId: actor.agentKeyId,
      actingUserId: actor.userId,
      tool: input.tool,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      success: input.result.ok,
      summary: `${input.summary}; idempotency=${input.idempotencyKey}`,
    });
    await tx.insert(schema.mcpCommandReceipts).values({
      orgId: actor.orgId,
      agentKeyId: actor.agentKeyId,
      idempotencyKey: input.idempotencyKey,
      tool: input.tool,
      result: input.result,
    }).onConflictDoNothing({
      target: [schema.mcpCommandReceipts.agentKeyId, schema.mcpCommandReceipts.idempotencyKey],
    });
    return (await storedResult(tx, actor, input.idempotencyKey)) ?? input.result;
  });
}

function changedSince(updatedAt: Date, expectedUpdatedAt?: string): boolean {
  return Boolean(
    expectedUpdatedAt &&
    updatedAt.toISOString() !== new Date(expectedUpdatedAt).toISOString(),
  );
}

async function activeClient(tx: OrgTx, actor: McpActor, clientId: string) {
  return tx.query.clients.findFirst({
    where: and(
      eq(schema.clients.orgId, actor.orgId),
      eq(schema.clients.id, clientId),
      eq(schema.clients.active, true),
    ),
  });
}

export async function createClosingCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  clientId: string;
  year: number;
  periodMonth: number;
  notes?: string;
  cashBalance?: string | null;
  periodResult?: string | null;
  shareholderLoan?: string | null;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "criar_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing",
    mutate: async (tx) => {
      const client = await activeClient(tx, input.actor, input.clientId);
      if (!client) return { result: { ok: false, error: "Empresa não encontrada." }, summary: "Empresa inválida" };
      const now = new Date();
      const created = await createClosingPeriod(tx, {
        orgId: input.actor.orgId,
        clientId: client.id,
        title: accountingPeriodTitle(input.year, input.periodMonth),
        periodMonth: input.periodMonth,
        dueDate: `${input.year}-12-31`,
        status: "completed",
        notes: input.notes || null,
        cashBalance: input.cashBalance ?? null,
        periodResult: input.periodResult ?? null,
        shareholderLoan: input.shareholderLoan ?? null,
        createdBy: input.actor.userId,
        completedBy: input.actor.userId,
        completedAt: now,
        updatedAt: now,
      });
      return {
        result: { ok: true, resource_id: created.id, status: "completed", updated_at: created.updatedAt.toISOString() },
        resourceId: created.id,
        summary: `Fechamento ${input.year}-${String(input.periodMonth).padStart(2, "0")} criado`,
      };
    },
  });
}

export async function updateClosingCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  closingId: string;
  expectedUpdatedAt: string;
  year: number;
  periodMonth: number;
  notes?: string;
  cashBalance?: string | null;
  periodResult?: string | null;
  shareholderLoan?: string | null;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "editar_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing",
    mutate: async (tx) => {
      const [closing] = await tx.select().from(schema.accountingClosings).where(and(
        eq(schema.accountingClosings.orgId, input.actor.orgId),
        eq(schema.accountingClosings.id, input.closingId),
      )).for("update");
      if (!closing) return { result: { ok: false, error: "Fechamento não encontrado." }, summary: "Fechamento ausente" };
      if (changedSince(closing.updatedAt, input.expectedUpdatedAt)) {
        return { result: { ok: false, error: "O fechamento mudou desde a leitura. Consulte-o novamente." }, resourceId: closing.id, summary: "Conflito de versão" };
      }
      const now = new Date();
      await updateClosingPeriod(tx, {
        orgId: input.actor.orgId,
        closingId: closing.id,
        set: {
          title: accountingPeriodTitle(input.year, input.periodMonth),
          periodMonth: input.periodMonth,
          dueDate: `${input.year}-12-31`,
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          ...(input.cashBalance !== undefined ? { cashBalance: input.cashBalance } : {}),
          ...(input.periodResult !== undefined ? { periodResult: input.periodResult } : {}),
          ...(input.shareholderLoan !== undefined ? { shareholderLoan: input.shareholderLoan } : {}),
          updatedAt: now,
        },
      });
      return { result: { ok: true, resource_id: closing.id, updated_at: now.toISOString() }, resourceId: closing.id, summary: "Fechamento editado" };
    },
  });
}

export async function setClosingStatusCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  closingId: string;
  status: "pending" | "blocked" | "completed";
  expectedUpdatedAt?: string;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "alterar_status_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing",
    mutate: async (tx) => {
      const [closing] = await tx.select().from(schema.accountingClosings).where(and(
        eq(schema.accountingClosings.orgId, input.actor.orgId),
        eq(schema.accountingClosings.id, input.closingId),
      )).for("update");
      if (!closing) return { result: { ok: false, error: "Fechamento não encontrado." }, summary: "Fechamento ausente" };
      if (changedSince(closing.updatedAt, input.expectedUpdatedAt)) {
        return { result: { ok: false, error: "O fechamento mudou desde a leitura. Consulte-o novamente." }, resourceId: closing.id, summary: "Conflito de versão" };
      }
      const now = new Date();
      const completed = input.status === "completed";
      await updateClosingPeriod(tx, {
        orgId: input.actor.orgId,
        closingId: closing.id,
        set: {
          status: input.status,
          completedBy: completed ? input.actor.userId : null,
          completedAt: completed ? now : null,
          completedByTaskId: null,
          updatedAt: now,
        },
      });
      return { result: { ok: true, resource_id: closing.id, status: input.status, updated_at: now.toISOString() }, resourceId: closing.id, summary: `Status alterado para ${input.status}` };
    },
  });
}

export async function deleteClosingCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  closingId: string;
  expectedUpdatedAt: string;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "excluir_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing",
    mutate: async (tx) => {
      const [closing] = await tx.select().from(schema.accountingClosings).where(and(
        eq(schema.accountingClosings.orgId, input.actor.orgId),
        eq(schema.accountingClosings.id, input.closingId),
      )).for("update");
      if (!closing) return { result: { ok: false, error: "Fechamento não encontrado." }, summary: "Fechamento ausente" };
      if (changedSince(closing.updatedAt, input.expectedUpdatedAt)) {
        return { result: { ok: false, error: "O fechamento mudou desde a leitura. Consulte-o novamente." }, resourceId: closing.id, summary: "Conflito de versão" };
      }
      await deleteClosingPeriod(tx, { orgId: input.actor.orgId, closingId: closing.id });
      return { result: { ok: true, resource_id: closing.id, deleted: true }, resourceId: closing.id, summary: "Fechamento excluído" };
    },
  });
}

export async function setClosingYearCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  clientId: string;
  year: number;
  closed: boolean;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "alterar_ano_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing_year",
    mutate: async (tx) => {
      const client = await activeClient(tx, input.actor, input.clientId);
      if (!client) return { result: { ok: false, error: "Empresa não encontrada." }, summary: "Empresa inválida" };
      const [existing] = await tx.select().from(schema.accountingClosingYears).where(and(
        eq(schema.accountingClosingYears.orgId, input.actor.orgId),
        eq(schema.accountingClosingYears.clientId, client.id),
        eq(schema.accountingClosingYears.year, input.year),
      )).for("update");
      const now = new Date();
      const annual = existing
        ? (await tx.update(schema.accountingClosingYears).set({
            closedAt: input.closed ? now : null,
            closedBy: input.closed ? input.actor.userId : null,
            closedByTaskId: null,
            ...(input.closed ? {} : { defisCompletedAt: null, defisCompletedBy: null }),
            updatedAt: now,
          }).where(and(
            eq(schema.accountingClosingYears.orgId, input.actor.orgId),
            eq(schema.accountingClosingYears.id, existing.id),
          )).returning())[0]
        : (await tx.insert(schema.accountingClosingYears).values({
            orgId: input.actor.orgId,
            clientId: client.id,
            year: input.year,
            closedAt: input.closed ? now : null,
            closedBy: input.closed ? input.actor.userId : null,
            updatedAt: now,
          }).returning())[0];
      const entries = await reconcileClosingYearLedger(tx, {
        orgId: input.actor.orgId,
        closingYearId: annual.id,
        closedBy: input.closed ? input.actor.userId : null,
      });
      const xpAwarded = entries.some((entry) => entry.userId === input.actor.userId && entry.amount > 0);
      return {
        result: { ok: true, resource_id: annual.id, closed: input.closed, xp_awarded: xpAwarded, xp: CLOSING_YEAR_XP, updated_at: now.toISOString() },
        resourceId: annual.id,
        summary: input.closed ? "Ano encerrado" : "Ano reaberto",
      };
    },
  });
}

export async function setDefisCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  clientId: string;
  year: number;
  completed: boolean;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "alterar_defis",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing_year",
    mutate: async (tx) => {
      const client = await activeClient(tx, input.actor, input.clientId);
      if (!client) return { result: { ok: false, error: "Empresa não encontrada." }, summary: "Empresa inválida" };
      if (client.taxRegime !== "simples") return { result: { ok: false, error: "A DEFIS é exclusiva do Simples Nacional." }, summary: "Regime incompatível" };
      const [annual] = await tx.select().from(schema.accountingClosingYears).where(and(
        eq(schema.accountingClosingYears.orgId, input.actor.orgId),
        eq(schema.accountingClosingYears.clientId, client.id),
        eq(schema.accountingClosingYears.year, input.year),
      )).for("update");
      if (!annual?.closedAt) return { result: { ok: false, error: "Feche o ano antes de registrar a DEFIS." }, summary: "Ano ainda aberto" };
      const now = new Date();
      await tx.update(schema.accountingClosingYears).set({
        defisCompletedAt: input.completed ? now : null,
        defisCompletedBy: input.completed ? input.actor.userId : null,
        updatedAt: now,
      }).where(and(eq(schema.accountingClosingYears.orgId, input.actor.orgId), eq(schema.accountingClosingYears.id, annual.id)));
      return { result: { ok: true, resource_id: annual.id, completed: input.completed, updated_at: now.toISOString() }, resourceId: annual.id, summary: input.completed ? "DEFIS concluída" : "DEFIS reaberta" };
    },
  });
}

export async function addClosingObservationCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  clientId: string;
  year: number;
  scope: "year" | "defis" | "closing";
  closingId?: string;
  body: string;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "adicionar_observacao_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing_observation",
    mutate: async (tx) => {
      const client = await activeClient(tx, input.actor, input.clientId);
      if (!client) return { result: { ok: false, error: "Empresa não encontrada." }, summary: "Empresa inválida" };
      if (input.scope === "closing") {
        const closing = input.closingId
          ? await tx.query.accountingClosings.findFirst({ where: and(
              eq(schema.accountingClosings.orgId, input.actor.orgId),
              eq(schema.accountingClosings.id, input.closingId),
              eq(schema.accountingClosings.clientId, input.clientId),
            ) })
          : null;
        if (!closing) return { result: { ok: false, error: "Fechamento não encontrado para a observação." }, summary: "Fechamento inválido" };
      }
      const created = await createClosingObservation(tx, {
        orgId: input.actor.orgId,
        clientId: input.clientId,
        year: input.year,
        scope: input.scope,
        closingId: input.scope === "closing" ? input.closingId : null,
        body: input.body,
        authorId: input.actor.userId,
      });
      return { result: { ok: true, resource_id: created.id, updated_at: created.updatedAt.toISOString() }, resourceId: created.id, summary: `Observação ${input.scope} criada` };
    },
  });
}

export async function resolveClosingObservationCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  observationId: string;
  resolved: boolean;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "resolver_observacao_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing_observation",
    mutate: async (tx) => {
      const [observation] = await tx.select().from(schema.closingObservations).where(and(
        eq(schema.closingObservations.orgId, input.actor.orgId),
        eq(schema.closingObservations.id, input.observationId),
      )).for("update");
      if (!observation) return { result: { ok: false, error: "Observação não encontrada." }, summary: "Observação ausente" };
      const now = new Date();
      await tx.update(schema.closingObservations).set({
        resolvedAt: input.resolved ? now : null,
        resolvedBy: input.resolved ? input.actor.userId : null,
        updatedAt: now,
      }).where(and(eq(schema.closingObservations.orgId, input.actor.orgId), eq(schema.closingObservations.id, observation.id)));
      return { result: { ok: true, resource_id: observation.id, resolved: input.resolved, updated_at: now.toISOString() }, resourceId: observation.id, summary: input.resolved ? "Observação resolvida" : "Observação reaberta" };
    },
  });
}

/**
 * Desafio do dado pelo MCP: mesma regra da aba (`challenge-commands`), com o
 * recibo de idempotência do MCP — repetir a chamada com a mesma chave devolve
 * o mesmo sorteio em vez de rolar de novo.
 */
export async function rollChallengeCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  year: number;
  group: ClosingGroup;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "rolar_dado_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing_challenge",
    mutate: async (tx) => {
      const rolled = await rollChallenge(tx, {
        orgId: input.actor.orgId,
        userId: input.actor.userId,
        year: input.year,
        group: input.group,
      });
      if (!rolled.ok) {
        return { result: { ok: false, error: rolled.error }, summary: "Sorteio sem empresa livre" };
      }
      const challenge = rolled.challenge;
      return {
        result: {
          ok: true,
          resource_id: challenge.id,
          reused: rolled.reused,
          client: { id: challenge.clientId, name: challenge.clientName },
          year: challenge.year,
          started_at: challenge.startedAt.toISOString(),
          deadline_at: challenge.deadlineAt.toISOString(),
          time_limit_minutes: challenge.timeLimitMinutes,
          base_xp: challenge.baseXp,
          bonus_xp: challenge.bonusXp,
        },
        resourceId: challenge.id,
        summary: rolled.reused
          ? "Desafio em andamento devolvido"
          : `Dado rolado: ${challenge.clientName}`,
      };
    },
  });
}

export async function abandonChallengeCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  challengeId: string;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "desistir_desafio_fechamento",
    idempotencyKey: input.idempotencyKey,
    resourceType: "closing_challenge",
    mutate: async (tx) => {
      const ended = await abandonChallenge(tx, {
        orgId: input.actor.orgId,
        challengeId: input.challengeId,
        userId: input.actor.userId,
      });
      if (!ended) {
        return {
          result: { ok: false, error: "Este desafio não está mais em andamento." },
          resourceId: input.challengeId,
          summary: "Desafio já encerrado",
        };
      }
      return {
        result: { ok: true, resource_id: input.challengeId, status: "abandoned" },
        resourceId: input.challengeId,
        summary: "Desistência do desafio",
      };
    },
  });
}

export async function createInformativeCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  title: string;
  body: string;
  clientId?: string | null;
  missions: Array<{ clanId: string; description: string }>;
}) {
  if (!isAdminRole(input.actor.role)) return { ok: false, error: "Esta operação exige o papel admin ou owner." } as const;
  const existing = await existingExternalResult(input.actor, input.idempotencyKey);
  if (existing) return existing;
  const prepared = await withOrgTx(input.actor.orgId, async (tx) => {
    const clans = await tx.select({ id: schema.clans.id, name: schema.clans.name }).from(schema.clans).where(and(
      eq(schema.clans.orgId, input.actor.orgId),
      eq(schema.clans.active, true),
    ));
    const clanIds = new Set(clans.map((clan) => clan.id));
    if (input.missions.some((mission) => !clanIds.has(mission.clanId))) return { ok: false as const, error: "Um dos clãs não existe ou está inativo." };
    let company: StructuredInformativeCompany | undefined;
    if (input.clientId) {
      const client = await activeClient(tx, input.actor, input.clientId);
      if (!client) return { ok: false as const, error: "Empresa ativa não encontrada." };
      company = {
        legalName: client.name,
        normalizedCnpj: client.cnpj,
        taxRegime: client.taxRegime,
        clientId: client.id,
        createClient: false,
        cnaeCode: client.cnaeCode,
        cnaeDescription: client.cnaeDescription,
        secondaryCnaes: client.secondaryCnaes,
        openedAt: client.openedAt,
      };
    }
    const fullTitle = company ? `${company.legalName.slice(0, 90)} — ${input.title}`.slice(0, 160) : input.title;
    const payload = buildStructuredInformativePayload({
      clans,
      missions: input.missions,
      company,
      kind: "general_task",
      summary: fullTitle,
      freeNotice: { title: fullTitle, body: input.body },
    });
    return {
      ok: true as const,
      payload,
      sourceText: [fullTitle, input.body, structuredInformativeSourceText(input.missions, clans)].join("\n\n"),
    };
  });
  if (!prepared.ok) return prepared;
  const saved = await saveInformativeDraft({
    actor: input.actor,
    payload: prepared.payload,
    model: STRUCTURED_INFORMATIVE_MODEL,
    sourceText: prepared.sourceText,
    source: "panel",
    connectionId: null,
  });
  const result: OperationalCommandResult = {
    ok: true,
    resource_id: saved.id,
    status: "pending",
    revision: informativeTasksRevision(prepared.payload.tasks),
  };
  return saveExternalResult(input.actor, {
    tool: "criar_informativo",
    idempotencyKey: input.idempotencyKey,
    resourceType: "informative",
    resourceId: saved.id,
    result,
    summary: `Prévia criada com ${prepared.payload.tasks.length} missão(ões)`,
  });
}

export async function decideInformativeCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  informativeId: string;
  action: "confirm" | "cancel";
  expectedRevision?: string;
  decisions?: InformativeTaskDecision[];
}) {
  if (!isAdminRole(input.actor.role)) return { ok: false, error: "Esta operação exige o papel admin ou owner." } as const;
  const existing = await existingExternalResult(input.actor, input.idempotencyKey);
  if (existing) return existing;
  const decided = input.action === "confirm"
    ? await confirmInformative(input.actor, input.informativeId, {
        expectedRevision: input.expectedRevision,
        decisions: input.decisions,
      })
    : await cancelInformative(input.actor, input.informativeId);
  const result: OperationalCommandResult = decided.ok
    ? { ok: true, resource_id: input.informativeId, status: input.action === "confirm" ? "confirmed" : "cancelled", task_ids: decided.taskIds }
    : { ok: false, error: decided.message };
  return saveExternalResult(input.actor, {
    tool: input.action === "confirm" ? "confirmar_informativo" : "cancelar_informativo",
    idempotencyKey: input.idempotencyKey,
    resourceType: "informative",
    resourceId: input.informativeId,
    result,
    summary: decided.message,
  });
}

export async function publishNoticeCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  title: string;
  body: string;
  requiresAck: boolean;
  pinned: boolean;
}) {
  return runTransactionalCommand(input.actor, {
    tool: "publicar_no_mural",
    idempotencyKey: input.idempotencyKey,
    resourceType: "notice",
    mutate: async (tx) => {
      const created = await publishGuildNotice(tx, {
        orgId: input.actor.orgId,
        authorId: input.actor.userId,
        kind: "notice",
        title: input.title,
        body: input.body,
        requiresAck: input.requiresAck,
        pinned: input.pinned,
      });
      if (!created) return { result: { ok: false, error: "Não foi possível publicar o aviso." }, summary: "Falha ao publicar" };
      return { result: { ok: true, resource_id: created.id, status: "published" }, resourceId: created.id, summary: "Aviso publicado" };
    },
  });
}

export async function acknowledgeNoticeCommand(input: { actor: McpActor; idempotencyKey: string; noticeId: string }) {
  return runTransactionalCommand(input.actor, {
    tool: "confirmar_leitura_mural",
    idempotencyKey: input.idempotencyKey,
    resourceType: "notice",
    mutate: async (tx) => {
      const notice = await tx.query.guildNotices.findFirst({ where: and(eq(schema.guildNotices.orgId, input.actor.orgId), eq(schema.guildNotices.id, input.noticeId)) });
      if (!notice) return { result: { ok: false, error: "Aviso não encontrado." }, summary: "Aviso ausente" };
      await tx.insert(schema.guildNoticeReads).values({ orgId: input.actor.orgId, noticeId: notice.id, userId: input.actor.userId }).onConflictDoNothing();
      return { result: { ok: true, resource_id: notice.id, acknowledged: true }, resourceId: notice.id, summary: "Leitura confirmada" };
    },
  });
}

export async function setNoticeWorkCommand(input: { actor: McpActor; idempotencyKey: string; noticeId: string; resolved: boolean }) {
  return runTransactionalCommand(input.actor, {
    tool: input.resolved ? "concluir_trabalho_mural" : "reabrir_trabalho_mural",
    idempotencyKey: input.idempotencyKey,
    resourceType: "notice",
    mutate: async (tx) => {
      const [notice] = await tx.select().from(schema.guildNotices).where(and(eq(schema.guildNotices.orgId, input.actor.orgId), eq(schema.guildNotices.id, input.noticeId))).for("update");
      if (!notice?.informativeId || notice.archivedAt) return { result: { ok: false, error: "Informativo não encontrado no Mural." }, summary: "Aviso indisponível" };
      if (input.resolved) {
        const mine = await tx.select({ status: schema.tasks.status }).from(schema.tasks).where(and(
          eq(schema.tasks.orgId, input.actor.orgId),
          eq(schema.tasks.informativeId, notice.informativeId),
          eq(schema.tasks.assigneeId, input.actor.userId),
        )).for("update");
        if (mine.length === 0) return { result: { ok: false, error: "Este Informativo não tem missões atribuídas a você." }, resourceId: notice.id, summary: "Sem missões próprias" };
        if (mine.some((task) => !["completed", "cancelled"].includes(task.status))) return { result: { ok: false, error: "Encerre todas as suas missões antes de confirmar sua parte." }, resourceId: notice.id, summary: "Missões ainda abertas" };
        await tx.insert(schema.guildNoticeWork).values({ orgId: input.actor.orgId, noticeId: notice.id, userId: input.actor.userId, resolvedAt: sql`clock_timestamp()` }).onConflictDoUpdate({
          target: [schema.guildNoticeWork.orgId, schema.guildNoticeWork.noticeId, schema.guildNoticeWork.userId],
          set: { resolvedAt: sql`clock_timestamp()` },
        });
      } else {
        await tx.delete(schema.guildNoticeWork).where(and(
          eq(schema.guildNoticeWork.orgId, input.actor.orgId),
          eq(schema.guildNoticeWork.noticeId, notice.id),
          eq(schema.guildNoticeWork.userId, input.actor.userId),
        ));
      }
      return { result: { ok: true, resource_id: notice.id, resolved: input.resolved }, resourceId: notice.id, summary: input.resolved ? "Trabalho confirmado" : "Trabalho reaberto" };
    },
  });
}

export async function setNoticeArchivedCommand(input: { actor: McpActor; idempotencyKey: string; noticeId: string; archived: boolean; expectedUpdatedAt?: string }) {
  return runTransactionalCommand(input.actor, {
    tool: input.archived ? "arquivar_aviso_mural" : "desarquivar_aviso_mural",
    idempotencyKey: input.idempotencyKey,
    resourceType: "notice",
    mutate: async (tx) => {
      const [notice] = await tx.select().from(schema.guildNotices).where(and(eq(schema.guildNotices.orgId, input.actor.orgId), eq(schema.guildNotices.id, input.noticeId))).for("update");
      if (!notice) return { result: { ok: false, error: "Aviso não encontrado." }, summary: "Aviso ausente" };
      if (changedSince(notice.updatedAt, input.expectedUpdatedAt)) return { result: { ok: false, error: "O aviso mudou desde a leitura. Consulte-o novamente." }, resourceId: notice.id, summary: "Conflito de versão" };
      const now = new Date();
      await tx.update(schema.guildNotices).set({ archivedAt: input.archived ? now : null, updatedAt: now }).where(and(eq(schema.guildNotices.orgId, input.actor.orgId), eq(schema.guildNotices.id, notice.id)));
      return { result: { ok: true, resource_id: notice.id, archived: input.archived, updated_at: now.toISOString() }, resourceId: notice.id, summary: input.archived ? "Aviso arquivado" : "Aviso desarquivado" };
    },
  });
}
