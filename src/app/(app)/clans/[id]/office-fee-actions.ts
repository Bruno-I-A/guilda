"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { normalizeCnpj, validateCnpj, validateTaxDocument } from "@/domain/cnpj";
import {
  OFFICE_FEE_STAGES,
  officeFeeProfileVersionMatches,
} from "@/domain/office-fee-control";
import {
  canManageFiscalOperations,
  canUpdateFiscalControl,
} from "@/domain/guild-permissions";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { lookupCnpj, type CnpjAddress } from "@/lib/cnpj-lookup";
import { deleteOfficeFeePayer } from "@/lib/office-fees/delete-payer";
import { requireFiscalClan } from "@/lib/office-fees/fiscal-clan";
import {
  materializeOfficeFeeControl,
  officeFeeProfileSnapshot,
} from "@/lib/office-fees/materialize";
import {
  applyOfficeFeeStepChange,
  OFFICE_FEE_STAGE_COLUMNS,
} from "@/lib/office-fees/step-change";

const STEP_STATUSES = ["not_applicable", "pending", "completed", "blocked"] as const;

const profileSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  clientId: z.uuid("Empresa inválida."),
  expectedVersion: z.number().int().min(1).nullable(),
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
        takerId: created.takerId,
        eventType: "created",
        version: created.version,
        snapshot: officeFeeProfileSnapshot(created),
        changedFields: [
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
      takerId: updated.takerId,
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

const optionalText = (max: number) => z.string().trim().max(max, "Texto muito longo.").optional();

const takerSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  takerId: z.uuid("Tomador inválido.").nullable(),
  expectedVersion: z.number().int().min(1).nullable(),
  name: z.string().trim().min(1, "Informe o nome do tomador.").max(200, "Nome muito longo."),
  document: z
    .string()
    .transform((value) => normalizeCnpj(value))
    .refine(validateTaxDocument, "CPF ou CNPJ inválido."),
  address: z.object({
    zipCode: optionalText(9),
    street: optionalText(255),
    number: optionalText(60),
    complement: optionalText(156),
    district: optionalText(60),
    city: optionalText(100),
    state: optionalText(2),
  }),
  active: z.boolean(),
  chargesAdditionalInstallment: z.boolean(),
  monthlyFee: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, "Valor mensal inválido."),
  permanentNotes: z.string().trim().max(4000, "Observações muito longas.").optional(),
});

/**
 * Tomador avulso: paga honorário e recebe nota sem ser empresa-cliente (as
 * filiais da KMJ, produtor rural com CPF). Cadastro e honorário andam juntos;
 * qualquer mudança abre uma nova versão do honorário, para a auditoria.
 */
export async function saveOfficeFeeTaker(
  input: z.input<typeof takerSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = takerSchema.safeParse(input);
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
    if (data.document.length === 14) {
      const [client] = await tx
        .select({ name: schema.clients.name })
        .from(schema.clients)
        .where(and(eq(schema.clients.orgId, ctx.orgId), eq(schema.clients.cnpj, data.document)))
        .limit(1);
      if (client) return err(`Este CNPJ já é da empresa ${client.name}. Cadastre o honorário nela.`);
    }
    const [duplicate] = await tx
      .select({ id: schema.officeFeeTakers.id })
      .from(schema.officeFeeTakers)
      .where(and(eq(schema.officeFeeTakers.orgId, ctx.orgId), eq(schema.officeFeeTakers.document, data.document)))
      .limit(1);
    if (duplicate && duplicate.id !== data.takerId) return err("Já existe um tomador avulso com este CPF/CNPJ.");

    const address = {
      street: data.address.street || null,
      number: data.address.number || null,
      complement: data.address.complement || null,
      district: data.address.district || null,
      city: data.address.city || null,
      state: data.address.state?.toUpperCase() || null,
      zipCode: data.address.zipCode?.replace(/\D/g, "") || null,
    };
    const takerValues = {
      name: data.name,
      document: data.document,
      address: Object.values(address).some(Boolean) ? address : null,
      active: data.active,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    const profileValues = {
      chargesAdditionalInstallment: data.chargesAdditionalInstallment,
      monthlyFee: data.monthlyFee,
      permanentNotes: data.permanentNotes || null,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };

    if (!data.takerId) {
      const [taker] = await tx
        .insert(schema.officeFeeTakers)
        .values({ orgId: ctx.orgId, ...takerValues, createdBy: ctx.userId })
        .returning();
      const [created] = await tx
        .insert(schema.officeFeeProfiles)
        .values({ orgId: ctx.orgId, takerId: taker.id, ...profileValues, createdBy: ctx.userId })
        .returning();
      await tx.insert(schema.officeFeeProfileEvents).values({
        orgId: ctx.orgId,
        profileId: created.id,
        takerId: taker.id,
        eventType: "created",
        version: created.version,
        snapshot: officeFeeProfileSnapshot(created),
        changedFields: ["takerName", "takerDocument", "takerAddress", "chargesAdditionalInstallment", "monthlyFee", "permanentNotes"],
        actorId: ctx.userId,
      });
      return { ok: true };
    }

    const [taker] = await tx
      .select()
      .from(schema.officeFeeTakers)
      .where(and(eq(schema.officeFeeTakers.orgId, ctx.orgId), eq(schema.officeFeeTakers.id, data.takerId)))
      .for("update");
    if (!taker) return err("Tomador não encontrado.");
    const [current] = await tx
      .select()
      .from(schema.officeFeeProfiles)
      .where(and(eq(schema.officeFeeProfiles.orgId, ctx.orgId), eq(schema.officeFeeProfiles.takerId, taker.id)))
      .for("update");
    if (!current || !officeFeeProfileVersionMatches(current.version, data.expectedVersion)) {
      return err("O cadastro de honorário mudou enquanto estava aberto. Reabra e revise antes de salvar.");
    }
    const changedFields = (
      [
        ["takerName", taker.name, takerValues.name],
        ["takerDocument", taker.document, takerValues.document],
        ["takerAddress", JSON.stringify(taker.address), JSON.stringify(takerValues.address)],
        ["takerActive", taker.active, takerValues.active],
        ["chargesAdditionalInstallment", current.chargesAdditionalInstallment, profileValues.chargesAdditionalInstallment],
        ["monthlyFee", current.monthlyFee, profileValues.monthlyFee],
        ["permanentNotes", current.permanentNotes ?? "", profileValues.permanentNotes ?? ""],
      ] as const
    ).filter(([, before, after]) => before !== after).map(([field]) => field);
    if (changedFields.length === 0) return { ok: true };
    await tx
      .update(schema.officeFeeTakers)
      .set(takerValues)
      .where(and(eq(schema.officeFeeTakers.orgId, ctx.orgId), eq(schema.officeFeeTakers.id, taker.id)));
    const [updated] = await tx
      .update(schema.officeFeeProfiles)
      .set({ ...profileValues, version: current.version + 1 })
      .where(and(eq(schema.officeFeeProfiles.orgId, ctx.orgId), eq(schema.officeFeeProfiles.id, current.id)))
      .returning();
    await tx.insert(schema.officeFeeProfileEvents).values({
      orgId: ctx.orgId,
      profileId: updated.id,
      takerId: taker.id,
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

const deleteProfileSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  clientId: z.uuid("Empresa inválida.").nullable(),
  takerId: z.uuid("Tomador inválido.").nullable(),
}).refine((value) => Boolean(value.clientId) !== Boolean(value.takerId), "Informe a empresa ou o tomador.");

/** Apaga o cadastro de honorário; a regra mora em `deleteOfficeFeePayer`. */
export async function deleteOfficeFeeProfile(
  input: z.input<typeof deleteProfileSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = deleteProfileSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId: data.clanId, userId: ctx.userId, role: ctx.role });
    if (!fiscal) return err("Clã Fiscal não encontrado.");
    if (!canManageFiscalOperations(fiscal.facts)) {
      return err("Apenas integrantes do Fiscal ou um admin podem apagar honorários.");
    }
    const deleted = await deleteOfficeFeePayer(tx, { orgId: ctx.orgId, clientId: data.clientId, takerId: data.takerId });
    if (!deleted.ok) return err(deleted.error);
    return { ok: true };
  });
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const takerLookupSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  cnpj: z.string().transform((value) => normalizeCnpj(value)).refine(validateCnpj, "CNPJ inválido."),
});

/** Preenche nome e endereço do tomador avulso pela consulta pública de CNPJ. */
export async function lookupOfficeFeeTakerCnpj(
  input: z.input<typeof takerLookupSchema>,
): Promise<ActionResult<{ name: string; address: CnpjAddress | null }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = takerLookupSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "CNPJ inválido.");
  const allowed = await withOrgTx(ctx.orgId, async (tx) => {
    const fiscal = await requireFiscalClan(tx, { orgId: ctx.orgId, clanId: parsed.data.clanId, userId: ctx.userId, role: ctx.role });
    return Boolean(fiscal && canManageFiscalOperations(fiscal.facts));
  });
  if (!allowed) return err("Apenas integrantes do Fiscal ou um admin podem editar honorários.");
  const result = await lookupCnpj(parsed.data.cnpj);
  if (!result.ok) {
    return err(
      result.reason === "not_found"
        ? "CNPJ não encontrado nas bases públicas. Preencha manualmente."
        : "Não foi possível consultar o CNPJ agora. Preencha manualmente.",
    );
  }
  return { ok: true, data: { name: result.data.legalName, address: result.data.address } };
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
        takerId: control.takerId,
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
