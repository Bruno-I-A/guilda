import "server-only";

import { gunzipSync } from "node:zlib";

import { and, eq, gte, inArray, lt, or } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { amountToCents, centsToNfseAmount, type NfseClientAddress } from "@/domain/nfse";
import type { NfseRetentions } from "@/domain/nfse-retentions";
import { err, type ActionResult } from "@/lib/action-context";
import { parseNfseIssuerTemplate } from "@/lib/nfse/template";

import { sourceProblem } from "./emit";
import { loadClientNfseMonthRows } from "./month";
import { buildMonthForecast, type ForecastClaim, type ForecastNote, type ForecastSource } from "./forecast";
import { readIssuedNoteFacts, type IssuedNoteFacts } from "./from-xml";
import type { AddressInput, ServiceOverride } from "./registry";
import { monthOf, previousMonth } from "./suggest";

type Period = { year: number; month: number };
type Actor = { orgId: string; actorId: string };

/** Uma nota prevista, pronta para preencher o formulário de emissão. */
export interface ClientNfseForecastView {
  sourceAccessKey: string;
  takerId: string | null;
  takerDocument: string;
  takerName: string;
  /** O do cadastro do tomador; sem cadastro, o da nota de origem. */
  address: AddressInput | NfseClientAddress | null;
  retentions: NfseRetentions | null;
  /** Decimal canônico ("150.00"): o valor do mês anterior. */
  amount: string;
  description: string;
  service: ServiceOverride | null;
  textNeedsReview: boolean;
  sourceIssuedAt: string;
}

export interface IssuerForecast {
  notes: ClientNfseForecastView[];
  /** "Não emitir este mês": fora da conta, à mão para desfazer. */
  skipped: ClientNfseForecastView[];
  /** A última leitura das notas do Portal: o que saiu lá depois disso ainda não abateu. */
  portalReadAt: string | null;
}

/** O começo do mês em Brasília (UTC-3, sem horário de verão). */
function monthStart(period: Period): Date {
  return new Date(Date.UTC(period.year, period.month - 1, 1, 3));
}

function nextMonth(period: Period): Period {
  return period.month === 12 ? { year: period.year + 1, month: 1 } : { year: period.year, month: period.month + 1 };
}

const samePeriod = (a: Period, b: Period) => a.year === b.year && a.month === b.month;

/** O que a previsão usa de uma nota do Portal. */
type PortalFacts = { taker: NonNullable<IssuedNoteFacts["taker"]>; amountCents: number; description: string | null; service: ServiceOverride | null };

/**
 * O XML de uma nota emitida não muda, e a aba recarrega a cada 5 segundos
 * enquanto há nota na fila: cada nota só é aberta uma vez por processo.
 */
const PORTAL_FACTS_LIMIT = 5000;
const portalFacts = new Map<string, PortalFacts | null>();

function rememberPortalFacts(key: string, xmlGz: Uint8Array): void {
  const facts = readIssuedNoteFacts(gunzipSync(Buffer.from(xmlGz)).toString("utf8"));
  if (portalFacts.size >= PORTAL_FACTS_LIMIT) portalFacts.delete(portalFacts.keys().next().value!);
  portalFacts.set(
    key,
    facts?.taker && facts.amountCents !== null
      ? { taker: facts.taker, amountCents: facts.amountCents, description: facts.description, service: facts.template.service.nationalTaxCode ? facts.template.service : null }
      : null,
  );
}

/**
 * A previsão de cada empresa no mês corrente. Mês passado é só consulta e mês
 * futuro não emite, então nos outros meses não há previsão. A mesma nota pode
 * estar na fila da Guilda e na pasta do Portal: a chave de acesso une as duas.
 */
export async function loadClientNfseForecast(
  tx: OrgTx,
  input: {
    orgId: string;
    now: Date;
    period: Period;
    issuers: readonly { id: string; clientId: string; active: boolean }[];
    /** Notas padrão ajustadas neste mês e ainda não pedidas, por empresa. */
    standing: readonly { issuerId: string; takerDocument: string }[];
  },
): Promise<Map<string, IssuerForecast>> {
  const result = new Map<string, IssuerForecast>();
  const issuers = input.issuers.filter((issuer) => issuer.active);
  if (issuers.length === 0 || !samePeriod(input.period, monthOf(input.now))) return result;

  const before = previousMonth(input.period);
  const n = schema.clientNfseInvoices;
  const it = schema.clientNfseItems;
  const invoices = await tx
    .select({
      issuerId: n.issuerId,
      periodYear: n.periodYear,
      periodMonth: n.periodMonth,
      status: n.status,
      accessKey: n.accessKey,
      takerDocument: n.takerDocument,
      takerName: n.takerName,
      amount: n.amount,
      description: n.description,
      issuedAt: n.issuedAt,
      template: n.template,
      sourceAccessKey: it.sourceAccessKey,
    })
    .from(n)
    .innerJoin(it, and(eq(it.orgId, n.orgId), eq(it.id, n.itemId)))
    .where(
      and(
        eq(n.orgId, input.orgId),
        or(
          and(eq(n.periodYear, before.year), eq(n.periodMonth, before.month)),
          and(eq(n.periodYear, input.period.year), eq(n.periodMonth, input.period.month)),
        ),
      ),
    );

  const portal = schema.nfseIssuedNotes;
  const issuerByClient = new Map(issuers.map((issuer) => [issuer.clientId, issuer.id]));
  const beforeStart = monthStart(before);
  const thisStart = monthStart(input.period);
  const stored = await tx
    .select({ accessKey: portal.accessKey, clientId: portal.clientId, issuedAt: portal.issuedAt, cancelledAt: portal.cancelledAt })
    .from(portal)
    .where(
      and(
        eq(portal.orgId, input.orgId),
        inArray(portal.clientId, [...issuerByClient.keys()]),
        gte(portal.issuedAt, beforeStart),
        lt(portal.issuedAt, monthStart(nextMonth(input.period))),
      ),
    );
  const cancelledInPortal = new Set(stored.filter((row) => row.cancelledAt).map((row) => row.accessKey));
  const storedKeys = stored.map((row) => row.accessKey);
  // Só abre o XML do que a Guilda não pediu: os dados dessas já estão na fila.
  const known = new Set(
    storedKeys.length
      ? (await tx.select({ accessKey: n.accessKey }).from(n).where(and(eq(n.orgId, input.orgId), inArray(n.accessKey, storedKeys)))).map((row) => row.accessKey)
      : [],
  );
  const foreign = stored.filter((row) => !known.has(row.accessKey) && !row.cancelledAt);
  const factsKey = (accessKey: string) => `${input.orgId}|${accessKey}`;
  const unread = foreign.filter((row) => !portalFacts.has(factsKey(row.accessKey))).map((row) => row.accessKey);
  if (unread.length > 0) {
    const xmlRows = await tx
      .select({ accessKey: portal.accessKey, xmlGz: portal.xmlGz })
      .from(portal)
      .where(and(eq(portal.orgId, input.orgId), inArray(portal.accessKey, unread)));
    for (const row of xmlRows) rememberPortalFacts(factsKey(row.accessKey), row.xmlGz);
  }

  const sources = new Map<string, ForecastSource[]>();
  const claims = new Map<string, ForecastClaim[]>();
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);

  for (const row of invoices) {
    const cancelled = row.accessKey ? cancelledInPortal.has(row.accessKey) : false;
    const isThisMonth = row.periodYear === input.period.year && row.periodMonth === input.period.month;
    if (isThisMonth) {
      if (row.status === "cancelled" || cancelled) continue;
      push(claims, row.issuerId, { takerDocument: row.takerDocument, amountCents: amountToCents(row.amount), sourceAccessKey: row.sourceAccessKey });
    } else if (row.status === "issued" && row.accessKey && !cancelled) {
      push(sources, row.issuerId, {
        accessKey: row.accessKey,
        takerDocument: row.takerDocument,
        takerName: row.takerName,
        address: null,
        amountCents: amountToCents(row.amount),
        description: row.description,
        issuedAt: row.issuedAt ?? beforeStart,
        service: parseNfseIssuerTemplate(row.template)?.service ?? null,
      });
    }
  }
  for (const row of foreign) {
    const issuerId = issuerByClient.get(row.clientId)!;
    const facts = portalFacts.get(factsKey(row.accessKey));
    if (!facts) continue;
    if (row.issuedAt >= thisStart) {
      push(claims, issuerId, { takerDocument: facts.taker.document, amountCents: facts.amountCents, sourceAccessKey: null });
    } else if (facts.description) {
      push(sources, issuerId, {
        accessKey: row.accessKey,
        takerDocument: facts.taker.document,
        takerName: facts.taker.name,
        address: facts.taker.address,
        amountCents: facts.amountCents,
        description: facts.description,
        issuedAt: row.issuedAt,
        service: facts.service,
      });
    }
  }

  const skips = schema.clientNfseForecastSkips;
  const skippedRows = await tx
    .select({ issuerId: skips.issuerId, sourceAccessKey: skips.sourceAccessKey })
    .from(skips)
    .where(and(eq(skips.orgId, input.orgId), eq(skips.periodYear, input.period.year), eq(skips.periodMonth, input.period.month)));
  const tk = schema.clientNfseTakers;
  const takers = await tx
    .select({ id: tk.id, issuerId: tk.issuerId, document: tk.document, name: tk.name, address: tk.address, retentions: tk.retentions })
    .from(tk)
    .where(and(eq(tk.orgId, input.orgId), inArray(tk.issuerId, issuers.map((issuer) => issuer.id))));
  const takerOf = new Map(takers.map((row) => [`${row.issuerId}|${row.document}`, row]));
  const cur = schema.nfseDfeCursors;
  const cursors = await tx
    .select({ clientId: cur.clientId, lastSyncedAt: cur.lastSyncedAt })
    .from(cur)
    .where(and(eq(cur.orgId, input.orgId), inArray(cur.clientId, [...issuerByClient.keys()])));
  const readAtByClient = new Map(cursors.map((row) => [row.clientId, row.lastSyncedAt]));

  for (const issuer of issuers) {
    const forecast = buildMonthForecast({
      period: input.period,
      sources: sources.get(issuer.id) ?? [],
      claims: claims.get(issuer.id) ?? [],
      standing: input.standing.filter((row) => row.issuerId === issuer.id).map((row) => row.takerDocument),
      skipped: new Set(skippedRows.filter((row) => row.issuerId === issuer.id).map((row) => row.sourceAccessKey)),
    });
    const view = (note: ForecastNote): ClientNfseForecastView => {
      const taker = takerOf.get(`${issuer.id}|${note.takerDocument}`);
      return {
        sourceAccessKey: note.sourceAccessKey,
        takerId: taker?.id ?? null,
        takerDocument: note.takerDocument,
        takerName: taker?.name ?? note.takerName,
        address: (taker?.address as NfseClientAddress | null | undefined) ?? note.address,
        retentions: taker?.retentions ?? null,
        amount: centsToNfseAmount(note.amountCents),
        description: note.description,
        service: note.service,
        textNeedsReview: note.textNeedsReview,
        sourceIssuedAt: note.sourceIssuedAt.toISOString(),
      };
    };
    result.set(issuer.id, {
      notes: forecast.notes.map(view),
      skipped: forecast.skipped.map(view),
      portalReadAt: readAtByClient.get(issuer.clientId)?.toISOString() ?? null,
    });
  }
  return result;
}

/** O que uma nota prevista leva para a emissão. */
export interface ForecastEmission {
  issuerId: string;
  requestId: string;
  sourceAccessKey: string;
  taker: { document: string; name: string; address: AddressInput | null };
  amount: string;
  description: string;
  service: ServiceOverride | null;
}

/**
 * Recalcula no servidor as previstas escolhidas: o navegador só diz quais, nunca
 * valor nem texto. Se algo mudou desde que a tela abriu, ou a nota pede
 * conferência do texto, não segue.
 */
export async function prepareForecastEmission(
  tx: OrgTx,
  input: { orgId: string; now: Date; period: Period; items: readonly { issuerId: string; sourceAccessKey: string; requestId: string }[]; expectedTotalCents: number },
): Promise<ActionResult<ForecastEmission[]>> {
  const i = schema.clientNfseIssuers;
  const issuers = await tx
    .select({ id: i.id, clientId: i.clientId, active: i.active })
    .from(i)
    .where(and(eq(i.orgId, input.orgId), inArray(i.id, [...new Set(input.items.map((item) => item.issuerId))])));
  const rows = await loadClientNfseMonthRows(tx, { orgId: input.orgId, now: input.now, ...input.period });
  const forecasts = await loadClientNfseForecast(tx, { orgId: input.orgId, now: input.now, period: input.period, issuers, standing: adjustedModelRows(rows) });
  const emissions: ForecastEmission[] = [];
  let totalCents = 0;
  for (const item of input.items) {
    const note = forecasts.get(item.issuerId)?.notes.find((row) => row.sourceAccessKey === item.sourceAccessKey);
    if (!note) return err("Uma nota mudou enquanto a tela estava aberta. Confira e tente de novo.");
    if (note.textNeedsReview) return err(`Confira o texto da nota de ${note.takerName} antes de emitir.`);
    totalCents += amountToCents(note.amount);
    emissions.push({
      issuerId: item.issuerId,
      requestId: item.requestId,
      sourceAccessKey: item.sourceAccessKey,
      taker: { document: note.takerDocument, name: note.takerName, address: note.address as AddressInput | null },
      amount: note.amount,
      description: note.description,
      service: note.service,
    });
  }
  if (totalCents !== input.expectedTotalCents) return err("Uma nota mudou enquanto a tela estava aberta. Confira e tente de novo.");
  return { ok: true, data: emissions };
}

/** A nota padrão ajustada neste mês e ainda não pedida ocupa o lugar da previsão. */
export function adjustedModelRows(rows: readonly { itemId: string | null; hasActiveInvoice: boolean; issuerId: string; takerDocument: string }[]) {
  return rows.filter((row) => row.itemId && !row.hasActiveInvoice).map((row) => ({ issuerId: row.issuerId, takerDocument: row.takerDocument }));
}

/** "Não emitir este mês": some da conta até desfazer. Sem nota, não há o que prever no mês seguinte. */
export async function skipClientNfseForecast(tx: OrgTx, input: Actor & { issuerId: string; sourceAccessKey: string; period: Period }): Promise<ActionResult> {
  const issuers = schema.clientNfseIssuers;
  const [issuer] = await tx
    .select({ clientId: issuers.clientId })
    .from(issuers)
    .where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, input.issuerId)));
  if (!issuer) return err("Empresa emissora não encontrada.");
  const problem = await sourceProblem(tx, { orgId: input.orgId, issuerId: input.issuerId, clientId: issuer.clientId, accessKey: input.sourceAccessKey });
  if (problem) return err(problem);
  await tx
    .insert(schema.clientNfseForecastSkips)
    .values({ orgId: input.orgId, issuerId: input.issuerId, sourceAccessKey: input.sourceAccessKey, periodYear: input.period.year, periodMonth: input.period.month, createdBy: input.actorId })
    .onConflictDoNothing();
  return { ok: true };
}

export async function restoreClientNfseForecast(tx: OrgTx, input: { orgId: string; issuerId: string; sourceAccessKey: string; period: Period }): Promise<ActionResult> {
  const skips = schema.clientNfseForecastSkips;
  await tx
    .delete(skips)
    .where(
      and(
        eq(skips.orgId, input.orgId),
        eq(skips.issuerId, input.issuerId),
        eq(skips.sourceAccessKey, input.sourceAccessKey),
        eq(skips.periodYear, input.period.year),
        eq(skips.periodMonth, input.period.month),
      ),
    );
  return { ok: true };
}
