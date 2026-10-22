"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { normalizeCnpj, validateCnpj, validateTaxDocument } from "@/domain/cnpj";
import { CLIENT_NFSE_REFERENCES, type ClientNfseBatch } from "@/domain/client-nfse";
import { NFSE_CANCEL_TEXT_MAX, NFSE_CANCEL_TEXT_MIN } from "@/domain/nfse";
import { err, type ActionResult } from "@/lib/action-context";
import {
  enqueueClientNfseBatch,
  loadClientNfsePreview,
  openClientNfseMonth,
  removeClientNfseItem,
  requestClientNfseCancel,
  requeueClientNfseInvoice,
  updateClientNfseItem,
} from "@/lib/client-nfse/month";
import {
  deleteClientNfseIssuer,
  deleteClientNfseModel,
  deleteClientNfseTaker,
  saveClientNfseIssuer,
  saveClientNfseModel,
  saveClientNfseTaker,
} from "@/lib/client-nfse/registry";
import { lookupCnpj, type CnpjAddress } from "@/lib/cnpj-lookup";
import { nfseIssuerTemplateRulesSchema } from "@/lib/nfse/template";
import { nfseToday } from "@/lib/nfse/time";
import { asFiscalOperator } from "@/lib/office-fees/fiscal-operator";

/**
 * Notas dos clientes: cada action confere sessão, clã Fiscal e permissão
 * operacional (asFiscalOperator) e valida tudo com Zod. Valor, descrição e
 * emissor saem do banco; o navegador só escolhe.
 */

function revalidateClan() {
  revalidatePath("/clans/[id]", "page");
}

const clan = z.uuid("Clã inválido.");
const money = z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Valor inválido.");
const description = z.string().trim().min(1, "Escreva a descrição da nota.").max(2000, "Descrição muito longa (até 2000 caracteres).");
const optionalText = (max: number) => z.string().trim().max(max, "Texto muito longo.").nullable();

const issuerSchema = z.object({
  clanId: clan,
  issuerId: z.uuid().nullable(),
  clientId: z.uuid("Empresa inválida."),
  template: nfseIssuerTemplateRulesSchema,
  dpsSeries: z.string().trim(),
  active: z.boolean(),
});

export async function saveIssuer(input: z.input<typeof issuerSchema>): Promise<ActionResult<{ issuerId: string }>> {
  const parsed = issuerSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Modelo fiscal inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    saveClientNfseIssuer(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const idSchema = (label: string) => z.object({ clanId: clan, id: z.uuid(label) });

export async function deleteIssuer(input: z.input<ReturnType<typeof idSchema>>): Promise<ActionResult> {
  const parsed = idSchema("Empresa inválida.").safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, (tx, ctx) =>
    deleteClientNfseIssuer(tx, { orgId: ctx.orgId, actorId: ctx.userId, issuerId: parsed.data.id }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const takerSchema = z.object({
  clanId: clan,
  issuerId: z.uuid("Empresa inválida."),
  takerId: z.uuid().nullable(),
  name: z.string().trim().min(1, "Informe o nome do tomador.").max(200, "Nome muito longo."),
  document: z.string().transform((value) => normalizeCnpj(value)).refine(validateTaxDocument, "CPF ou CNPJ inválido."),
  address: z
    .object({
      street: optionalText(255),
      number: optionalText(60),
      complement: optionalText(156),
      district: optionalText(60),
      city: optionalText(100),
      state: optionalText(2),
      zipCode: optionalText(9),
    })
    .nullable(),
  active: z.boolean(),
});

export async function saveTaker(input: z.input<typeof takerSchema>): Promise<ActionResult<{ takerId: string }>> {
  const parsed = takerSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Tomador inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    saveClientNfseTaker(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data }),
  );
  if (result.ok) revalidateClan();
  return result;
}

export async function deleteTaker(input: z.input<ReturnType<typeof idSchema>>): Promise<ActionResult> {
  const parsed = idSchema("Tomador inválido.").safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, (tx, ctx) =>
    deleteClientNfseTaker(tx, { orgId: ctx.orgId, actorId: ctx.userId, takerId: parsed.data.id }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const lookupSchema = z.object({
  clanId: clan,
  cnpj: z.string().transform((value) => normalizeCnpj(value)).refine(validateCnpj, "CNPJ inválido."),
});

/** Nome e endereço do tomador pela consulta pública de CNPJ. */
export async function lookupTakerCnpj(
  input: z.input<typeof lookupSchema>,
): Promise<ActionResult<{ name: string; address: CnpjAddress | null }>> {
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "CNPJ inválido.");
  const allowed = await asFiscalOperator(parsed.data.clanId, async () => ({ ok: true }));
  if (!allowed.ok) return allowed;
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

const digits = (length: number, label: string) => z.string().regex(new RegExp(`^\\d{${length}}$`), `${label} deve ter ${length} dígitos.`);

const modelSchema = z.object({
  clanId: clan,
  issuerId: z.uuid("Empresa inválida."),
  modelId: z.uuid().nullable(),
  takerId: z.uuid("Escolha o tomador."),
  amount: money,
  description,
  reference: z.enum(CLIENT_NFSE_REFERENCES),
  service: z
    .object({
      nationalTaxCode: digits(6, "O código de tributação nacional"),
      municipalTaxCode: digits(3, "O código municipal").optional(),
      nbsCode: digits(9, "O código NBS").optional(),
    })
    .nullable(),
  active: z.boolean(),
});

export async function saveModel(input: z.input<typeof modelSchema>): Promise<ActionResult<{ modelId: string }>> {
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Nota padrão inválida.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    saveClientNfseModel(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data }),
  );
  if (result.ok) revalidateClan();
  return result;
}

export async function deleteModel(input: z.input<ReturnType<typeof idSchema>>): Promise<ActionResult> {
  const parsed = idSchema("Nota padrão inválida.").safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, (tx, ctx) =>
    deleteClientNfseModel(tx, { orgId: ctx.orgId, actorId: ctx.userId, modelId: parsed.data.id }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const periodSchema = z.object({
  clanId: clan,
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export async function openMonth(input: z.input<typeof periodSchema>): Promise<ActionResult<{ created: number; existing: number }>> {
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Período inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    openClientNfseMonth(tx, { orgId: ctx.orgId, actorId: ctx.userId, year: data.year, month: data.month }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const itemSchema = z.object({ clanId: clan, itemId: z.uuid("Nota inválida."), amount: money, description });

export async function updateItem(input: z.input<typeof itemSchema>): Promise<ActionResult> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Nota inválida.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    updateClientNfseItem(tx, { orgId: ctx.orgId, actorId: ctx.userId, itemId: data.itemId, amount: data.amount, description: data.description }),
  );
  if (result.ok) revalidateClan();
  return result;
}

export async function removeItem(input: z.input<ReturnType<typeof idSchema>>): Promise<ActionResult> {
  const parsed = idSchema("Nota inválida.").safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, (tx, ctx) =>
    removeClientNfseItem(tx, { orgId: ctx.orgId, actorId: ctx.userId, itemId: parsed.data.id }),
  );
  if (result.ok) revalidateClan();
  return result;
}

export async function previewEmission(input: z.input<typeof periodSchema>): Promise<ActionResult<ClientNfseBatch>> {
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Período inválido.");
  const data = parsed.data;
  return asFiscalOperator(data.clanId, async (tx, ctx) => ({
    ok: true,
    data: await loadClientNfsePreview(tx, { orgId: ctx.orgId, year: data.year, month: data.month, now: new Date() }),
  }));
}

const emitSchema = periodSchema.extend({
  selected: z.array(z.uuid()).min(1, "Marque ao menos uma nota para emitir.").max(2000),
  expectedCount: z.number().int().min(1).max(2000),
  expectedTotalCents: z.number().int().min(1),
});

export async function emitBatch(input: z.input<typeof emitSchema>): Promise<ActionResult<{ queued: number }>> {
  const parsed = emitSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const now = new Date();
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    enqueueClientNfseBatch(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data, today: nfseToday(now), now }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const cancelSchema = z.object({
  clanId: clan,
  invoiceId: z.uuid("Nota inválida."),
  reasonCode: z.union([z.literal(1), z.literal(2), z.literal(9)]),
  reasonText: z
    .string()
    .trim()
    .min(NFSE_CANCEL_TEXT_MIN, `Explique o motivo com pelo menos ${NFSE_CANCEL_TEXT_MIN} caracteres.`)
    .max(NFSE_CANCEL_TEXT_MAX, `O motivo pode ter no máximo ${NFSE_CANCEL_TEXT_MAX} caracteres.`),
});

export async function cancelInvoice(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    requestClientNfseCancel(tx, { orgId: ctx.orgId, actorId: ctx.userId, invoiceId: data.invoiceId, reasonCode: data.reasonCode, reasonText: data.reasonText }),
  );
  if (result.ok) revalidateClan();
  return result;
}

export async function retryInvoice(input: z.input<ReturnType<typeof idSchema>>): Promise<ActionResult> {
  const parsed = idSchema("Nota inválida.").safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, (tx, ctx) =>
    requeueClientNfseInvoice(tx, { orgId: ctx.orgId, actorId: ctx.userId, invoiceId: parsed.data.id }),
  );
  if (result.ok) revalidateClan();
  return result;
}
