"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { normalizeCnpj, validateCnpj, validateTaxDocument } from "@/domain/cnpj";
import { CLIENT_NFSE_REFERENCES } from "@/domain/client-nfse";
import { NFSE_CANCEL_TEXT_MAX, NFSE_CANCEL_TEXT_MIN } from "@/domain/nfse";
import { err, type ActionResult } from "@/lib/action-context";
import { loadIssuerSuggestion, type IssuerSuggestionView } from "@/lib/client-nfse/loaders";
import {
  adjustClientNfseMonthNote,
  enqueueClientNfseBatch,
  requestClientNfseCancel,
  requeueClientNfseInvoice,
} from "@/lib/client-nfse/month";
import {
  deleteClientNfseIssuer,
  deleteClientNfseModel,
  importClientNfseSuggestions,
  saveClientNfseIssuer,
  saveClientNfseNote,
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
const document = z.string().transform((value) => normalizeCnpj(value)).refine(validateTaxDocument, "CPF ou CNPJ inválido.");
const address = z
  .object({
    street: optionalText(255),
    number: optionalText(60),
    complement: optionalText(156),
    district: optionalText(60),
    city: optionalText(100),
    state: optionalText(2),
    zipCode: optionalText(9),
  })
  .nullable();
const suggestedNote = z.object({
  takerDocument: document,
  takerName: z.string().trim().min(1).max(200),
  address,
  amount: money,
  description,
  reference: z.enum(CLIENT_NFSE_REFERENCES),
});
const idSchema = (label: string) => z.object({ clanId: clan, id: z.uuid(label) });

const issuerSchema = z.object({
  clanId: clan,
  issuerId: z.uuid().nullable(),
  clientId: z.uuid("Escolha a empresa."),
  template: nfseIssuerTemplateRulesSchema,
  dpsSeries: z.string().trim(),
  active: z.boolean(),
  /** Empresa nova: as notas padrão marcadas entre as tiradas das notas emitidas. */
  notes: z.array(suggestedNote).max(1000).default([]),
});

export async function saveIssuer(
  input: z.input<typeof issuerSchema>,
): Promise<ActionResult<{ issuerId: string; notes: number }>> {
  const parsed = issuerSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados fiscais inválidos.");
  const { notes, ...data } = parsed.data;
  const result = await asFiscalOperator(data.clanId, async (tx, ctx) => {
    const saved = await saveClientNfseIssuer(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data });
    if (!saved.ok) return saved;
    const issuerId = saved.data!.issuerId;
    if (data.issuerId || notes.length === 0) return { ok: true, data: { issuerId, notes: 0 } };
    const imported = await importClientNfseSuggestions(tx, { orgId: ctx.orgId, actorId: ctx.userId, issuerId, items: notes });
    if (!imported.ok) return imported;
    return { ok: true, data: { issuerId, notes: imported.data!.models } };
  });
  if (result.ok) revalidateClan();
  return result;
}

export async function deleteIssuer(input: z.input<ReturnType<typeof idSchema>>): Promise<ActionResult> {
  const parsed = idSchema("Empresa inválida.").safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const result = await asFiscalOperator(parsed.data.clanId, (tx, ctx) =>
    deleteClientNfseIssuer(tx, { orgId: ctx.orgId, actorId: ctx.userId, issuerId: parsed.data.id }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const suggestSchema = z.object({ clanId: clan, clientId: z.uuid("Empresa inválida."), issuerId: z.uuid().nullable() });

/** Dados fiscais, série livre e notas padrão sugeridos pelas notas que a empresa já emitiu. */
export async function suggestIssuerSetup(input: z.input<typeof suggestSchema>): Promise<ActionResult<IssuerSuggestionView>> {
  const parsed = suggestSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Pedido inválido.");
  const data = parsed.data;
  return asFiscalOperator(data.clanId, async (tx, ctx) => ({
    ok: true,
    data: await loadIssuerSuggestion(tx, { orgId: ctx.orgId, clientId: data.clientId, issuerId: data.issuerId, now: new Date() }),
  }));
}

const importSchema = z.object({
  clanId: clan,
  issuerId: z.uuid("Empresa inválida."),
  items: z.array(suggestedNote).min(1, "Marque ao menos uma nota.").max(1000),
});

export async function importSuggestions(input: z.input<typeof importSchema>): Promise<ActionResult<{ takers: number; models: number }>> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Sugestões inválidas.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    importClientNfseSuggestions(tx, { orgId: ctx.orgId, actorId: ctx.userId, issuerId: data.issuerId, items: data.items }),
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

const noteSchema = z.object({
  clanId: clan,
  issuerId: z.uuid("Empresa inválida."),
  modelId: z.uuid().nullable(),
  taker: z.object({ document, name: z.string().trim().min(1, "Informe o nome do tomador.").max(200, "Nome muito longo."), address }),
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

/** Nota padrão e tomador no mesmo formulário. */
export async function saveNote(input: z.input<typeof noteSchema>): Promise<ActionResult<{ modelId: string }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Nota inválida.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    saveClientNfseNote(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data }),
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

const adjustSchema = periodSchema.extend({ modelId: z.uuid("Nota inválida."), amount: money, description });

/** Valor e texto só deste mês; a nota padrão não muda. */
export async function adjustNote(input: z.input<typeof adjustSchema>): Promise<ActionResult> {
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Nota inválida.");
  const data = parsed.data;
  const result = await asFiscalOperator(data.clanId, (tx, ctx) =>
    adjustClientNfseMonthNote(tx, { orgId: ctx.orgId, actorId: ctx.userId, ...data }),
  );
  if (result.ok) revalidateClan();
  return result;
}

const emitSchema = periodSchema.extend({
  /** Notas padrão escolhidas: uma, as de uma empresa ou várias. */
  selected: z.array(z.uuid()).min(1, "Escolha ao menos uma nota para emitir.").max(2000),
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
