"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import {
  NFSE_CANCEL_TEXT_MAX,
  NFSE_CANCEL_TEXT_MIN,
  type NfseEmissionPreviewView,
} from "@/domain/nfse";
import { err, type ActionResult } from "@/lib/action-context";
import {
  enqueueNfseBatch,
  loadNfseEmissionPreview,
  requeueNfseInvoice,
  requestNfseCancel,
  upsertNfseSettings,
} from "@/lib/nfse/requests";
import { nfseTemplateRulesSchema } from "@/lib/nfse/template";
import { nfseToday } from "@/lib/nfse/time";
import { asFiscalOperator } from "@/lib/office-fees/fiscal-operator";

const periodSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  includeAdditional: z.boolean(),
});

export async function previewNfseEmission(
  input: z.input<typeof periodSchema>,
): Promise<ActionResult<NfseEmissionPreviewView>> {
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Período inválido.");
  const data = parsed.data;
  return asFiscalOperator(data.clanId, async (tx, ctx) => ({
    ok: true,
    data: await loadNfseEmissionPreview(tx, { orgId: ctx.orgId, ...data }),
  }));
}

const emitSchema = periodSchema.extend({
  selected: z.array(z.string().max(80)).min(1, "Marque ao menos uma nota para emitir.").max(1000),
  expectedCount: z.number().int().min(1).max(1000),
  expectedTotalCents: z.number().int().min(1),
});

export async function emitNfseBatch(
  input: z.input<typeof emitSchema>,
): Promise<ActionResult<{ queued: number }>> {
  const parsed = emitSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    enqueueNfseBatch(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data, today: nfseToday(new Date()) }),
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const cancelSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  invoiceId: z.uuid("Nota inválida."),
  reasonCode: z.union([z.literal(1), z.literal(2), z.literal(9)]),
  reasonText: z
    .string()
    .trim()
    .min(NFSE_CANCEL_TEXT_MIN, `Explique o motivo com pelo menos ${NFSE_CANCEL_TEXT_MIN} caracteres.`)
    .max(NFSE_CANCEL_TEXT_MAX, `O motivo pode ter no máximo ${NFSE_CANCEL_TEXT_MAX} caracteres.`),
});

export async function cancelNfseInvoice(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    requestNfseCancel(tx, { orgId: ctx.orgId, actorId: ctx.userId, invoiceId: data.invoiceId, reasonCode: data.reasonCode, reasonText: data.reasonText }),
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const retrySchema = z.object({ clanId: z.uuid("Clã inválido."), invoiceId: z.uuid("Nota inválida.") });

export async function retryNfseInvoice(input: z.input<typeof retrySchema>): Promise<ActionResult> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    requeueNfseInvoice(tx, { orgId: ctx.orgId, actorId: ctx.userId, invoiceId: data.invoiceId }),
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}

const settingsSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  providerCnpj: z.string().transform(normalizeCnpj).refine(validateCnpj, "CNPJ do escritório inválido."),
  dpsSeries: z.string().regex(/^\d{1,5}$/, "Série inválida.").refine((value) => Number(value) >= 1 && Number(value) <= 49_999, "A série deve estar entre 1 e 49999."),
  template: nfseTemplateRulesSchema,
});

export async function saveNfseSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Modelo inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(
    data.clanId,
    (tx, ctx) =>
      upsertNfseSettings(tx, { orgId: ctx.orgId, actorId: ctx.userId, providerCnpj: data.providerCnpj, dpsSeries: data.dpsSeries, template: data.template }),
    { adminOnly: true },
  );
  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
