import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { resolveAssigneeClan } from "@/domain/clans";
import {
  informativeDraftPayloadSchema,
  type InformativeDraftPayload,
  type InformativeDraftTask,
} from "@/lib/ai/informative-schema";
import {
  companyFlowNoticeBody,
  newClientNoticeBody,
  publishGuildNotice,
} from "@/lib/mural/notices";
import {
  firstOpenPeriod,
  periodsForCadenceRange,
  periodsPerYear,
} from "@/domain/commitments";
import { createTaskRecord } from "@/lib/tasks/create";
import {
  amendmentClientRegistrationUpdate,
  amendmentRequiresExternalRegistrationTask,
  accountantChangeNoticeTitle,
  companyFlowAmendmentNoticeBody,
  companyFlowInformativeNoticeTitle,
  isAccountantChangeInformative,
} from "@/domain/company-flow";
import { deactivateClosureClientWhenTasksFinish } from "./closure-completion";

import type { InformativeActor } from "./draft";

/**
 * Confirmação transacional de um informativo — a única porta que cria
 * missões. Compartilhada pelo bot do Telegram e pelo painel: o que muda é
 * apenas de onde vem a decisão sobre as missões pendentes.
 */

export type InformativeResult =
  | { ok: true; message: string; taskIds: string[] }
  | { ok: false; message: string };

/** Destino escolhido por um humano para uma missão pendente da prévia. */
export interface InformativeTaskDecision {
  index: number;
  clanId?: string | null;
  assigneeId?: string | null;
}

const TAX_REGIME_LABELS: Record<string, string> = {
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  association: "Associação",
  real: "Lucro Real",
};

function isAutomaticExternalRegistrationTask(task: {
  title: string;
  sourceSection: string;
}): boolean {
  const text = `${task.title} ${task.sourceSection}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  return (
    text.includes("atualizar alvara") &&
    text.includes("inscricao estadual") &&
    text.includes("cadastros externos")
  );
}

function dueDateOf(value: string | null): Date | null {
  return value ? new Date(`${value}T12:00:00Z`) : null;
}

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Campos comuns às três variantes — descarta o `reason` da pendente. */
function draftCore(task: InformativeDraftTask) {
  return {
    category: task.category,
    title: task.title,
    description: task.description,
    priority: task.priority,
    difficulty: task.difficulty,
    dueDate: task.dueDate,
    closingYear: task.closingYear,
    sourceSection: task.sourceSection,
    sector: task.sector,
    suggestions: task.suggestions,
  };
}

function closingPeriodTitle(value: string): string {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

async function ensureClosingYear(
  tx: OrgTx,
  input: { orgId: string; clientId: string; year: number },
): Promise<string> {
  const existing = await tx.query.accountingClosingYears.findFirst({
    where: and(
      eq(schema.accountingClosingYears.orgId, input.orgId),
      eq(schema.accountingClosingYears.clientId, input.clientId),
      eq(schema.accountingClosingYears.year, input.year),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [created] = await tx
    .insert(schema.accountingClosingYears)
    .values({
      orgId: input.orgId,
      clientId: input.clientId,
      year: input.year,
    })
    .onConflictDoNothing()
    .returning({ id: schema.accountingClosingYears.id });
  if (created) return created.id;

  const raced = await tx.query.accountingClosingYears.findFirst({
    where: and(
      eq(schema.accountingClosingYears.orgId, input.orgId),
      eq(schema.accountingClosingYears.clientId, input.clientId),
      eq(schema.accountingClosingYears.year, input.year),
    ),
    columns: { id: true },
  });
  if (!raced) throw new Error("Não foi possível preparar a campanha de fechamentos.");
  return raced.id;
}

/**
 * Aplica as decisões humanas às missões pendentes. Nada aqui confia na
 * interface: o clã precisa estar ativo na org da sessão e a pessoa precisa
 * ter vínculo ativo com um clã — a resolução é a mesma da transferência.
 */
async function applyPendingDecisions(
  tx: OrgTx,
  orgId: string,
  tasks: InformativeDraftTask[],
  decisions: readonly InformativeTaskDecision[],
): Promise<{ ok: true; tasks: InformativeDraftTask[] } | { ok: false; message: string }> {
  if (decisions.length === 0) return { ok: true, tasks };
  const resolved = [...tasks];

  for (const decision of decisions) {
    const task = resolved[decision.index];
    if (!task) return { ok: false, message: "Missão inexistente na prévia." };
    if (task.assignmentType !== "pending") {
      return { ok: false, message: "Só missões pendentes aceitam um novo destino." };
    }

    if (decision.assigneeId) {
      const memberships = await tx
        .select({
          clanId: schema.clanMemberships.clanId,
          clanName: schema.clans.name,
          isPrimary: schema.clanMemberships.isPrimary,
        })
        .from(schema.clanMemberships)
        .innerJoin(
          schema.clans,
          and(
            eq(schema.clans.id, schema.clanMemberships.clanId),
            eq(schema.clans.orgId, schema.clanMemberships.orgId),
          ),
        )
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.userId, schema.clanMemberships.userId),
            eq(schema.member.organizationId, schema.clanMemberships.orgId),
          ),
        )
        .where(
          and(
            eq(schema.clanMemberships.orgId, orgId),
            eq(schema.clanMemberships.userId, decision.assigneeId),
            eq(schema.clans.orgId, orgId),
            eq(schema.clans.active, true),
            eq(schema.member.organizationId, orgId),
          ),
        );
      const clanChoice = resolveAssigneeClan(memberships, decision.clanId ?? undefined);
      if (!clanChoice.ok) return { ok: false, message: clanChoice.reason };
      const clan = memberships.find(
        (membership) => membership.clanId === clanChoice.clanId,
      );
      if (!clan) return { ok: false, message: "Clã de destino não localizado." };
      const [person] = await tx
        .select({ name: schema.user.name })
        .from(schema.user)
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.userId, schema.user.id),
            eq(schema.member.organizationId, orgId),
          ),
        )
        .where(eq(schema.user.id, decision.assigneeId))
        .limit(1);
      if (!person) return { ok: false, message: "A pessoa não pertence a esta organização." };

      resolved[decision.index] = {
        ...draftCore(task),
        assignmentType: "individual",
        assigneeId: decision.assigneeId,
        assigneeName: person.name,
        clanId: clan.clanId,
        clanName: clan.clanName,
      };
      continue;
    }

    if (decision.clanId) {
      const [clan] = await tx
        .select({ id: schema.clans.id, name: schema.clans.name })
        .from(schema.clans)
        .where(
          and(
            eq(schema.clans.orgId, orgId),
            eq(schema.clans.id, decision.clanId),
            eq(schema.clans.active, true),
          ),
        )
        .limit(1);
      if (!clan) return { ok: false, message: "Clã ativo não encontrado." };
      resolved[decision.index] = {
        ...draftCore(task),
        assignmentType: "clan",
        assigneeId: null,
        assigneeName: null,
        clanId: clan.id,
        clanName: clan.name,
      };
      continue;
    }

    return { ok: false, message: "Escolha um clã ou uma pessoa para a missão pendente." };
  }

  return { ok: true, tasks: resolved };
}

/**
 * Cancela a prévia sem criar nada. Idempotente: cancelar duas vezes devolve
 * a mesma resposta.
 */
export async function cancelInformative(
  actor: InformativeActor,
  informativeId: string,
  options: { connectionId?: string | null } = {},
): Promise<InformativeResult> {
  return withOrgTx(actor.orgId, async (tx): Promise<InformativeResult> => {
    const informative = await lockInformative(tx, actor, informativeId, options);
    if (!informative.ok) return informative;
    const row = informative.row;
    if (row.status === "confirmed") {
      return { ok: false, message: "Este informativo já criou missões." };
    }
    if (row.status === "cancelled") {
      return { ok: true, message: "Prévia cancelada. Nenhuma missão foi criada.", taskIds: [] };
    }
    await tx
      .update(schema.informatives)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(eq(schema.informatives.id, row.id));
    const [flow] = await tx
      .select({ id: schema.companyFlows.id, status: schema.companyFlows.status })
      .from(schema.companyFlows)
      .where(and(eq(schema.companyFlows.orgId, actor.orgId), eq(schema.companyFlows.informativeId, row.id)))
      .for("update");
    if (flow && (flow.status === "informative_drafting" || flow.status === "completed")) {
      await tx
        .update(schema.companyFlows)
        .set({ status: "awaiting_owner", informativeId: null, completedAt: null, updatedAt: new Date() })
        .where(eq(schema.companyFlows.id, flow.id));
      await tx.insert(schema.companyFlowEvents).values({
        orgId: actor.orgId,
        flowId: flow.id,
        eventType: "informative_cancelled",
        previousValue: { status: flow.status, informativeId: row.id },
        newValue: { status: "awaiting_owner" },
        actorId: actor.userId,
      });
    }
    return { ok: true, message: "Prévia cancelada. Nenhuma missão foi criada.", taskIds: [] };
  });
}

async function lockInformative(
  tx: OrgTx,
  actor: InformativeActor,
  informativeId: string,
  options: { connectionId?: string | null },
): Promise<
  | { ok: true; row: typeof schema.informatives.$inferSelect }
  | { ok: false; message: string }
> {
  const [row] = await tx
    .select()
    .from(schema.informatives)
    .where(
      and(
        eq(schema.informatives.id, informativeId),
        eq(schema.informatives.orgId, actor.orgId),
        eq(schema.informatives.requestedBy, actor.userId),
      ),
    )
    .for("update");
  if (!row) return { ok: false, message: "Informativo não encontrado." };
  // O Telegram exige que a decisão venha da mesma conversa que pediu a prévia.
  if (options.connectionId && row.connectionId !== options.connectionId) {
    return { ok: false, message: "Informativo não encontrado." };
  }
  return { ok: true, row };
}

export async function confirmInformative(
  actor: InformativeActor,
  informativeId: string,
  options: {
    connectionId?: string | null;
    decisions?: readonly InformativeTaskDecision[];
  } = {},
): Promise<InformativeResult> {
  return withOrgTx(actor.orgId, async (tx): Promise<InformativeResult> => {
    const locked = await lockInformative(tx, actor, informativeId, options);
    if (!locked.ok) return locked;
    const informative = locked.row;

    if (informative.status === "confirmed") {
      return {
        ok: true,
        message: "Este informativo já criou missões.",
        taskIds: Array.isArray(informative.createdTaskIds)
          ? (informative.createdTaskIds as string[])
          : [],
      };
    }
    if (informative.status !== "pending") {
      return { ok: false, message: "Esta prévia já foi cancelada." };
    }
    if (informative.expiresAt <= new Date()) {
      return { ok: false, message: "A prévia expirou. Envie o informativo novamente." };
    }

    const parsed = informativeDraftPayloadSchema.safeParse(informative.payload);
    if (!parsed.success) {
      return {
        ok: false,
        message:
          "Esta prévia usa um formato anterior ou está inválida. Envie o informativo novamente para gerar outra.",
      };
    }
    const payload: InformativeDraftPayload = parsed.data;
    if (payload.unresolvedAssignees.length) {
      return {
        ok: false,
        message:
          "Existem responsáveis sem clã ativo. Corrija o cadastro e gere outra prévia.",
      };
    }

    // A ficha do Fluxo permanece a fonte oficial dos dados societários. O
    // bloqueio é adquirido antes de decidir as missões para que uma prévia
    // antiga também respeite as regras atuais da Alteração.
    const [linkedFlow] = await tx
      .select({
        flow: schema.companyFlows,
        existingClientName: schema.clients.name,
        existingClientCnpj: schema.clients.cnpj,
        existingClientTaxRegime: schema.clients.taxRegime,
      })
      .from(schema.companyFlows)
      .leftJoin(
        schema.clients,
        and(
          eq(schema.clients.orgId, schema.companyFlows.orgId),
          eq(schema.clients.id, schema.companyFlows.existingClientId),
        ),
      )
      .where(
        and(
          eq(schema.companyFlows.orgId, actor.orgId),
          eq(schema.companyFlows.informativeId, informative.id),
        ),
      )
      .for("update", { of: schema.companyFlows });

    const decided = await applyPendingDecisions(
      tx,
      actor.orgId,
      [...payload.tasks],
      options.decisions ?? [],
    );
    if (!decided.ok) return decided;
    let tasks = decided.tasks;

    if (
      linkedFlow?.flow.kind === "amendment" &&
      !amendmentRequiresExternalRegistrationTask({
        ...linkedFlow.flow,
        existingClientName: linkedFlow.existingClientName,
      })
    ) {
      // Remove também a missão automática de prévias criadas antes desta
      // regra. Missões adicionais escritas pelo dono permanecem intactas.
      tasks = tasks.filter((task) => !isAutomaticExternalRegistrationTask(task));
    }

    // Zero missões é resultado LEGÍTIMO no cadastro de cliente novo: todas as
    // linhas podem ser combinado (vai para a carteira do Fiscal) ou negação
    // pura ("sem particularidades"). O trabalho da confirmação, aí, é criar a
    // empresa e mandá-la para a fila da carteira — bloquear aqui deixaria o
    // cadastro impossível. Sem empresa nova para criar, aí sim não há nada a
    // fazer.
    if (
      tasks.length === 0 &&
      !payload.company.createClient &&
      payload.kind !== "client_change"
    ) {
      return { ok: false, message: "Nenhuma missão válida nesta prévia." };
    }
    if (tasks.some((task) => task.assignmentType === "pending")) {
      return {
        ok: false,
        message: "Escolha o clã ou a pessoa das missões pendentes antes de criar.",
      };
    }

    const activeMembershipRows = await tx
      .select({
        userId: schema.clanMemberships.userId,
        clanId: schema.clanMemberships.clanId,
      })
      .from(schema.clanMemberships)
      .innerJoin(
        schema.clans,
        and(
          eq(schema.clans.id, schema.clanMemberships.clanId),
          eq(schema.clans.orgId, schema.clanMemberships.orgId),
        ),
      )
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.userId, schema.clanMemberships.userId),
          eq(schema.member.organizationId, schema.clanMemberships.orgId),
        ),
      )
      .where(
        and(
          eq(schema.clanMemberships.orgId, actor.orgId),
          eq(schema.clans.orgId, actor.orgId),
          eq(schema.clans.active, true),
          eq(schema.member.organizationId, actor.orgId),
        ),
      );
    const activeClanRows = await tx
      .select({ clanId: schema.clans.id })
      .from(schema.clans)
      .where(
        and(eq(schema.clans.orgId, actor.orgId), eq(schema.clans.active, true)),
      );
    const activeMembershipKeys = new Set(
      activeMembershipRows.map((row) => `${row.userId}:${row.clanId}`),
    );
    const activeClanIds = new Set(activeClanRows.map((row) => row.clanId));
    if (
      tasks.some(
        (task) =>
          !task.clanId ||
          !activeClanIds.has(task.clanId) ||
          (task.assignmentType === "individual" &&
            !activeMembershipKeys.has(`${task.assigneeId}:${task.clanId}`)),
      )
    ) {
      return {
        ok: false,
        message:
          "Um clã deixou de estar ativo ou um responsável não pertence mais ao clã selecionado. Gere outra prévia.",
      };
    }

    let clientId: string | null = null;
    if (payload.company.clientId) {
      const existing = await tx.query.clients.findFirst({
        where: and(
          eq(schema.clients.id, payload.company.clientId),
          eq(schema.clients.orgId, actor.orgId),
          eq(schema.clients.active, true),
        ),
        columns: { id: true },
      });
      clientId = existing?.id ?? null;
    }
    let createdClient = false;
    if (
      !clientId &&
      payload.company.createClient &&
      payload.company.legalName &&
      payload.company.taxRegime &&
      payload.company.normalizedCnpj
    ) {
      const [client] = await tx
        .insert(schema.clients)
        .values({
          orgId: actor.orgId,
          name: payload.company.legalName,
          cnpj: payload.company.normalizedCnpj,
          taxRegime: payload.company.taxRegime,
          cnaeCode: payload.company.cnaeCode,
          cnaeDescription: payload.company.cnaeDescription,
          secondaryCnaes: payload.company.secondaryCnaes,
          openedAt: payload.company.openedAt,
          pendingFiscalNote: payload.company.pendingFiscalNote,
          suggestedFiscalOwnerId: payload.company.suggestedFiscalOwnerId,
          // Todo cliente que nasce aqui precisa de alguém na carteira fiscal
          // — mesmo sem nota nenhuma (ver comentário no schema).
          pendingFiscalAssignment: true,
        })
        .onConflictDoNothing()
        .returning({ id: schema.clients.id });
      clientId = client?.id ?? null;
      createdClient = Boolean(client);
      if (!clientId && payload.company.normalizedCnpj) {
        const existing = await tx.query.clients.findFirst({
          where: and(
            eq(schema.clients.orgId, actor.orgId),
            eq(schema.clients.cnpj, payload.company.normalizedCnpj),
          ),
          columns: { id: true },
        });
        clientId = existing?.id ?? null;
      }
    }
    if (
      tasks.some(
        (task) =>
          (task.category === "closing_period" && (!clientId || !task.dueDate)) ||
          (task.category === "annual_closing" && (!clientId || !task.closingYear)),
      )
    ) {
      return {
        ok: false,
        message:
          "O fechamento perdeu o vínculo com a empresa, o período ou o ano. Gere outra prévia.",
      };
    }

    const taskIds: string[] = [];
    const periodClosingIds = new Map<string, string>();
    for (const task of tasks) {
      let closingId: string | null = null;
      let closingYearId: string | null = null;
      if (task.category === "closing_period") {
        if (!clientId || !task.dueDate) throw new Error("Período de fechamento inválido.");
        const closingKey = `${clientId}:${task.dueDate}:${task.title}`;
        closingId = periodClosingIds.get(closingKey) ?? null;
        if (!closingId) {
          const [createdClosing] = await tx
            .insert(schema.accountingClosings)
            .values({
              orgId: actor.orgId,
              clientId,
              title: closingPeriodTitle(task.dueDate),
              dueDate: task.dueDate,
              status: "pending",
              notes: task.description,
              createdBy: actor.userId,
            })
            .returning({ id: schema.accountingClosings.id });
          closingId = createdClosing.id;
          periodClosingIds.set(closingKey, closingId);
        }
      } else if (task.category === "annual_closing") {
        if (!clientId || !task.closingYear) throw new Error("Fechamento anual inválido.");
        closingYearId = await ensureClosingYear(tx, {
          orgId: actor.orgId,
          clientId,
          year: task.closingYear,
        });
      }
      const companySuffix = payload.company.legalName
        ? ` — ${payload.company.legalName}`
        : "";
      const created = await createTaskRecord(tx, {
        orgId: actor.orgId,
        creatorId: actor.userId,
        assigneeId: task.assigneeId,
        clanId: task.clanId,
        clientId: clientId ?? null,
        informativeId: informative.id,
        closingId,
        closingYearId,
        title: `${task.title}${companySuffix}`.slice(0, 200),
        description: task.description,
        priority: task.priority,
        difficulty: task.difficulty,
        dueDate: dueDateOf(task.dueDate),
      });
      taskIds.push(created.id);

      // O "Att." do informativo fica registrado como sugestão, inclusive
      // quando o nome não foi reconhecido — é a trilha que o líder lê.
      if (task.suggestions.length > 0) {
        await tx.insert(schema.taskAssigneeSuggestions).values(
          task.suggestions.map((suggestion) => ({
            orgId: actor.orgId,
            taskId: created.id,
            userId: suggestion.userId,
            rawName: suggestion.rawName.slice(0, 200),
          })),
        );
      }
    }

    // Distribuição de lucros: planeja somente do período ainda aberto em
    // diante, na MESMA transação. Assim um onboarding em agosto não cria sete
    // pendências retroativas.
    let createdCommitments = 0;
    if (clientId && payload.commitments.length > 0) {
      const today = todayInSaoPaulo();
      for (const commitment of payload.commitments) {
        const [existing] = await tx
          .select({ id: schema.clientCommitments.id })
          .from(schema.clientCommitments)
          .where(
            and(
              eq(schema.clientCommitments.orgId, actor.orgId),
              eq(schema.clientCommitments.clanId, commitment.clanId),
              eq(schema.clientCommitments.clientId, clientId),
              eq(schema.clientCommitments.active, true),
            ),
          )
          .limit(1);
        if (existing) continue;

        const [created] = await tx
          .insert(schema.clientCommitments)
          .values({
            orgId: actor.orgId,
            clanId: commitment.clanId,
            clientId,
            title: "Distribuição de lucros",
            notes: commitment.notes,
            cadence: commitment.cadence,
            sourceInformativeId: informative.id,
            createdBy: actor.userId,
          })
          .returning({ id: schema.clientCommitments.id });
        const start = firstOpenPeriod(commitment.cadence, today);
        const end = {
          year: start.year,
          index: periodsPerYear(commitment.cadence),
        };
        await tx
          .insert(schema.clientCommitmentPeriods)
          .values(
            periodsForCadenceRange(commitment.cadence, start, end).map((period) => ({
              orgId: actor.orgId,
              commitmentId: created.id,
              periodYear: period.year,
              periodIndex: period.index,
              dueDate: period.dueDate,
            })),
          )
          .onConflictDoNothing();
        createdCommitments += 1;
      }
    }

    // Aviso de empresa nova na MESMA transação, idempotente pelo índice
    // parcial: reconfirmar o informativo não gera um segundo aviso.
    let noticePublished = false;
    const flowLegalName = linkedFlow?.flow.approvedLegalName ?? linkedFlow?.flow.requestedLegalName;
    const directAccountantChange =
      !linkedFlow &&
      payload.kind === "client_closure" &&
      isAccountantChangeInformative(informative.sourceText);
    if (linkedFlow?.flow.kind === "opening" && flowLegalName) {
      const flow = linkedFlow.flow;
      const notice = await publishGuildNotice(tx, {
        orgId: actor.orgId,
        authorId: actor.userId,
        kind: "new_client",
        title: `Nova empresa: ${flowLegalName}`,
        body: companyFlowNoticeBody({
          legalName: flowLegalName,
          cnpj: flow.resultCnpj,
          activities: flow.approvedActivities.length > 0 ? flow.approvedActivities : flow.requestedActivities,
          taxRegime: flow.taxRegime,
          iptu: flow.iptu,
          socialCapital: flow.socialCapital,
          roomSize: flow.roomSize,
          address: flow.address,
          clientResponsible: flow.clientResponsible,
          qsa: flow.qsa,
          contactName: flow.contactName,
          contactPhone: flow.contactPhone,
          contactEmail: flow.contactEmail,
          requestDetails: flow.requestDetails,
          processingNotes: flow.processingNotes,
          taskCount: taskIds.length,
        }),
        clientId,
        informativeId: informative.id,
        requiresAck: true,
      });
      noticePublished = Boolean(notice);
    } else if (payload.kind === "new_client" && clientId && payload.company.legalName) {
      const notice = await publishGuildNotice(tx, {
        orgId: actor.orgId,
        authorId: actor.userId,
        kind: "new_client",
        title: `Nova empresa: ${payload.company.legalName}`,
        body: newClientNoticeBody({
          legalName: payload.company.legalName,
          cnpj: payload.company.normalizedCnpj,
          taxRegime: payload.company.taxRegime
            ? TAX_REGIME_LABELS[payload.company.taxRegime] ?? payload.company.taxRegime
            : null,
          city: payload.company.city,
          contact: payload.company.contact,
          summary: payload.company.summary,
          cnaeDescription: payload.company.cnaeDescription,
          secondaryCnaes: payload.company.secondaryCnaes,
          openedAt: payload.company.openedAt,
          fiscalPortfolioNote: payload.company.pendingFiscalNote,
          observations: payload.observations,
          taskCount: taskIds.length,
        }),
        clientId,
        informativeId: informative.id,
        requiresAck: true,
      });
      noticePublished = Boolean(notice);
    } else if (linkedFlow?.flow.kind === "amendment") {
      const flow = linkedFlow.flow;
      const trackingName = linkedFlow.existingClientName ?? flow.requestedLegalName ?? "Empresa não informada";
      const notice = await publishGuildNotice(tx, {
        orgId: actor.orgId,
        authorId: actor.userId,
        kind: "notice",
        title: companyFlowInformativeNoticeTitle("amendment", trackingName),
        body: companyFlowAmendmentNoticeBody({
          ...flow,
          existingClientName: linkedFlow.existingClientName,
          existingClientCnpj: linkedFlow.existingClientCnpj,
          existingClientTaxRegime: linkedFlow.existingClientTaxRegime,
        }, taskIds.length),
        clientId,
        informativeId: informative.id,
        requiresAck: true,
      });
      noticePublished = Boolean(notice);
    } else if (directAccountantChange) {
      const trackingName = payload.company.legalName ?? "Empresa não informada";
      const notice = await publishGuildNotice(tx, {
        orgId: actor.orgId,
        authorId: actor.userId,
        kind: "notice",
        title: accountantChangeNoticeTitle(trackingName),
        body: [
          "Desligamento de cliente por troca de contabilidade.",
          `${taskIds.length} ${taskIds.length === 1 ? "missão foi gerada" : "missões foram geradas"} para concluir a transição.`,
          payload.observations.length > 0
            ? `Observações:\n${payload.observations.join("\n")}`
            : null,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n\n"),
        clientId,
        informativeId: informative.id,
        requiresAck: true,
      });
      noticePublished = Boolean(notice);
    } else {
      const trackingName =
        flowLegalName ?? payload.company.legalName ?? "Missões geradas";
      const notice = await publishGuildNotice(tx, {
        orgId: actor.orgId,
        authorId: actor.userId,
        kind: "notice",
        title: companyFlowInformativeNoticeTitle(
          linkedFlow?.flow.kind ?? (payload.kind === "client_closure" ? "closure" : null),
          trackingName,
        ),
        body: [
          `${taskIds.length} ${taskIds.length === 1 ? "missão foi gerada" : "missões foram geradas"} por este Informativo.`,
          payload.observations.length > 0
            ? `Observações:\n${payload.observations.join("\n")}`
            : null,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n\n"),
        clientId,
        informativeId: informative.id,
        requiresAck: true,
      });
      noticePublished = Boolean(notice);
    }

    await tx
      .update(schema.informatives)
      .set({
        status: "confirmed",
        decidedAt: new Date(),
        createdTaskIds: taskIds,
      })
      .where(eq(schema.informatives.id, informative.id));

    const flow = linkedFlow?.flow;
    if (taskIds.length === 0) {
      await deactivateClosureClientWhenTasksFinish(tx, {
        orgId: actor.orgId,
        informativeId: informative.id,
      });
    }
    const registrationUpdate = flow
      ? amendmentClientRegistrationUpdate(flow)
      : null;
    let updatedClientRegistration = false;
    let synchronizedFiscalPeriods = 0;
    if (flow?.existingClientId && registrationUpdate) {
      const [updatedClient] = await tx
        .update(schema.clients)
        .set(registrationUpdate)
        .where(
          and(
            eq(schema.clients.orgId, actor.orgId),
            eq(schema.clients.id, flow.existingClientId),
          ),
        )
        .returning({ id: schema.clients.id });
      updatedClientRegistration = Boolean(updatedClient);

      // Fechamentos leem diretamente o cadastro da empresa. No Fiscal, as
      // competências ainda não iniciadas guardam um snapshot: atualizamos só
      // essas linhas para preservar o histórico de meses já trabalhados.
      if (updatedClient && registrationUpdate.taxRegime) {
        const updatedPeriods = await tx
          .update(schema.fiscalControlPeriods)
          .set({
            taxRegimeSnapshot: registrationUpdate.taxRegime,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.fiscalControlPeriods.orgId, actor.orgId),
              eq(schema.fiscalControlPeriods.clientId, updatedClient.id),
              eq(schema.fiscalControlPeriods.status, "not_started"),
              ne(schema.fiscalControlPeriods.taxRegimeSnapshot, registrationUpdate.taxRegime),
            ),
          )
          .returning({ id: schema.fiscalControlPeriods.id });
        if (updatedPeriods.length > 0) {
          await tx.insert(schema.fiscalControlEvents).values(updatedPeriods.map((period) => ({
            orgId: actor.orgId,
            controlPeriodId: period.id,
            clientId: updatedClient.id,
            eventType: "profile_synced" as const,
            newValue: { taxRegime: registrationUpdate.taxRegime },
            note: "Regime tributário atualizado por Alteração Societária confirmada.",
            actorId: actor.userId,
          })));
          synchronizedFiscalPeriods = updatedPeriods.length;
        }
      }
    }
    if (flow && (flow.status === "informative_drafting" || flow.status === "completed")) {
      if (flow.status === "informative_drafting") {
        await tx.update(schema.companyFlows).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.companyFlows.id, flow.id));
      }
      await tx.insert(schema.companyFlowEvents).values({
        orgId: actor.orgId,
        flowId: flow.id,
        eventType: "informative_confirmed",
        previousValue: { status: flow.status },
        newValue: {
          status: "completed",
          informativeId: informative.id,
          clientRegistrationUpdated: updatedClientRegistration,
          synchronizedFiscalPeriods,
        },
        actorId: actor.userId,
      });
    }

    const missionMessage =
      taskIds.length === 0
        ? "Nenhuma missão a criar — as linhas eram combinado ou sem particularidades."
        : payload.company.legalName
          ? `${taskIds.length} missão(ões) criada(s) para ${payload.company.legalName}.`
          : `${taskIds.length} missão(ões) criada(s).`;
    const closingMessage = periodClosingIds.size
      ? ` ${periodClosingIds.size} período(s) pendente(s) adicionado(s) aos fechamentos.`
      : "";
    const clientMessage = createdClient ? " Empresa cadastrada no painel." : "";
    const registrationMessage = updatedClientRegistration
      ? ` Cadastro da empresa atualizado${synchronizedFiscalPeriods > 0 ? ` e ${synchronizedFiscalPeriods} competência(s) fiscal(is) não iniciada(s) sincronizada(s)` : ""}.`
      : "";
    const commitmentMessage = createdCommitments
      ? ` ${createdCommitments} planejamento(s) de distribuição de lucros criado(s).`
      : "";
    const noticeMessage = noticePublished ? " Aviso publicado no mural." : "";
    return {
      ok: true,
      message: `${missionMessage}${closingMessage}${clientMessage}${registrationMessage}${commitmentMessage}${noticeMessage}`,
      taskIds,
    };
  });
}
