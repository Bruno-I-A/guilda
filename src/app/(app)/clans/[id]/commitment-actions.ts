"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  COMMITMENT_CADENCES,
  commitmentPeriodLabel,
  periodsForCadenceRange,
  periodsPerYear,
  type CommitmentCadence,
  type CommitmentPeriodCoordinate,
} from "@/domain/commitments";
import { canManageClanCommitments } from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { CONTABILIDADE_CLAN_SLUG } from "@/lib/clans/rules";
import { createTaskRecord } from "@/lib/tasks/create";

/**
 * Server Actions da Distribuição de lucros. Os nomes físicos das tabelas
 * continuam legados para preservar todo o histórico já registrado.
 */

type MemberContext = {
  orgId: string;
  userId: string;
  role: Parameters<typeof loadClanScopedFacts>[4];
};

type RangeInput = {
  startYear: number;
  startIndex: number;
  endYear: number;
  endIndex: number;
};

async function requireDistributionManager(
  tx: OrgTx,
  ctx: MemberContext,
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
  if (clan.slug !== CONTABILIDADE_CLAN_SLUG) {
    return err("A Distribuição de lucros pertence ao clã Contabilidade.");
  }
  if (!canManageClanCommitments(facts)) {
    return err(
      "Apenas o líder da Contabilidade ou um admin pode gerenciar as distribuições.",
    );
  }
  return { ok: true, clanId: clan.id };
}

function optionalMoneySchema(label: string) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const raw = String(value).trim();
      if (!raw) return null;
      const normalized = raw.includes(",")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw;

      if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
        ctx.addIssue({
          code: "custom",
          message: `${label} deve ser um valor não negativo com até 2 casas decimais.`,
        });
        return z.NEVER;
      }
      const numericValue = Number(normalized);
      if (!Number.isFinite(numericValue) || numericValue > 9_999_999_999_999.99) {
        ctx.addIssue({
          code: "custom",
          message: `${label} está fora do limite permitido.`,
        });
        return z.NEVER;
      }
      return normalized;
    });
}

const coordinateFields = {
  startYear: z.number().int().min(2000).max(2100),
  startIndex: z.number().int().min(1).max(12),
  endYear: z.number().int().min(2000).max(2100),
  endIndex: z.number().int().min(1).max(12),
};

function validatedRange(
  cadence: CommitmentCadence,
  data: RangeInput,
): { start: CommitmentPeriodCoordinate; end: CommitmentPeriodCoordinate } | null {
  const total = periodsPerYear(cadence);
  if (data.startIndex > total || data.endIndex > total) return null;
  const start = { year: data.startYear, index: data.startIndex };
  const end = { year: data.endYear, index: data.endIndex };
  return periodsForCadenceRange(cadence, start, end).length > 0
    ? { start, end }
    : null;
}

async function ensurePeriods(
  tx: OrgTx,
  input: {
    orgId: string;
    commitmentId: string;
    cadence: CommitmentCadence;
    start: CommitmentPeriodCoordinate;
    end: CommitmentPeriodCoordinate;
  },
): Promise<number> {
  const rows = periodsForCadenceRange(
    input.cadence,
    input.start,
    input.end,
  ).map((period) => ({
    orgId: input.orgId,
    commitmentId: input.commitmentId,
    periodYear: period.year,
    periodIndex: period.index,
    dueDate: period.dueDate,
  }));
  if (rows.length === 0) return 0;

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
  cadence: z.enum(COMMITMENT_CADENCES, { error: "Escolha a periodicidade." }),
  notes: z.string().trim().max(2000, "Observação muito longa.").optional(),
  difficulty: z.number().int().min(1).max(5).default(2),
  ...coordinateFields,
});

export async function createCommitment(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ commitmentId: string; periods: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  const range = validatedRange(data.cadence, data);
  if (!range) return err("O intervalo de períodos é inválido.");

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ commitmentId: string; periods: number }>> => {
      const gate = await requireDistributionManager(tx, ctx, data.clanId);
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
        .for("update");
      if (!client) return err("Empresa não encontrada.");
      if (!client.active) return err("Empresa inativa não recebe distribuição nova.");

      const [existing] = await tx
        .select({ id: schema.clientCommitments.id })
        .from(schema.clientCommitments)
        .where(
          and(
            eq(schema.clientCommitments.orgId, ctx.orgId),
            eq(schema.clientCommitments.clanId, gate.clanId),
            eq(schema.clientCommitments.clientId, client.id),
            eq(schema.clientCommitments.active, true),
          ),
        )
        .limit(1);
      if (existing) {
        return err("Esta empresa já possui um planejamento ativo de distribuição.");
      }

      const [commitment] = await tx
        .insert(schema.clientCommitments)
        .values({
          orgId: ctx.orgId,
          clanId: gate.clanId,
          clientId: client.id,
          title: "Distribuição de lucros",
          notes: data.notes || null,
          cadence: data.cadence,
          difficulty: data.difficulty,
          createdBy: ctx.userId,
        })
        .returning({ id: schema.clientCommitments.id });

      const periods = await ensurePeriods(tx, {
        orgId: ctx.orgId,
        commitmentId: commitment.id,
        cadence: data.cadence,
        ...range,
      });
      return { ok: true, data: { commitmentId: commitment.id, periods } };
    },
  );

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const planRangeSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  commitmentId: z.uuid("Distribuição inválida."),
  ...coordinateFields,
});

export async function planCommitmentPeriods(
  input: z.input<typeof planRangeSchema>,
): Promise<ActionResult<{ periods: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = planRangeSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ periods: number }>> => {
      const gate = await requireDistributionManager(tx, ctx, data.clanId);
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
      if (!commitment) return err("Distribuição não encontrada.");
      if (!commitment.active) return err("Distribuição arquivada não gera períodos.");
      const range = validatedRange(commitment.cadence, data);
      if (!range) return err("O intervalo de períodos é inválido.");
      const periods = await ensurePeriods(tx, {
        orgId: ctx.orgId,
        commitmentId: commitment.id,
        cadence: commitment.cadence,
        ...range,
      });
      return { ok: true, data: { periods } };
    },
  );

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const setActiveSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  commitmentId: z.uuid("Distribuição inválida."),
  active: z.boolean(),
});

export async function setCommitmentActive(
  input: z.input<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireDistributionManager(tx, ctx, data.clanId);
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
    return updated.length > 0 ? { ok: true } : err("Distribuição não encontrada.");
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const updatePeriodSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  periodId: z.uuid("Período inválido."),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").optional(),
  notes: z.string().trim().max(2000, "Observação muito longa.").optional(),
  distributedAmount: optionalMoneySchema("Valor distribuído").optional(),
  completed: z.boolean().optional(),
});

export async function updateCommitmentPeriod(
  input: z.input<typeof updatePeriodSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = updatePeriodSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireDistributionManager(tx, ctx, data.clanId);
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
      return err("Esta distribuição pertence a outro clã.");
    }
    if (data.completed !== undefined && period.taskId) {
      return err("Este período já tem missão. Altere o estado pela missão.");
    }

    const now = new Date();
    await tx
      .update(schema.clientCommitmentPeriods)
      .set({
        ...(data.dueDate ? { dueDate: data.dueDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
        ...(data.distributedAmount !== undefined
          ? { distributedAmount: data.distributedAmount }
          : {}),
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

const createMissionsSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  periodIds: z.array(z.uuid("Período inválido.")).min(1).max(50),
});

export async function createMissionsForPeriods(
  input: z.input<typeof createMissionsSchema>,
): Promise<ActionResult<{ created: number; skipped: number; taskIds: string[] }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = createMissionsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = { ...parsed.data, periodIds: [...new Set(parsed.data.periodIds)] };

  const result = await withOrgTx(
    ctx.orgId,
    async (
      tx,
    ): Promise<ActionResult<{ created: number; skipped: number; taskIds: string[] }>> => {
      const gate = await requireDistributionManager(tx, ctx, data.clanId);
      if (!gate.ok) return gate;

      const periods = await tx
        .select({
          id: schema.clientCommitmentPeriods.id,
          periodYear: schema.clientCommitmentPeriods.periodYear,
          periodIndex: schema.clientCommitmentPeriods.periodIndex,
          dueDate: schema.clientCommitmentPeriods.dueDate,
          periodNotes: schema.clientCommitmentPeriods.notes,
          taskId: schema.clientCommitmentPeriods.taskId,
          completedAt: schema.clientCommitmentPeriods.completedAt,
          clanId: schema.clientCommitments.clanId,
          clientId: schema.clientCommitments.clientId,
          planNotes: schema.clientCommitments.notes,
          cadence: schema.clientCommitments.cadence,
          difficulty: schema.clientCommitments.difficulty,
          active: schema.clientCommitments.active,
          clientName: schema.clients.name,
        })
        .from(schema.clientCommitmentPeriods)
        .innerJoin(
          schema.clientCommitments,
          and(
            eq(schema.clientCommitments.id, schema.clientCommitmentPeriods.commitmentId),
            eq(schema.clientCommitments.orgId, schema.clientCommitmentPeriods.orgId),
          ),
        )
        .innerJoin(
          schema.clients,
          and(
            eq(schema.clients.id, schema.clientCommitments.clientId),
            eq(schema.clients.orgId, schema.clientCommitments.orgId),
          ),
        )
        .where(
          and(
            eq(schema.clientCommitmentPeriods.orgId, ctx.orgId),
            inArray(schema.clientCommitmentPeriods.id, data.periodIds),
          ),
        )
        .for("update", { of: schema.clientCommitmentPeriods });

      if (periods.length !== data.periodIds.length) return err("Um dos períodos não existe.");
      if (periods.some((period) => period.clanId !== gate.clanId)) {
        return err("Um dos períodos pertence a outro clã.");
      }
      if (periods.some((period) => !period.active)) {
        return err("Distribuição arquivada não gera missão.");
      }

      const taskIds: string[] = [];
      let skipped = 0;
      for (const period of periods) {
        if (period.taskId || period.completedAt) {
          skipped += 1;
          continue;
        }
        const label = commitmentPeriodLabel(
          period.cadence,
          period.periodYear,
          period.periodIndex,
        );
        const details = [period.planNotes, period.periodNotes]
          .filter(Boolean)
          .join("\n\n");
        const created = await createTaskRecord(tx, {
          orgId: ctx.orgId,
          creatorId: ctx.userId,
          assigneeId: null,
          clanId: period.clanId,
          clientId: period.clientId,
          commitmentPeriodId: period.id,
          title: `Distribuição de lucros — ${label}`,
          description: details
            ? `Distribuição de lucros de ${period.clientName}.\n\n${details}`
            : `Distribuição de lucros de ${period.clientName}.`,
          priority: 2,
          difficulty: period.difficulty,
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
        taskIds.push(created.id);
      }
      return { ok: true, data: { created: taskIds.length, skipped, taskIds } };
    },
  );

  if (result.ok) {
    revalidatePath(`/clans/${data.clanId}`);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
  }
  return result;
}

const closingNoteSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  clientId: z.uuid("Empresa inválida."),
  year: z.number().int().min(2000).max(2100),
  notes: z.string().trim().max(3000, "Observação muito longa."),
});

export async function updateDistributionClosingNote(
  input: z.input<typeof closingNoteSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = closingNoteSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireDistributionManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;
    const [client] = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.id, data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
          eq(schema.clients.active, true),
        ),
      )
      .limit(1);
    if (!client) return err("Empresa ativa não encontrada.");

    const now = new Date();
    await tx
      .insert(schema.accountingClosingYears)
      .values({
        orgId: ctx.orgId,
        clientId: client.id,
        year: data.year,
        notes: data.notes || null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.accountingClosingYears.orgId,
          schema.accountingClosingYears.clientId,
          schema.accountingClosingYears.year,
        ],
        set: { notes: data.notes || null, updatedAt: now },
      });
    return { ok: true };
  });

  if (result.ok) {
    revalidatePath(`/clans/${data.clanId}`);
    revalidatePath("/clans/[id]", "page");
  }
  return result;
}
