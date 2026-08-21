"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  deriveFiscalControlStatus,
  FISCAL_STAGES,
  fiscalProfileVersionMatches,
  type FiscalStage,
  type FiscalStepStatus,
} from "@/domain/fiscal-control";
import {
  canManageFiscalOperations,
  canUpdateFiscalControl,
} from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { isActiveClanMember, loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";
import {
  fiscalProfileSnapshot,
  materializeFiscalControl,
} from "@/lib/fiscal/materialize";
import { createTaskRecord } from "@/lib/tasks/create";

const applicabilitySchema = z.enum([
  "unknown",
  "required",
  "not_required",
  "not_applicable",
]);

const profileSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  clientId: z.uuid("Empresa inválida."),
  expectedVersion: z.number().int().min(1).nullable(),
  movementsApplicability: applicabilitySchema,
  incomingApplicability: applicabilitySchema,
  outgoingApplicability: applicabilitySchema,
  guideApplicability: applicabilitySchema,
  nfsApplicability: applicabilitySchema,
  factorRApplicability: applicabilitySchema,
  deliveryChannel: z
    .string()
    .trim()
    .min(1, "Informe a forma de entrega.")
    .max(120, "Forma de entrega muito longa."),
  revenueReference: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, "Referência de faturamento inválida.")
    .optional()
    .or(z.literal("")),
  permanentNotes: z
    .string()
    .trim()
    .max(4000, "Observações muito longas.")
    .optional(),
}).refine(
  (value) =>
    [
      value.movementsApplicability,
      value.incomingApplicability,
      value.outgoingApplicability,
      value.guideApplicability,
      value.nfsApplicability,
      value.factorRApplicability,
    ].every((item) => item !== "unknown"),
  "Revise todos os campos marcados como não informados.",
);

async function requireFiscalClan(
  tx: OrgTx,
  input: {
    orgId: string;
    clanId: string;
    userId: string;
    role: Parameters<typeof loadClanScopedFacts>[4];
  },
) {
  await lockActiveClansForMembershipRead(tx, input.orgId);
  const loaded = await loadClanScopedFacts(
    tx,
    input.orgId,
    input.clanId,
    input.userId,
    input.role,
  );
  if (!loaded.clan || loaded.clan.slug !== FISCAL_CLAN_SLUG) return null;
  return loaded;
}

function changedProfileFields(
  current: typeof schema.fiscalClientProfiles.$inferSelect,
  next: z.output<typeof profileSchema>,
): string[] {
  const pairs = [
    ["movementsApplicability", current.movementsApplicability, next.movementsApplicability],
    ["incomingApplicability", current.incomingApplicability, next.incomingApplicability],
    ["outgoingApplicability", current.outgoingApplicability, next.outgoingApplicability],
    ["guideApplicability", current.guideApplicability, next.guideApplicability],
    ["nfsApplicability", current.nfsApplicability, next.nfsApplicability],
    ["factorRApplicability", current.factorRApplicability, next.factorRApplicability],
    ["deliveryChannel", current.deliveryChannel ?? "", next.deliveryChannel],
    ["revenueReference", current.revenueReference ?? "", next.revenueReference ?? ""],
    ["permanentNotes", current.permanentNotes ?? "", next.permanentNotes ?? ""],
  ] as const;
  return pairs.filter(([, before, after]) => before !== after).map(([field]) => field);
}

export async function saveFiscalClientProfile(
  input: z.input<typeof profileSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const fiscal = await requireFiscalClan(tx, {
      orgId: ctx.orgId,
      clanId: data.clanId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    if (!canManageFiscalOperations(fiscal.facts)) {
      return err("Apenas a liderança do Fiscal ou um admin pode editar fichas.");
    }

    const [client] = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, data.clientId)))
      .for("update");
    if (!client) return err("Empresa não encontrada.");

    const [current] = await tx
      .select()
      .from(schema.fiscalClientProfiles)
      .where(
        and(
          eq(schema.fiscalClientProfiles.orgId, ctx.orgId),
          eq(schema.fiscalClientProfiles.clientId, client.id),
        ),
      )
      .for("update");
    if (!fiscalProfileVersionMatches(current?.version, data.expectedVersion)) {
      return err(
        "A Ficha Fiscal mudou enquanto estava aberta. Reabra a ficha e revise os valores antes de salvar.",
      );
    }

    const values = {
      movementsApplicability: data.movementsApplicability,
      incomingApplicability: data.incomingApplicability,
      outgoingApplicability: data.outgoingApplicability,
      guideApplicability: data.guideApplicability,
      nfsApplicability: data.nfsApplicability,
      factorRApplicability: data.factorRApplicability,
      deliveryChannel: data.deliveryChannel,
      revenueReference: data.revenueReference || null,
      permanentNotes: data.permanentNotes || null,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };

    if (!current) {
      const [created] = await tx
        .insert(schema.fiscalClientProfiles)
        .values({
          orgId: ctx.orgId,
          clientId: client.id,
          ...values,
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(schema.fiscalClientProfileEvents).values({
        orgId: ctx.orgId,
        profileId: created.id,
        clientId: client.id,
        eventType: "created",
        version: created.version,
        snapshot: fiscalProfileSnapshot(created),
        changedFields: [
          "movementsApplicability",
          "incomingApplicability",
          "outgoingApplicability",
          "guideApplicability",
          "nfsApplicability",
          "factorRApplicability",
          "deliveryChannel",
          "revenueReference",
          "permanentNotes",
        ],
        actorId: ctx.userId,
      });
      return { ok: true };
    }

    const changedFields = changedProfileFields(current, data);
    if (changedFields.length === 0) return { ok: true };
    const [updated] = await tx
      .update(schema.fiscalClientProfiles)
      .set({ ...values, version: current.version + 1 })
      .where(
        and(
          eq(schema.fiscalClientProfiles.orgId, ctx.orgId),
          eq(schema.fiscalClientProfiles.id, current.id),
        ),
      )
      .returning();
    await tx.insert(schema.fiscalClientProfileEvents).values({
      orgId: ctx.orgId,
      profileId: updated.id,
      clientId: updated.clientId,
      eventType: "updated",
      version: updated.version,
      snapshot: fiscalProfileSnapshot(updated),
      changedFields,
      actorId: ctx.userId,
    });
    return { ok: true };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const openControlSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  campaignId: z.uuid("Campanha inválida.").optional(),
});

export async function openFiscalControlPeriod(
  input: z.input<typeof openControlSchema>,
): Promise<ActionResult<{ created: number; existing: number; synchronized: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = openControlSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Período inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ created: number; existing: number; synchronized: number }>> => {
    const fiscal = await requireFiscalClan(tx, {
      orgId: ctx.orgId,
      clanId: data.clanId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    if (!canManageFiscalOperations(fiscal.facts)) {
      return err("Apenas a liderança do Fiscal ou um admin pode abrir competências.");
    }

    if (data.campaignId) {
      const [campaign] = await tx
        .select({ id: schema.clanCampaigns.id })
        .from(schema.clanCampaigns)
        .where(
          and(
            eq(schema.clanCampaigns.orgId, ctx.orgId),
            eq(schema.clanCampaigns.id, data.campaignId),
            eq(schema.clanCampaigns.clanId, data.clanId),
            eq(schema.clanCampaigns.periodYear, data.periodYear),
            eq(schema.clanCampaigns.periodMonth, data.periodMonth),
          ),
        );
      if (!campaign) return err("A campanha não pertence a esta competência.");
    }

    const summary = await materializeFiscalControl(tx, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      periodYear: data.periodYear,
      periodMonth: data.periodMonth,
      campaignId: data.campaignId,
    });
    return { ok: true, data: summary };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const STEP_STATUSES = ["not_applicable", "pending", "completed", "blocked"] as const;
const updateControlSchema = z
  .object({
    clanId: z.uuid("Clã inválido."),
    controlId: z.uuid("Controle inválido."),
    stage: z.enum(FISCAL_STAGES).optional(),
    stepStatus: z.enum(STEP_STATUSES).optional(),
    monthlyNotes: z.string().trim().max(3000, "Observação muito longa.").optional(),
  })
  .refine(
    (value) =>
      Boolean(value.stage && value.stepStatus) || value.monthlyNotes !== undefined,
    "Nenhuma alteração informada.",
  );

const STAGE_COLUMNS = {
  movements: "movementsStatus",
  incoming: "incomingStatus",
  outgoing: "outgoingStatus",
  guide: "guideStatus",
  nfs: "nfsStatus",
  delivery: "deliveryStatus",
} as const;

export async function updateFiscalControl(
  input: z.input<typeof updateControlSchema>,
): Promise<ActionResult<{ status: schema.FiscalControlPeriod["status"] }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = updateControlSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ status: schema.FiscalControlPeriod["status"] }>> => {
    const fiscal = await requireFiscalClan(tx, {
      orgId: ctx.orgId,
      clanId: data.clanId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!fiscal) return err("Clã Fiscal não encontrado.");

    const [control] = await tx
      .select()
      .from(schema.fiscalControlPeriods)
      .where(
        and(
          eq(schema.fiscalControlPeriods.orgId, ctx.orgId),
          eq(schema.fiscalControlPeriods.id, data.controlId),
        ),
      )
      .for("update");
    if (!control) return err("Controle mensal não encontrado.");

    const activeMember = await isActiveClanMember(
      tx,
      ctx.orgId,
      data.clanId,
      ctx.userId,
    );
    if (
      !canUpdateFiscalControl({
        ...fiscal.facts,
        isActiveClanMember: activeMember,
        ownsControlSnapshot: control.responsibleUserId === ctx.userId,
      })
    ) {
      return err("Você só pode atualizar empresas da sua responsabilidade.");
    }

    const nextSteps: Record<FiscalStage, FiscalStepStatus> = {
      movements: control.movementsStatus,
      incoming: control.incomingStatus,
      outgoing: control.outgoingStatus,
      guide: control.guideStatus,
      nfs: control.nfsStatus,
      delivery: control.deliveryStatus,
    };
    if (data.stage && data.stepStatus) {
      const applicability = {
        movements: control.profileSnapshot.movementsApplicability,
        incoming: control.profileSnapshot.incomingApplicability,
        outgoing: control.profileSnapshot.outgoingApplicability,
        guide: control.profileSnapshot.guideApplicability,
        nfs: control.profileSnapshot.nfsApplicability,
        delivery: control.profileSnapshot.deliveryChannel
          ? "required" as const
          : "not_applicable" as const,
      }[data.stage];
      const applies = applicability === "required" || applicability === "unknown";
      if (applies && data.stepStatus === "not_applicable") {
        return err("Esta etapa faz parte do snapshot da Ficha Fiscal e não pode ser ocultada.");
      }
      if (!applies && data.stepStatus !== "not_applicable") {
        return err("Esta etapa não se aplica nesta competência.");
      }
    }
    const stageChanged = Boolean(
      data.stage &&
        data.stepStatus &&
        control[STAGE_COLUMNS[data.stage]] !== data.stepStatus,
    );
    const noteChanged =
      data.monthlyNotes !== undefined &&
      data.monthlyNotes !== (control.monthlyNotes ?? "");
    if (!stageChanged && !noteChanged) {
      return { ok: true, data: { status: control.status } };
    }
    const updates: Partial<typeof schema.fiscalControlPeriods.$inferInsert> = {
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    if (stageChanged && data.stage && data.stepStatus) {
      nextSteps[data.stage] = data.stepStatus;
      updates[STAGE_COLUMNS[data.stage]] = data.stepStatus;
    }
    if (data.monthlyNotes !== undefined) {
      updates.monthlyNotes = data.monthlyNotes || null;
    }

    const nextStatus = deriveFiscalControlStatus(Object.values(nextSteps));
    updates.status = nextStatus;
    if (nextStatus === "completed") {
      updates.completedBy =
        control.status === "completed" ? control.completedBy : ctx.userId;
      updates.completedAt =
        control.status === "completed" ? control.completedAt : new Date();
    } else {
      updates.completedBy = null;
      updates.completedAt = null;
    }
    await tx
      .update(schema.fiscalControlPeriods)
      .set(updates)
      .where(
        and(
          eq(schema.fiscalControlPeriods.orgId, ctx.orgId),
          eq(schema.fiscalControlPeriods.id, control.id),
        ),
      );

    if (stageChanged && data.stage && data.stepStatus) {
      await tx.insert(schema.fiscalControlEvents).values({
        orgId: ctx.orgId,
        controlPeriodId: control.id,
        clientId: control.clientId,
        eventType: "step_updated",
        stage: data.stage,
        previousValue: { status: control[STAGE_COLUMNS[data.stage]] },
        newValue: { status: data.stepStatus },
        actorId: ctx.userId,
      });
    }
    if (noteChanged && data.monthlyNotes !== undefined) {
      await tx.insert(schema.fiscalControlEvents).values({
        orgId: ctx.orgId,
        controlPeriodId: control.id,
        clientId: control.clientId,
        eventType: "note_updated",
        previousValue: { monthlyNotes: control.monthlyNotes },
        newValue: { monthlyNotes: data.monthlyNotes || null },
        actorId: ctx.userId,
      });
    }
    if (nextStatus !== control.status) {
      await tx.insert(schema.fiscalControlEvents).values({
        orgId: ctx.orgId,
        controlPeriodId: control.id,
        clientId: control.clientId,
        eventType:
          nextStatus === "completed"
            ? "completed"
            : control.status === "completed"
              ? "reopened"
              : "status_updated",
        previousValue: { status: control.status },
        newValue: { status: nextStatus },
        actorId: ctx.userId,
      });
    }
    return { ok: true, data: { status: nextStatus } };
  });

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const exceptionSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  controlId: z.uuid("Controle inválido."),
  title: z.string().trim().max(200, "Título muito longo.").optional(),
  note: z.string().trim().max(2000, "Descrição muito longa.").optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Prazo inválido.").optional(),
});

export async function createFiscalExceptionMission(
  input: z.input<typeof exceptionSchema>,
): Promise<ActionResult<{ taskId: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ taskId: string }>> => {
    const fiscal = await requireFiscalClan(tx, {
      orgId: ctx.orgId,
      clanId: data.clanId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    const [control] = await tx
      .select({
        id: schema.fiscalControlPeriods.id,
        clientId: schema.fiscalControlPeriods.clientId,
        clientName: schema.clients.name,
        periodYear: schema.fiscalControlPeriods.periodYear,
        periodMonth: schema.fiscalControlPeriods.periodMonth,
        responsibleUserId: schema.fiscalControlPeriods.responsibleUserId,
        monthlyNotes: schema.fiscalControlPeriods.monthlyNotes,
        profileSnapshot: schema.fiscalControlPeriods.profileSnapshot,
      })
      .from(schema.fiscalControlPeriods)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.fiscalControlPeriods.clientId))
      .where(
        and(
          eq(schema.fiscalControlPeriods.orgId, ctx.orgId),
          eq(schema.fiscalControlPeriods.id, data.controlId),
          eq(schema.clients.orgId, ctx.orgId),
        ),
      )
      .for("update");
    if (!control) return err("Controle mensal não encontrado.");
    const activeMember = await isActiveClanMember(tx, ctx.orgId, data.clanId, ctx.userId);
    if (!canUpdateFiscalControl({
      ...fiscal.facts,
      isActiveClanMember: activeMember,
      ownsControlSnapshot: control.responsibleUserId === ctx.userId,
    })) return err("Você só pode gerar missões para empresas da sua responsabilidade.");

    const period = `${String(control.periodMonth).padStart(2, "0")}/${control.periodYear}`;
    const title = data.title || `Pendência fiscal — ${control.clientName} — ${period}`;
    const [duplicate] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.orgId, ctx.orgId),
          eq(schema.tasks.clanId, data.clanId),
          eq(schema.tasks.clientId, control.clientId),
          eq(schema.tasks.title, title),
          inArray(schema.tasks.status, [
            "pending",
            "in_progress",
            "awaiting_approval",
            "rejected",
          ]),
        ),
      )
      .limit(1);
    if (duplicate) return err("Já existe uma missão aberta para esta pendência.");

    const description = [
      `Exceção do controle fiscal de ${period}.`,
      data.note,
      control.monthlyNotes ? `Observação do mês: ${control.monthlyNotes}` : null,
      control.profileSnapshot.permanentNotes
        ? `Ficha Fiscal: ${control.profileSnapshot.permanentNotes}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    const task = await createTaskRecord(tx, {
      orgId: ctx.orgId,
      creatorId: ctx.userId,
      assigneeId: control.responsibleUserId,
      clanId: data.clanId,
      clientId: control.clientId,
      title,
      description,
      priority: 2,
      difficulty: 2,
      dueDate: data.dueDate ? new Date(`${data.dueDate}T12:00:00`) : null,
    });
    return { ok: true, data: { taskId: task.id } };
  });
  if (result.ok) {
    revalidatePath(`/clans/${data.clanId}`);
    revalidatePath("/tasks");
  }
  return result;
}
