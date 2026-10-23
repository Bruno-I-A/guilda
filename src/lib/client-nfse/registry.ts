import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { validateTaxDocument } from "@/domain/cnpj";
import type { ClientNfseReference } from "@/domain/client-nfse";
import { normalizeDpsSeries } from "@/domain/nfse";
import { err, type ActionResult } from "@/lib/action-context";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";

/**
 * Cadastro das notas dos clientes: a empresa emissora, os tomadores dela e as
 * notas padrão. Quem chama já conferiu sessão e permissão (asFiscalOperator).
 * Apagar só vale sem nota pedida: a nota aponta para o cadastro sem cascata,
 * então o banco recusaria de qualquer forma; aqui a mensagem sai certa.
 */

type Actor = { orgId: string; actorId: string };

export type AddressInput = {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
};

function cleanAddress(address: AddressInput | null): AddressInput | null {
  if (!address) return null;
  const text = (value: string | null) => value?.replace(/\s+/g, " ").trim() || null;
  const clean = {
    street: text(address.street),
    number: text(address.number),
    complement: text(address.complement),
    district: text(address.district),
    city: text(address.city),
    state: text(address.state)?.toUpperCase() ?? null,
    zipCode: address.zipCode?.replace(/\D/g, "") || null,
  };
  return Object.values(clean).some(Boolean) ? clean : null;
}

async function hasInvoice(tx: OrgTx, orgId: string, column: "issuerId" | "takerId", id: string): Promise<boolean> {
  const t = schema.clientNfseInvoices;
  const [row] = await tx.select({ id: t.id }).from(t).where(and(eq(t.orgId, orgId), eq(t[column], id))).limit(1);
  return Boolean(row);
}

async function modelHasInvoice(tx: OrgTx, orgId: string, modelId: string): Promise<boolean> {
  const i = schema.clientNfseItems;
  const n = schema.clientNfseInvoices;
  const [row] = await tx
    .select({ id: n.id })
    .from(n)
    .innerJoin(i, and(eq(i.orgId, n.orgId), eq(i.id, n.itemId)))
    .where(and(eq(n.orgId, orgId), eq(i.modelId, modelId)))
    .limit(1);
  return Boolean(row);
}

export async function saveClientNfseIssuer(
  tx: OrgTx,
  input: Actor & {
    issuerId: string | null;
    clientId: string;
    template: NfseIssuerTemplate;
    dpsSeries: string;
    active: boolean;
  },
): Promise<ActionResult<{ issuerId: string }>> {
  let series: string;
  try {
    series = normalizeDpsSeries(input.dpsSeries);
  } catch (error) {
    return err(error instanceof Error ? error.message : "Série inválida.");
  }
  const values = { template: input.template, dpsSeries: series, active: input.active, updatedBy: input.actorId, updatedAt: new Date() };
  const t = schema.clientNfseIssuers;
  if (input.issuerId) {
    const [updated] = await tx
      .update(t)
      .set(values)
      .where(and(eq(t.orgId, input.orgId), eq(t.id, input.issuerId)))
      .returning({ id: t.id });
    return updated ? { ok: true, data: { issuerId: updated.id } } : err("Empresa emissora não encontrada.");
  }
  const [client] = await tx
    .select({ id: schema.clients.id, cnpj: schema.clients.cnpj, taxRegime: schema.clients.taxRegime, active: schema.clients.active })
    .from(schema.clients)
    .where(and(eq(schema.clients.orgId, input.orgId), eq(schema.clients.id, input.clientId)));
  if (!client) return err("Empresa não encontrada.");
  if (client.taxRegime === "mei") return err("MEI não emite pela aba Notas dos clientes.");
  if (!client.cnpj) return err("A empresa precisa ter CNPJ no cadastro para emitir.");
  if (!client.active) return err("A empresa está inativa.");
  const [created] = await tx
    .insert(t)
    .values({ orgId: input.orgId, clientId: client.id, ...values, createdBy: input.actorId })
    .onConflictDoNothing({ target: [t.orgId, t.clientId] })
    .returning({ id: t.id });
  return created ? { ok: true, data: { issuerId: created.id } } : err("Esta empresa já está nas Notas dos clientes.");
}

export async function deleteClientNfseIssuer(tx: OrgTx, input: Actor & { issuerId: string }): Promise<ActionResult> {
  if (await hasInvoice(tx, input.orgId, "issuerId", input.issuerId)) {
    return err("Esta empresa já tem nota pedida pela Guilda. Desative em vez de apagar.");
  }
  const t = schema.clientNfseIssuers;
  const [deleted] = await tx
    .delete(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.issuerId)))
    .returning({ id: t.id });
  return deleted ? { ok: true } : err("Empresa emissora não encontrada.");
}

export async function saveClientNfseTaker(
  tx: OrgTx,
  input: Actor & {
    issuerId: string;
    takerId: string | null;
    name: string;
    document: string;
    address: AddressInput | null;
    active: boolean;
  },
): Promise<ActionResult<{ takerId: string }>> {
  if (!validateTaxDocument(input.document)) return err("CPF ou CNPJ inválido.");
  const t = schema.clientNfseTakers;
  const [duplicate] = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.issuerId, input.issuerId), eq(t.document, input.document)))
    .limit(1);
  if (duplicate && duplicate.id !== input.takerId) return err("Esta empresa já tem um tomador com este CPF/CNPJ.");
  const values = {
    name: input.name.replace(/\s+/g, " ").trim(),
    document: input.document,
    address: cleanAddress(input.address),
    active: input.active,
    updatedBy: input.actorId,
    updatedAt: new Date(),
  };
  if (input.takerId) {
    const [updated] = await tx
      .update(t)
      .set(values)
      .where(and(eq(t.orgId, input.orgId), eq(t.issuerId, input.issuerId), eq(t.id, input.takerId)))
      .returning({ id: t.id });
    return updated ? { ok: true, data: { takerId: updated.id } } : err("Tomador não encontrado.");
  }
  const [issuer] = await tx
    .select({ id: schema.clientNfseIssuers.id })
    .from(schema.clientNfseIssuers)
    .where(and(eq(schema.clientNfseIssuers.orgId, input.orgId), eq(schema.clientNfseIssuers.id, input.issuerId)));
  if (!issuer) return err("Empresa emissora não encontrada.");
  const [created] = await tx
    .insert(t)
    .values({ orgId: input.orgId, issuerId: issuer.id, ...values, createdBy: input.actorId })
    .returning({ id: t.id });
  return { ok: true, data: { takerId: created.id } };
}

export async function deleteClientNfseTaker(tx: OrgTx, input: Actor & { takerId: string }): Promise<ActionResult> {
  if (await hasInvoice(tx, input.orgId, "takerId", input.takerId)) {
    return err("Este tomador já tem nota pedida pela Guilda. Desative em vez de apagar.");
  }
  const t = schema.clientNfseTakers;
  const [deleted] = await tx
    .delete(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.takerId)))
    .returning({ id: t.id });
  return deleted ? { ok: true } : err("Tomador não encontrado.");
}

export type ServiceOverride = { nationalTaxCode: string; municipalTaxCode?: string; nbsCode?: string };

export async function saveClientNfseModel(
  tx: OrgTx,
  input: Actor & {
    issuerId: string;
    modelId: string | null;
    takerId: string;
    amount: string;
    description: string;
    reference: ClientNfseReference;
    service: ServiceOverride | null;
    active: boolean;
  },
): Promise<ActionResult<{ modelId: string }>> {
  const takers = schema.clientNfseTakers;
  const [taker] = await tx
    .select({ id: takers.id })
    .from(takers)
    .where(and(eq(takers.orgId, input.orgId), eq(takers.issuerId, input.issuerId), eq(takers.id, input.takerId)));
  if (!taker) return err("Escolha um tomador desta empresa.");
  const values = {
    takerId: taker.id,
    amount: input.amount,
    description: input.description.trim(),
    reference: input.reference,
    service: input.service,
    active: input.active,
    updatedBy: input.actorId,
    updatedAt: new Date(),
  };
  const t = schema.clientNfseModels;
  if (input.modelId) {
    const [updated] = await tx
      .update(t)
      .set(values)
      .where(and(eq(t.orgId, input.orgId), eq(t.issuerId, input.issuerId), eq(t.id, input.modelId)))
      .returning({ id: t.id });
    return updated ? { ok: true, data: { modelId: updated.id } } : err("Nota padrão não encontrada.");
  }
  const [created] = await tx
    .insert(t)
    .values({ orgId: input.orgId, issuerId: input.issuerId, ...values, createdBy: input.actorId })
    .returning({ id: t.id });
  return { ok: true, data: { modelId: created.id } };
}

export async function deleteClientNfseModel(tx: OrgTx, input: Actor & { modelId: string }): Promise<ActionResult> {
  if (await modelHasInvoice(tx, input.orgId, input.modelId)) {
    return err("Esta nota padrão já gerou nota pela Guilda. Pause em vez de apagar.");
  }
  const t = schema.clientNfseModels;
  const [deleted] = await tx
    .delete(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.modelId)))
    .returning({ id: t.id });
  return deleted ? { ok: true } : err("Nota padrão não encontrada.");
}

export interface SuggestedModelInput {
  takerDocument: string;
  takerName: string;
  address: AddressInput | null;
  amount: string;
  description: string;
  reference: ClientNfseReference;
}

/**
 * Grava as notas padrão que o Fiscal marcou entre as sugestões tiradas das
 * notas já emitidas. O tomador é reaproveitado pelo CPF/CNPJ; o que faltar,
 * nasce com nome e endereço da nota.
 */
export async function importClientNfseSuggestions(
  tx: OrgTx,
  input: Actor & { issuerId: string; items: readonly SuggestedModelInput[] },
): Promise<ActionResult<{ takers: number; models: number }>> {
  const issuers = schema.clientNfseIssuers;
  const [issuer] = await tx
    .select({ id: issuers.id })
    .from(issuers)
    .where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, input.issuerId)))
    .for("update");
  if (!issuer) return err("Empresa emissora não encontrada.");
  const t = schema.clientNfseTakers;
  const current = await tx
    .select({ id: t.id, document: t.document })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.issuerId, issuer.id)));
  const takerByDocument = new Map(current.map((row) => [row.document, row.id]));
  let takers = 0;
  for (const item of input.items) {
    if (!validateTaxDocument(item.takerDocument)) return err(`CPF/CNPJ inválido: ${item.takerName}.`);
    if (takerByDocument.has(item.takerDocument)) continue;
    const [created] = await tx
      .insert(t)
      .values({
        orgId: input.orgId,
        issuerId: issuer.id,
        name: item.takerName.replace(/\s+/g, " ").trim(),
        document: item.takerDocument,
        address: cleanAddress(item.address),
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })
      .returning({ id: t.id });
    takerByDocument.set(item.takerDocument, created.id);
    takers += 1;
  }
  if (input.items.length > 0) {
    await tx.insert(schema.clientNfseModels).values(
      input.items.map((item) => ({
        orgId: input.orgId,
        issuerId: issuer.id,
        takerId: takerByDocument.get(item.takerDocument)!,
        amount: item.amount,
        description: item.description.trim(),
        reference: item.reference,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })),
    );
  }
  return { ok: true, data: { takers, models: input.items.length } };
}

/**
 * Nota padrão com o tomador no mesmo formulário: o tomador é achado pelo
 * CPF/CNPJ dentro da empresa (atualiza nome e endereço) ou nasce aqui.
 */
export async function saveClientNfseNote(
  tx: OrgTx,
  input: Actor & {
    issuerId: string;
    modelId: string | null;
    taker: { document: string; name: string; address: AddressInput | null };
    amount: string;
    description: string;
    reference: ClientNfseReference;
    service: ServiceOverride | null;
    active: boolean;
  },
): Promise<ActionResult<{ modelId: string }>> {
  const t = schema.clientNfseTakers;
  const [existing] = await tx
    .select({ id: t.id, address: t.address })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.issuerId, input.issuerId), eq(t.document, input.taker.document)))
    .limit(1);
  const taker = await saveClientNfseTaker(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    issuerId: input.issuerId,
    takerId: existing?.id ?? null,
    name: input.taker.name,
    document: input.taker.document,
    // Endereço em branco no formulário não apaga o que o tomador já tinha.
    address: cleanAddress(input.taker.address) ?? existing?.address ?? null,
    active: true,
  });
  if (!taker.ok) return taker;
  return saveClientNfseModel(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    issuerId: input.issuerId,
    modelId: input.modelId,
    takerId: taker.data!.takerId,
    amount: input.amount,
    description: input.description,
    reference: input.reference,
    service: input.service,
    active: input.active,
  });
}
