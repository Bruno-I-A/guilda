"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  OFFICE_FEE_STAGES,
  officeFeeProfileVersionMatches,
} from "@/domain/office-fee-control";
import {
  canManageFiscalOperations,
  canUpdateFiscalControl,
} from "@/domain/guild-permissions";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";
import {
  materializeOfficeFeeControl,
  officeFeeProfileSnapshot,
} from "@/lib/office-fees/materialize";
import {
  applyOfficeFeeStepChange,
  OFFICE_FEE_STAGE_COLUMNS,
} from "@/lib/office-fees/step-change";

const BILLING_METHODS = ["asaas", "recibo", "pix", "other"] as const;
const STEP_STATUSES = ["not_applicable", "pending", "completed", "blocked"] as const;

const profileSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  clientId: z.uuid("Empresa inválida."),
  expectedVersion: z.number().int().min(1).nullable(),
  billingMethod: z.enum(BILLING_METHODS),
  chargesAdditionalInstallment: z.boolean(),
  monthlyFee: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, "Valor mensal inválido."),
  permanentNotes: z.string().trim().max(4000, "Observações muito longas.").optional(),
});

function changedProfileFields(
  current: typeof schema.officeFeeProfiles.$inferSelect,
  next: z.output<typeof profileSchema>,
): string[] {
  const pairs = [
    ["billingMethod", current.billingMethod, next.billingMethod],
    [
      "chargesAdditionalInstallment",
      current.chargesAdditionalInstallment,
      next.chargesAdditionalInstallment,
    ],
    ["monthlyFee", current.monthlyFee, next.monthlyFee],
    ["permanentNotes", current.permanentNotes ?? "", next.permanentNotes ?? ""],
  ] as const;
  return pairs.filter(([, before, after]) => before !== after).map(([field]) => field);
}

export async function saveOfficeFeeProfile(
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
      return err("Apenas integrantes do Fiscal ou um admin podem editar honorários.");
    }
    const [client] = await tx
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.id, data.clientId)))
      .for("update");
    if (!client) return err("Empresa não encontrada.");
    const [current] = await tx
      .select()
      .from(schema.officeFeeProfiles)
      .where(
        and(
          eq(schema.officeFeeProfiles.orgId, ctx.orgId),
          eq(schema.officeFeeProfiles.clientId, client.id),
        ),
      )
      .for("update");
    if (!officeFeeProfileVersionMatches(current?.version, data.expectedVersion)) {
      return err("O cadastro de honorário mudou enquanto estava aberto. Reabra e revise antes de salvar.");
    }
    const values = {
      billingMethod: data.billingMethod,
      chargesAdditionalInstallment: data.chargesAdditionalInstallment,
      monthlyFee: data.monthlyFee,
      permanentNotes: data.permanentNotes || null,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    if (!current) {
      const [created] = await tx
        .insert(schema.officeFeeProfiles)
        .values({ orgId: ctx.orgId, clientId: client.id, ...values, createdBy: ctx.userId })
        .returning();
      await tx.insert(schema.officeFeeProfileEvents).values({
        orgId: ctx.orgId,
        profileId: created.id,
        clientId: created.clientId,
        eventType: "created",
        version: created.version,
        snapshot: officeFeeProfileSnapshot(created),
        changedFields: [
          "billingMethod",
          "chargesAdditionalInstallment",
          "monthlyFee",
          "permanentNotes",
        ],
        actorId: ctx.userId,
      });
      return { ok: true };
    }
    const changedFields = changedProfileFields(current, data);
    if (changedFields.length === 0) return { ok: true };
    const [updated] = await tx
      .update(schema.officeFeeProfiles)
      .set({ ...values, version: current.version + 1 })
      .where(and(eq(schema.officeFeeProfiles.orgId, ctx.orgId), eq(schema.officeFeeProfiles.id, current.id)))
      .returning();
    await tx.insert(schema.officeFeeProfileEvents).values({
      orgId: ctx.orgId,
      profileId: updated.id,
      clientId: updated.clientId,
      eventType: "updated",
      version: updated.version,
      snapshot: officeFeeProfileSnapshot(updated),
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
});

export async function openOfficeFeeControlPeriod(
  input: z.input<typeof openControlSchema>,
): Promise<ActionResult<{ created: number; existing: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = openControlSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Período inválido.");
  const data = parsed.data;
  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ created: number; existing: number }>> => {
    const fiscal = await requireFiscalClan(tx, {
      orgId: ctx.orgId,
      clanId: data.clanId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    if (!canManageFiscalOperations(fiscal.facts)) {
      return err("Apenas integrantes do Fiscal ou um admin podem abrir o controle de honorários.");
    }
    return { ok: true, data: await materializeOfficeFeeControl(tx, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      periodYear: data.periodYear,
      periodMonth: data.periodMonth,
    }) };
  });
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const updateControlSchema = z
  .object({
    clanId: z.uuid("Clã inválido."),
    controlId: z.uuid("Controle inválido."),
    stage: z.enum(OFFICE_FEE_STAGES).optional(),
    stepStatus: z.enum(STEP_STATUSES).optional(),
    monthlyNotes: z.string().trim().max(3000, "Observação muito longa.").optional(),
  })
  .refine(
    (value) => Boolean(value.stage && value.stepStatus) || value.monthlyNotes !== undefined,
    "Nenhuma alteração informada.",
  );

export async function updateOfficeFeeControl(
  input: z.input<typeof updateControlSchema>,
): Promise<ActionResult<{ status: schema.OfficeFeeControlPeriod["status"] }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = updateControlSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;
  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ status: schema.OfficeFeeControlPeriod["status"] }>> => {
    const fiscal = await requireFiscalClan(tx, {
      orgId: ctx.orgId,
      clanId: data.clanId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    const [control] = await tx
      .select()
      .from(schema.officeFeeControlPeriods)
      .where(and(eq(schema.officeFeeControlPeriods.orgId, ctx.orgId), eq(schema.officeFeeControlPeriods.id, data.controlId)))
      .for("update");
    if (!control) return err("Controle mensal de honorários não encontrado.");
    if (!canUpdateFiscalControl(fiscal.facts)) {
      return err("Apenas integrantes do Fiscal ou um admin podem atualizar honorários.");
    }

    if (data.stage && data.stepStatus) {
      const applies = data.stage !== "additional_installment" || control.profileSnapshot.chargesAdditionalInstallment;
      if (applies && data.stepStatus === "not_applicable") {
        return err("Esta etapa faz parte do combinado de honorários e não pode ser ocultada.");
      }
      if (!applies && data.stepStatus !== "not_applicable") {
        return err("Esta empresa não cobra parcela adicional nesta competência.");
      }
    }
    const stageChanged = Boolean(
      data.stage && data.stepStatus && control[OFFICE_FEE_STAGE_COLUMNS[data.stage]] !== data.stepStatus,
    );
    const noteChanged = data.monthlyNotes !== undefined && data.monthlyNotes !== (control.monthlyNotes ?? "");
    if (!stageChanged && !noteChanged) return { ok: true, data: { status: control.status } };

    let status = control.status;
    if (stageChanged && data.stage && data.stepStatus) {
      status =
        (await applyOfficeFeeStepChange(tx, {
          orgId: ctx.orgId,
          controlPeriodId: control.id,
          stage: data.stage,
          stepStatus: data.stepStatus,
          actorId: ctx.userId,
        })) ?? status;
    }
    if (noteChanged && data.monthlyNotes !== undefined) {
      await tx
        .update(schema.officeFeeControlPeriods)
        .set({ monthlyNotes: data.monthlyNotes || null, updatedBy: ctx.userId, updatedAt: new Date() })
        .where(and(eq(schema.officeFeeControlPeriods.orgId, ctx.orgId), eq(schema.officeFeeControlPeriods.id, control.id)));
      await tx.insert(schema.officeFeeControlEvents).values({
        orgId: ctx.orgId,
        controlPeriodId: control.id,
        clientId: control.clientId,
        eventType: "note_updated",
        previousValue: { monthlyNotes: control.monthlyNotes },
        newValue: { monthlyNotes: data.monthlyNotes || null },
        actorId: ctx.userId,
      });
    }
    return { ok: true, data: { status } };
  });
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
