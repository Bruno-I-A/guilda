import "server-only";

import { gunzipSync } from "node:zlib";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { CLIENT_NFSE_EXCLUSION_LABELS, selectClientNfseBatch, type ClientNfseReference } from "@/domain/client-nfse";
import { danfseFileName, type NfseClientAddress, type NfseInvoiceStatus } from "@/domain/nfse";
import { ibgeCity, ibgeCityCode } from "@/lib/nfse/municipios";
import { parseNfseIssuerTemplate, type NfseIssuerTemplate } from "@/lib/nfse/template";

import { readIssuedNoteFacts, type IssuedNoteFacts } from "./from-xml";
import { loadClientNfseMonthRows, loadIssuerReadiness } from "./month";
import type { ServiceOverride } from "./registry";
import { freeDpsSeries, suggestFromIssuedNotes, type IssuerSuggestion } from "./suggest";

/** Leituras da aba Notas dos clientes: uma tela só, empresas com as notas do mês. */

export interface ClientNfseInvoiceView {
  id: string;
  status: NfseInvoiceStatus;
  nfseNumber: string | null;
  issuedAt: string | null;
  lastError: string | null;
  dpsSeries: string;
  dpsNumber: number;
}

/** Uma nota do mês: a nota padrão com o que este mês tem de próprio. */
export interface ClientNfseNoteView {
  modelId: string;
  /** Ajustada ou pedida neste mês (sem isso, o valor e o texto são os do padrão). */
  itemId: string | null;
  takerId: string;
  takerName: string;
  takerDocument: string;
  takerAddress: NfseClientAddress | null;
  amount: string;
  description: string;
  /** A nota padrão, para editar: valor, texto com {mes}, referência e serviço. */
  model: {
    amount: string;
    description: string;
    reference: ClientNfseReference;
    service: ServiceOverride | null;
    active: boolean;
  };
  /** A nota mais recente deste mês (a cancelada fica visível até sair outra). */
  invoice: ClientNfseInvoiceView | null;
  /** Por que não pode sair agora (sem nota ativa). */
  blocked: string | null;
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
  /** "Getúlio Vargas/RS", para o resumo dos dados fiscais. */
  cityLabel: string | null;
  problem: string | null;
  notes: ClientNfseNoteView[];
}

/** Nome do município do código IBGE, para a tela não carregar a tabela inteira. */
function cityLabelOf(code: string | undefined | null): string | null {
  const city = code ? ibgeCity(code) : null;
  return city ? `${city.name}/${city.state}` : null;
}

export interface ClientNfseCandidateView {
  clientId: string;
  name: string;
  cnpj: string;
  certificate: "valid" | "pending" | "invalid" | "missing";
  /** Sugestão do modelo fiscal sem nota guardada: município pelo endereço e regime pelo da empresa. */
  suggestion: { cityCode: string | null; simples: boolean };
}

export async function loadClientNfseWorkspace(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; now: Date },
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
  const rows = await loadClientNfseMonthRows(tx, input);
  const blocked = new Map(
    selectClientNfseBatch(rows).excluded
      .filter((item) => item.reason !== "already_active")
      .map((item) => [item.modelId, item.detail ?? CLIENT_NFSE_EXCLUSION_LABELS[item.reason]]),
  );
  const m = schema.clientNfseModels;
  const models = rows.length
    ? await tx.select().from(m).where(and(eq(m.orgId, input.orgId), inArray(m.id, rows.map((row) => row.modelId))))
    : [];
  const modelById = new Map(models.map((model) => [model.id, model]));
  const tk = schema.clientNfseTakers;
  const takers = rows.length
    ? await tx.select({ id: tk.id, address: tk.address }).from(tk).where(and(eq(tk.orgId, input.orgId), inArray(tk.id, rows.map((row) => row.takerId))))
    : [];
  const addressByTaker = new Map(takers.map((taker) => [taker.id, taker.address]));
  const itemIds = rows.flatMap((row) => (row.itemId ? [row.itemId] : []));
  const n = schema.clientNfseInvoices;
  const invoices = itemIds.length
    ? await tx
        .select({ id: n.id, itemId: n.itemId, status: n.status, nfseNumber: n.nfseNumber, issuedAt: n.issuedAt, lastError: n.lastError, dpsSeries: n.dpsSeries, dpsNumber: n.dpsNumber })
        .from(n)
        .where(and(eq(n.orgId, input.orgId), inArray(n.itemId, itemIds)))
        .orderBy(desc(n.createdAt))
    : [];
  const latest = new Map<string, (typeof invoices)[number]>();
  for (const invoice of invoices) if (!latest.has(invoice.itemId)) latest.set(invoice.itemId, invoice);

  const notesByIssuer = new Map<string, ClientNfseNoteView[]>();
  for (const row of rows) {
    const model = modelById.get(row.modelId);
    if (!model) continue;
    const invoice = row.itemId ? latest.get(row.itemId) : undefined;
    const list = notesByIssuer.get(row.issuerId) ?? [];
    list.push({
      modelId: row.modelId,
      itemId: row.itemId,
      takerId: row.takerId,
      takerName: row.takerName,
      takerDocument: row.takerDocument,
      takerAddress: addressByTaker.get(row.takerId) ?? null,
      amount: row.amount,
      description: row.description,
      model: { amount: model.amount, description: model.description, reference: model.reference, service: model.service, active: model.active },
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
      blocked: blocked.get(row.modelId) ?? null,
    });
    notesByIssuer.set(row.issuerId, list);
  }

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
      cityLabel: cityLabelOf(parseNfseIssuerTemplate(issuer.template)?.cityCode),
      problem: readiness.get(issuer.id)?.problem ?? null,
      notes: notesByIssuer.get(issuer.id) ?? [],
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
export type IssuerSuggestionView = IssuerSuggestion & { cityLabel: string | null };

export async function loadIssuerSuggestion(
  tx: OrgTx,
  input: { orgId: string; clientId: string; issuerId: string | null; now: Date },
): Promise<IssuerSuggestionView> {
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
  return {
    ...suggestion,
    dpsSeries: freeDpsSeries([...facts.map((fact) => fact.series), ...olderSeries]),
    cityLabel: cityLabelOf(suggestion.template?.cityCode),
  };
}
