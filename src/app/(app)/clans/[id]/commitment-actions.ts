"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  COMMITMENT_CADENCES,
  commitmentPeriodLabel,
  periodsForCadence,
  type CommitmentCadence,
} from "@/domain/commitments";
import { canManageClanCommitments } from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { createTaskRecord } from "@/lib/tasks/create";

/**
 * Server Actions dos compromissos recorrentes — a regra por empresa e as
 * ocorrências que ela gera.
 *
 * O compromisso pertence a UM clã e a UMA empresa; a permissão sai sempre de
 * `canManageClanCommitments` com os fatos carregados aqui. Ver o design em
 * docs/superpowers/specs/2026-08-19-compromissos-recorrentes-design.md.
 */

/** Ano corrente em São Paulo — o fuso do escritório, não o do servidor. */
function currentYearInSaoPaulo(): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }).format(new Date()),
  );
}

/** Carrega o clã e confere que quem chamou pode mexer nos compromissos dele. */
async function requireCommitmentManager(
  tx: OrgTx,
  ctx: { orgId: string; userId: string; role: Parameters<typeof loadClanScopedFacts>[4] },
  clanId: string,
): Promise<{ ok: true; clanId: string } | { ok: false; error: string }> {
  const { clan, facts } = await loadClanScopedFacts(
    tx,
    ctx.orgId,
    clanId,
    ctx.userId,
    ctx.role,
  );
  if (!clan) return err("Clã não encontrado.");
  if (!canManageClanCommitments(facts)) {
    return err(
      "Apenas o líder deste clã ou um admin pode gerenciar os compromissos.",
    );
  }
  return { ok: true, clanId: clan.id };
}

/**
 * Cria (ou completa) as ocorrências de um ano. Idempotente pelo índice único
 * `(org, compromisso, ano, índice)`: regerar um ano já planejado não duplica
 * nem apaga o que já foi feito.
 */
async function ensureYearPeriods(
  tx: OrgTx,
  input: {
    orgId: string;
    commitmentId: string;
    cadence: CommitmentCadence;
    year: number;
  },
): Promise<number> {
  const rows = periodsForCadence(input.cadence, input.year).map((period) => ({
    orgId: input.orgId,
    commitmentId: input.commitmentId,
    periodYear: input.year,
    periodIndex: period.index,
    dueDate: period.dueDate,
  }));
  const created = await tx
    .insert(schema.clientCommitmentPeriods)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: schema.clientCommitmentPeriods.id });
  return created.length;
}

const createSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  clientId: z.uuid("Empresa inválida."),
  title: z
    .string()
    .trim()
    .min(3, "Título muito curto.")
    .max(200, "Título muito longo."),
  cadence: z.enum(COMMITMENT_CADENCES, { error: "Escolha a periodicidade." }),
  notes: z
    .string()
    .trim()
    .max(2000, "Observação muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  difficulty: z.number().int().min(1).max(5).default(2),
  /** Ano a planejar; por padrão o corrente. */
  year: z.number().int().min(2000).max(2100).optional(),
});

export async function createCommitment(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ commitmentId: string; periods: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;
  const year = data.year ?? currentYearInSaoPaulo();

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ commitmentId: string; periods: number }>> => {
      const gate = await requireCommitmentManager(tx, ctx, data.clanId);
      if (!gate.ok) return gate;

      const [client] = await tx
        .select({ id: schema.clients.id, active: schema.clients.active })
        .from(schema.clients)
        .where(
          and(
            eq(schema.clients.id, data.clientId),
            eq(schema.clients.orgId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!client) return err("Empresa não encontrada.");
      if (!client.active) {
        return err("Empresa inativa não recebe compromisso novo.");
      }

      const [commitment] = await tx
        .insert(schema.clientCommitments)
        .values({
          orgId: ctx.orgId,
          clanId: gate.clanId,
          clientId: client.id,
          title: data.title,
          notes: data.notes ?? null,
          cadence: data.cadence,
          difficulty: data.difficulty,
          createdBy: ctx.userId,
        })
        .returning({ id: schema.clientCommitments.id });

      const periods = await ensureYearPeriods(tx, {
        orgId: ctx.orgId,
        commitmentId: commitment.id,
        cadence: data.cadence,
        year,
      });

      return { ok: true, data: { commitmentId: commitment.id, periods } };
    },
  );

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const planYearSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  commitmentId: z.uuid("Compromisso inválido."),
  year: z.number().int().min(2000).max(2100),
});

/** Planeja um ano adicional do compromisso (o seguinte, normalmente). */
export async function planCommitmentYear(
  input: z.input<typeof planYearSchema>,
): Promise<ActionResult<{ periods: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = planYearSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ periods: number }>> => {
      const gate = await requireCommitmentManager(tx, ctx, data.clanId);
      if (!gate.ok) return gate;

      const [commitment] = await tx
        .select({
          id: schema.clientCommitments.id,
          cadence: schema.clientCommitments.cadence,
          active: schema.clientCommitments.active,
        })
        .from(schema.clientCommitments)
        .where(
          and(
            eq(schema.clientCommitments.id, data.commitmentId),
            eq(schema.clientCommitments.orgId, ctx.orgId),
            eq(schema.clientCommitments.clanId, gate.clanId),
          ),
        )
        .limit(1);
      if (!commitment) return err("Compromisso não encontrado.");
      if (!commitment.active) return err("Compromisso inativo não gera período.");

      const periods = await ensureYearPeriods(tx, {
        orgId: ctx.orgId,
        commitmentId: commitment.id,
        cadence: commitment.cadence,
        year: data.year,
      });
      return { ok: true, data: { periods } };
    },
  );

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const setActiveSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  commitmentId: z.uuid("Compromisso inválido."),
  active: z.boolean(),
});

/**
 * Arquiva ou reativa o compromisso. Sem DELETE: as ocorrências já concluídas
 * são o histórico do que o escritório entregou, e apagar isso seria perder
 * exatamente o controle que a tela existe para dar.
 */
export async function setCommitmentActive(
  input: z.input<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireCommitmentManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    const updated = await tx
      .update(schema.clientCommitments)
      .set({ active: data.active, updatedAt: new Date() })
      .where(
        and(
          eq(schema.clientCommitments.id, data.commitmentId),
          eq(schema.clientCommitments.orgId, ctx.orgId),
          eq(schema.clientCommitments.clanId, gate.clanId),
        ),
      )
      .returning({ id: schema.clientCommitments.id });
    return updated.length > 0
      ? { ok: true }
      : err("Compromisso não encontrado.");
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const updatePeriodSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  periodId: z.uuid("Período inválido."),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(2000, "Observação muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** `true` conclui a ocorrência direto, sem missão; `false` reabre. */
  completed: z.boolean().optional(),
});

/**
 * Ajusta uma ocorrência: prazo, observação, e a conclusão manual — para o
 * que não precisa virar missão distribuída (alguém já fez e só registra).
 */
export async function updateCommitmentPeriod(
  input: z.input<typeof updatePeriodSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updatePeriodSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireCommitmentManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;

    const [period] = await tx
      .select({
        id: schema.clientCommitmentPeriods.id,
        taskId: schema.clientCommitmentPeriods.taskId,
        commitmentClanId: schema.clientCommitments.clanId,
      })
      .from(schema.clientCommitmentPeriods)
      .innerJoin(
        schema.clientCommitments,
        and(
          eq(schema.clientCommitments.id, schema.clientCommitmentPeriods.commitmentId),
          eq(schema.clientCommitments.orgId, schema.clientCommitmentPeriods.orgId),
        ),
      )
      .where(
        and(
          eq(schema.clientCommitmentPeriods.id, data.periodId),
          eq(schema.clientCommitmentPeriods.orgId, ctx.orgId),
        ),
      )
      .limit(1);
    if (!period) return err("Período não encontrado.");
    if (period.commitmentClanId !== gate.clanId) {
      return err("Este compromisso pertence a outro clã.");
    }
    // A ocorrência com missão viva segue o estado DELA: fechar na mão aqui
    // deixaria os dois discordando, e o sync desfaria na próxima transição.
    if (data.completed !== undefined && period.taskId) {
      return err(
        "Este período já tem missão. Conclua ou reverta a missão para mudar o estado.",
      );
    }

    const now = new Date();
    await tx
      .update(schema.clientCommitmentPeriods)
      .set({
        ...(data.dueDate ? { dueDate: data.dueDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
        ...(data.completed === undefined
          ? {}
          : data.completed
            ? { completedBy: ctx.userId, completedAt: now }
            : { completedBy: null, completedAt: null }),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.clientCommitmentPeriods.id, period.id),
          eq(schema.clientCommitmentPeriods.orgId, ctx.orgId),
        ),
      );
    return { ok: true };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const createMissionSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  periodId: z.uuid("Período inválido."),
});

/**
 * Transforma a ocorrência em missão do clã — o passo que tira o compromisso
 * do plano e o põe na fila para alguém assumir. A missão nasce SEM
 * responsável (é do clã) e o líder distribui pela Mesa, como qualquer outra.
 */
export async function createMissionForPeriod(
  input: z.input<typeof createMissionSchema>,
): Promise<ActionResult<{ taskId: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = createMissionSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ taskId: string }>> => {
      const gate = await requireCommitmentManager(tx, ctx, data.clanId);
      if (!gate.ok) return gate;

      // Trava a ocorrência: dois cliques simultâneos não geram duas missões.
      const [period] = await tx
        .select()
        .from(schema.clientCommitmentPeriods)
        .where(
          and(
            eq(schema.clientCommitmentPeriods.id, data.periodId),
            eq(schema.clientCommitmentPeriods.orgId, ctx.orgId),
          ),
        )
        .for("update");
      if (!period) return err("Período não encontrado.");
      if (period.taskId) return err("Este período já tem missão.");
      if (period.completedAt) {
        return err("Este período já foi concluído.");
      }

      const [commitment] = await tx
        .select({
          id: schema.clientCommitments.id,
          clanId: schema.clientCommitments.clanId,
          clientId: schema.clientCommitments.clientId,
          title: schema.clientCommitments.title,
          notes: schema.clientCommitments.notes,
          cadence: schema.clientCommitments.cadence,
          difficulty: schema.clientCommitments.difficulty,
          active: schema.clientCommitments.active,
          clientName: schema.clients.name,
        })
        .from(schema.clientCommitments)
        .innerJoin(
          schema.clients,
          and(
            eq(schema.clients.id, schema.clientCommitments.clientId),
            eq(schema.clients.orgId, schema.clientCommitments.orgId),
          ),
        )
        .where(
          and(
            eq(schema.clientCommitments.id, period.commitmentId),
            eq(schema.clientCommitments.orgId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!commitment) return err("Compromisso não encontrado.");
      if (commitment.clanId !== gate.clanId) {
        return err("Este compromisso pertence a outro clã.");
      }
      if (!commitment.active) {
        return err("Compromisso arquivado não gera missão.");
      }

      const label = commitmentPeriodLabel(
        commitment.cadence,
        period.periodYear,
        period.periodIndex,
      );
      const created = await createTaskRecord(tx, {
        orgId: ctx.orgId,
        creatorId: ctx.userId,
        assigneeId: null,
        clanId: commitment.clanId,
        clientId: commitment.clientId,
        commitmentPeriodId: period.id,
        title: `${commitment.title} — ${label}`.slice(0, 200),
        description: commitment.notes
          ? `Compromisso recorrente de ${commitment.clientName}.\n\n${commitment.notes}`
          : `Compromisso recorrente de ${commitment.clientName}.`,
        priority: 2,
        difficulty: commitment.difficulty,
        // Prazo da missão = prazo da ocorrência, ao meio-dia UTC (mesma
        // convenção do resto do projeto, que evita virada de dia por fuso).
        dueDate: new Date(`${period.dueDate}T12:00:00Z`),
      });

      await tx
        .update(schema.clientCommitmentPeriods)
        .set({ taskId: created.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.clientCommitmentPeriods.id, period.id),
            eq(schema.clientCommitmentPeriods.orgId, ctx.orgId),
          ),
        );

      return { ok: true, data: { taskId: created.id } };
    },
  );

  if (result.ok) {
    revalidatePath(`/clans/${data.clanId}`);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
  }
  return result;
}
