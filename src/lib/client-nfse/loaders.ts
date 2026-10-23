import "server-only";

import { gunzipSync } from "node:zlib";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { ClientNfseReference } from "@/domain/client-nfse";
import { danfseFileName, type NfseClientAddress, type NfseInvoiceStatus } from "@/domain/nfse";
import { ibgeCityCode } from "@/lib/nfse/municipios";
import { parseNfseIssuerTemplate, type NfseIssuerTemplate } from "@/lib/nfse/template";

import { readIssuedNoteFacts, type IssuedNoteFacts } from "./from-xml";
import { loadIssuerReadiness } from "./month";
import type { ServiceOverride } from "./registry";
import { freeDpsSeries, suggestFromIssuedNotes, type IssuerSuggestion } from "./suggest";

/** Leituras da aba Notas dos clientes (Cadastro e Mês a mês). */

export interface ClientNfseTakerView {
  id: string;
  name: string;
  document: string;
  address: NfseClientAddress | null;
  active: boolean;
}

export interface ClientNfseModelView {
  id: string;
  takerId: string;
  takerName: string;
  amount: string;
  description: string;
  reference: ClientNfseReference;
  service: ServiceOverride | null;
  active: boolean;
}

export interface ClientNfseIssuerView {
  id: string;
  clientId: string;
  name: string;
  cnpj: string | null;
  active: boolean;
  dpsSeries: string;
  nextDpsNumber: number;
  /** O modelo guardado, mesmo incompleto, para editar. */
  template: NfseIssuerTemplate | null;
  problem: string | null;
  takers: ClientNfseTakerView[];
  models: ClientNfseModelView[];
}

export interface ClientNfseCandidateView {
  clientId: string;
  name: string;
  cnpj: string;
  certificate: "valid" | "pending" | "invalid" | "missing";
  /** Sugestão do modelo fiscal: município pelo endereço e regime pelo da empresa. */
  suggestion: { cityCode: string | null; simples: boolean };
}

export async function loadClientNfseRegistry(
  tx: OrgTx,
  input: { orgId: string; now: Date },
): Promise<{ issuers: ClientNfseIssuerView[]; candidates: ClientNfseCandidateView[] }> {
  const i = schema.clientNfseIssuers;
  const c = schema.clients;
  const issuers = await tx
    .select({ id: i.id, clientId: i.clientId, name: c.name, cnpj: c.cnpj, active: i.active, dpsSeries: i.dpsSeries, nextDpsNumber: i.nextDpsNumber, template: i.template })
    .from(i)
    .innerJoin(c, and(eq(c.orgId, i.orgId), eq(c.id, i.clientId)))
    .where(eq(i.orgId, input.orgId))
    .orderBy(asc(c.name));
  const readiness = await loadIssuerReadiness(tx, { orgId: input.orgId, now: input.now });
  const takers = await tx
    .select()
    .from(schema.clientNfseTakers)
    .where(eq(schema.clientNfseTakers.orgId, input.orgId))
    .orderBy(asc(schema.clientNfseTakers.name));
  const m = schema.clientNfseModels;
  const models = await tx.select().from(m).where(eq(m.orgId, input.orgId)).orderBy(asc(m.createdAt));
  const takerName = new Map(takers.map((taker) => [taker.id, taker.name]));

  const cert = schema.nfseClientCertificates;
  const candidates = await tx
    .select({ clientId: c.id, name: c.name, cnpj: c.cnpj, taxRegime: c.taxRegime, address: c.address, certStatus: cert.status })
    .from(c)
    .leftJoin(cert, and(eq(cert.orgId, c.orgId), eq(cert.clientId, c.id)))
    .where(and(eq(c.orgId, input.orgId), eq(c.active, true), ne(c.taxRegime, "mei"), isNotNull(c.cnpj)))
    .orderBy(asc(c.name));
  const taken = new Set(issuers.map((issuer) => issuer.clientId));

  return {
    issuers: issuers.map((issuer) => ({
      id: issuer.id,
      clientId: issuer.clientId,
      name: issuer.name,
      cnpj: issuer.cnpj,
      active: issuer.active,
      dpsSeries: issuer.dpsSeries,
      nextDpsNumber: issuer.nextDpsNumber,
      template: parseNfseIssuerTemplate(issuer.template),
      problem: readiness.get(issuer.id)?.problem ?? null,
      takers: takers
        .filter((taker) => taker.issuerId === issuer.id)
        .map((taker) => ({ id: taker.id, name: taker.name, document: taker.document, address: taker.address, active: taker.active })),
      models: models
        .filter((model) => model.issuerId === issuer.id)
        .map((model) => ({
          id: model.id,
          takerId: model.takerId,
          takerName: takerName.get(model.takerId) ?? "",
          amount: model.amount,
          description: model.description,
          reference: model.reference,
          service: model.service,
          active: model.active,
        })),
    })),
    candidates: candidates
      .filter((row) => !taken.has(row.clientId))
      .map((row) => {
        const address = row.address as NfseClientAddress | null;
        return {
          clientId: row.clientId,
          name: row.name,
          cnpj: row.cnpj!,
          certificate: row.certStatus ?? "missing",
          suggestion: {
            cityCode: address?.state && address.city ? ibgeCityCode(address.state, address.city) : null,
            simples: row.taxRegime === "simples",
          },
        };
      }),
  };
}

export interface ClientNfseInvoiceView {
  id: string;
  status: NfseInvoiceStatus;
  nfseNumber: string | null;
  issuedAt: string | null;
  lastError: string | null;
  dpsSeries: string;
  dpsNumber: number;
}

export interface ClientNfseMonthItemView {
  itemId: string;
  takerName: string;
  takerDocument: string;
  amount: string;
  description: string;
  /** A nota mais recente deste item (a cancelada fica visível até sair outra). */
  invoice: ClientNfseInvoiceView | null;
}

export interface ClientNfseMonthIssuerView {
  issuerId: string;
  name: string;
  cnpj: string | null;
  problem: string | null;
  items: ClientNfseMonthItemView[];
}

export async function loadClientNfseMonth(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; now: Date },
): Promise<{ activeModels: number; issuers: ClientNfseMonthIssuerView[] }> {
  const it = schema.clientNfseItems;
  const tk = schema.clientNfseTakers;
  const items = await tx
    .select({ itemId: it.id, issuerId: it.issuerId, amount: it.amount, description: it.description, takerName: tk.name, takerDocument: tk.document })
    .from(it)
    .innerJoin(tk, and(eq(tk.orgId, it.orgId), eq(tk.id, it.takerId)))
    .where(and(eq(it.orgId, input.orgId), eq(it.periodYear, input.year), eq(it.periodMonth, input.month)))
    .orderBy(asc(tk.name), asc(it.createdAt));
  const n = schema.clientNfseInvoices;
  const invoices = items.length
    ? await tx
        .select({ id: n.id, itemId: n.itemId, status: n.status, nfseNumber: n.nfseNumber, issuedAt: n.issuedAt, lastError: n.lastError, dpsSeries: n.dpsSeries, dpsNumber: n.dpsNumber })
        .from(n)
        .where(and(eq(n.orgId, input.orgId), inArray(n.itemId, items.map((item) => item.itemId))))
        .orderBy(desc(n.createdAt))
    : [];
  const latest = new Map<string, (typeof invoices)[number]>();
  for (const invoice of invoices) if (!latest.has(invoice.itemId)) latest.set(invoice.itemId, invoice);
  const m = schema.clientNfseModels;
  const i = schema.clientNfseIssuers;
  const activeModels = (
    await tx
      .select({ id: m.id })
      .from(m)
      .innerJoin(i, and(eq(i.orgId, m.orgId), eq(i.id, m.issuerId)))
      .where(and(eq(m.orgId, input.orgId), eq(m.active, true), eq(i.active, true)))
  ).length;
  const readiness = await loadIssuerReadiness(tx, { orgId: input.orgId, now: input.now });
  const groups = new Map<string, ClientNfseMonthIssuerView>();
  for (const item of items) {
    const issuer = readiness.get(item.issuerId);
    const group = groups.get(item.issuerId) ?? {
      issuerId: item.issuerId,
      name: issuer?.name ?? "",
      cnpj: issuer?.cnpj ?? null,
      problem: issuer?.problem ?? null,
      items: [],
    };
    const invoice = latest.get(item.itemId);
    group.items.push({
      itemId: item.itemId,
      takerName: item.takerName,
      takerDocument: item.takerDocument,
      amount: item.amount,
      description: item.description,
      invoice: invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            nfseNumber: invoice.nfseNumber,
            issuedAt: invoice.issuedAt?.toISOString() ?? null,
            lastError: invoice.lastError,
            dpsSeries: invoice.dpsSeries,
            dpsNumber: invoice.dpsNumber,
          }
        : null,
    });
    groups.set(item.issuerId, group);
  }
  return { activeModels, issuers: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) };
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * O XML das notas emitidas do mês (de uma empresa ou de uma nota), para o
 * PDF. Guardado na emissão; se faltou, vem da pasta de XML da empresa.
 */
export async function loadClientDanfseXml(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; issuerId?: string; invoiceId?: string },
): Promise<{ fileName: string; xml: string | null }[]> {
  const n = schema.clientNfseInvoices;
  const c = schema.clients;
  const rows = await tx
    .select({ accessKey: n.accessKey, nfseNumber: n.nfseNumber, dpsNumber: n.dpsNumber, takerName: n.takerName, issuerName: c.name, xmlGz: n.xmlGz })
    .from(n)
    .innerJoin(c, and(eq(c.orgId, n.orgId), eq(c.id, n.clientId)))
    .where(
      and(
        eq(n.orgId, input.orgId),
        eq(n.periodYear, input.year),
        eq(n.periodMonth, input.month),
        eq(n.status, "issued"),
        input.issuerId ? eq(n.issuerId, input.issuerId) : undefined,
        input.invoiceId ? eq(n.id, input.invoiceId) : undefined,
      ),
    )
    .orderBy(asc(c.name), asc(n.takerName));
  const missing = rows.filter((row) => !row.xmlGz && row.accessKey).map((row) => row.accessKey!);
  const stored = missing.length
    ? await tx
        .select({ accessKey: schema.nfseIssuedNotes.accessKey, xmlGz: schema.nfseIssuedNotes.xmlGz })
        .from(schema.nfseIssuedNotes)
        .where(and(eq(schema.nfseIssuedNotes.orgId, input.orgId), inArray(schema.nfseIssuedNotes.accessKey, missing)))
    : [];
  const fromFolder = new Map(stored.map((row) => [row.accessKey, row.xmlGz]));
  const single = rows.length === 1;
  const used = new Set<string>();
  return rows.map((row) => {
    const gz = row.xmlGz ?? (row.accessKey ? fromFolder.get(row.accessKey) : undefined);
    let fileName = danfseFileName({ nfseNumber: row.nfseNumber, dpsNumber: row.dpsNumber, takerName: row.takerName });
    if (!single) fileName = `${slug(row.issuerName) || "empresa"}/${fileName}`;
    if (used.has(fileName)) fileName = fileName.replace(/\.pdf$/, `-${row.dpsNumber}.pdf`);
    used.add(fileName);
    return { fileName, xml: gz ? gunzipSync(Buffer.from(gz)).toString("utf8") : null };
  });
}

/** Janela das notas lidas para sugerir o cadastro: o último mês e o anterior, com folga. */
const SUGGESTION_WINDOW_DAYS = 75;

/**
 * Sugestão do cadastro a partir das notas que a rotina da aba XML já guardou
 * desta empresa. As recentes dão o modelo fiscal e as notas padrão; uma nota
 * por mês do histórico inteiro diz que séries de DPS ela já usou.
 */
export async function loadIssuerSuggestion(
  tx: OrgTx,
  input: { orgId: string; clientId: string; issuerId: string | null; now: Date },
): Promise<IssuerSuggestion> {
  const n = schema.nfseIssuedNotes;
  const since = new Date(input.now.getTime() - SUGGESTION_WINDOW_DAYS * 86_400_000);
  const recent = await tx
    .select({ xmlGz: n.xmlGz })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), eq(n.clientId, input.clientId), isNull(n.cancelledAt), gte(n.issuedAt, since)))
    .orderBy(desc(n.issuedAt))
    .limit(600);
  const monthly = await tx.execute<{ xml_gz: Uint8Array }>(sql`
    SELECT DISTINCT ON (date_trunc('month', issued_at)) xml_gz
      FROM nfse_issued_notes
     WHERE org_id = ${input.orgId} AND client_id = ${input.clientId} AND issued_at < ${since.toISOString()}::timestamptz
     ORDER BY date_trunc('month', issued_at), issued_at DESC
  `);
  const read = (gz: Uint8Array) => readIssuedNoteFacts(gunzipSync(Buffer.from(gz)).toString("utf8"));
  const facts = recent.map((row) => read(row.xmlGz)).filter((fact): fact is IssuedNoteFacts => Boolean(fact));
  const olderSeries = monthly.rows.map((row) => read(row.xml_gz)?.series ?? null);
  let existing: { takerDocument: string; description: string }[] = [];
  if (input.issuerId) {
    existing = await tx
      .select({ takerDocument: schema.clientNfseTakers.document, description: schema.clientNfseModels.description })
      .from(schema.clientNfseModels)
      .innerJoin(schema.clientNfseTakers, and(eq(schema.clientNfseTakers.orgId, schema.clientNfseModels.orgId), eq(schema.clientNfseTakers.id, schema.clientNfseModels.takerId)))
      .where(and(eq(schema.clientNfseModels.orgId, input.orgId), eq(schema.clientNfseModels.issuerId, input.issuerId)));
  }
  const suggestion = suggestFromIssuedNotes(facts, { models: existing });
  return { ...suggestion, dpsSeries: freeDpsSeries([...facts.map((fact) => fact.series), ...olderSeries]) };
}
