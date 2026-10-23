import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  clientNfseMonthDescription,
  selectClientNfseBatch,
  type ClientNfseBatch,
  type ClientNfseCandidate,
} from "@/domain/client-nfse";
import {
  buildDpsId,
  buildNfseTakerAddress,
  centsToNfseAmount,
  isFutureNfsePeriod,
  type NfseCancelReasonCode,
  type NfseClientAddress,
} from "@/domain/nfse";
import { err, type ActionResult } from "@/lib/action-context";
import { ibgeCityCode } from "@/lib/nfse/municipios";
import { nfseIssuerTemplateRulesSchema, type NfseIssuerTemplate } from "@/lib/nfse/template";

import type { ServiceOverride } from "./registry";

type Actor = { orgId: string; actorId: string };
type Period = { year: number; month: number };

/** O serviço da nota padrão substitui o do modelo fiscal do emissor. */
export function issuerTemplateFor(template: NfseIssuerTemplate, service: ServiceOverride | null): NfseIssuerTemplate {
  return service ? { ...template, service: { ...service } } : template;
}

export interface IssuerReadiness {
  issuerId: string;
  clientId: string;
  name: string;
  cnpj: string | null;
  template: NfseIssuerTemplate | null;
  dpsSeries: string;
  /** null: pode emitir. */
  problem: string | null;
}

/**
 * Pode emitir? Modelo fiscal completo, empresa com CNPJ, ativa e com
 * certificado conferido, do mesmo CNPJ e dentro da validade. O serviço fiscal
 * confere de novo ao abrir o certificado.
 */
export async function loadIssuerReadiness(
  tx: OrgTx,
  input: { orgId: string; issuerIds?: readonly string[]; now: Date },
): Promise<Map<string, IssuerReadiness>> {
  const i = schema.clientNfseIssuers;
  const c = schema.clients;
  const cert = schema.nfseClientCertificates;
  const rows = await tx
    .select({
      issuerId: i.id,
      clientId: c.id,
      name: c.name,
      cnpj: c.cnpj,
      clientActive: c.active,
      taxRegime: c.taxRegime,
      issuerActive: i.active,
      template: i.template,
      dpsSeries: i.dpsSeries,
      certStatus: cert.status,
      certCnpj: cert.certificateCnpj,
      certValidUntil: cert.validUntil,
    })
    .from(i)
    .innerJoin(c, and(eq(c.orgId, i.orgId), eq(c.id, i.clientId)))
    .leftJoin(cert, and(eq(cert.orgId, i.orgId), eq(cert.clientId, i.clientId)))
    .where(and(eq(i.orgId, input.orgId), input.issuerIds ? inArray(i.id, [...input.issuerIds]) : undefined));
  const result = new Map<string, IssuerReadiness>();
  for (const row of rows) {
    const parsed = nfseIssuerTemplateRulesSchema.safeParse(row.template);
    const template = parsed.success ? parsed.data : null;
    const problem = !row.issuerActive
      ? "Empresa desativada nas Notas dos clientes."
      : !row.clientActive
        ? "Empresa inativa no cadastro."
        : row.taxRegime === "mei"
          ? "MEI não emite por aqui."
          : !row.cnpj
            ? "Empresa sem CNPJ no cadastro."
            : !template
              ? `Modelo fiscal incompleto: ${parsed.error?.issues[0]?.message ?? "revise o cadastro"}`
              : !row.certStatus
                ? "Sem certificado A1 (envie na aba XML das notas)."
                : row.certStatus === "pending"
                  ? "Certificado ainda em conferência."
                  : row.certStatus !== "valid" || row.certCnpj !== row.cnpj
                    ? "Certificado com problema (veja a aba XML das notas)."
                    : row.certValidUntil && row.certValidUntil <= input.now
                      ? "Certificado vencido."
                      : null;
    result.set(row.issuerId, {
      issuerId: row.issuerId,
      clientId: row.clientId,
      name: row.name,
      cnpj: row.cnpj,
      template,
      dpsSeries: row.dpsSeries,
      problem,
    });
  }
  return result;
}

type MonthRow = ClientNfseCandidate & {
  /** A nota do mês guardada; null enquanto ela só existe como nota padrão. */
  itemId: string | null;
  takerId: string;
  modelService: ServiceOverride | null;
  /** A nota padrão está ativa (pausada só aparece se já tiver nota do mês). */
  modelActive: boolean;
};

/**
 * As notas do mês, sem "abrir o mês": toda nota padrão ativa (de emissor e
 * tomador ativos) aparece sozinha, com o valor e a descrição do padrão; a que
 * já foi ajustada ou pedida neste mês vem da nota do mês guardada
 * (client_nfse_items), mesmo que o padrão tenha sido pausado depois.
 */
export async function loadClientNfseMonthRows(tx: OrgTx, input: { orgId: string; now: Date } & Period): Promise<MonthRow[]> {
  const it = schema.clientNfseItems;
  const tk = schema.clientNfseTakers;
  const md = schema.clientNfseModels;
  const is = schema.clientNfseIssuers;
  const n = schema.clientNfseInvoices;
  const period = { year: input.year, month: input.month };
  const stored = await tx
    .select({
      itemId: it.id,
      modelId: it.modelId,
      issuerId: it.issuerId,
      takerId: it.takerId,
      amount: it.amount,
      description: it.description,
      takerName: tk.name,
      takerDocument: tk.document,
      takerAddress: tk.address,
      modelService: md.service,
      modelActive: md.active,
    })
    .from(it)
    .innerJoin(tk, and(eq(tk.orgId, it.orgId), eq(tk.id, it.takerId)))
    .innerJoin(md, and(eq(md.orgId, it.orgId), eq(md.id, it.modelId)))
    .where(and(eq(it.orgId, input.orgId), eq(it.periodYear, input.year), eq(it.periodMonth, input.month)));
  const withItem = new Set(stored.map((row) => row.modelId));
  const standing = (
    await tx
      .select({
        modelId: md.id,
        issuerId: md.issuerId,
        takerId: md.takerId,
        amount: md.amount,
        template: md.description,
        reference: md.reference,
        takerName: tk.name,
        takerDocument: tk.document,
        takerAddress: tk.address,
        modelService: md.service,
      })
      .from(md)
      .innerJoin(is, and(eq(is.orgId, md.orgId), eq(is.id, md.issuerId)))
      .innerJoin(tk, and(eq(tk.orgId, md.orgId), eq(tk.id, md.takerId)))
      .where(and(eq(md.orgId, input.orgId), eq(md.active, true), eq(is.active, true), eq(tk.active, true)))
  ).filter((row) => !withItem.has(row.modelId));
  const raw = [
    ...stored,
    ...standing.map(({ template, reference, ...row }) => ({
      ...row,
      itemId: null,
      description: clientNfseMonthDescription(template, period, reference),
      modelActive: true,
    })),
  ];
  if (raw.length === 0) return [];
  const itemIds = stored.map((row) => row.itemId);
  const active = itemIds.length
    ? await tx
        .select({ itemId: n.itemId })
        .from(n)
        .where(and(eq(n.orgId, input.orgId), inArray(n.itemId, itemIds), ne(n.status, "cancelled")))
    : [];
  const activeItems = new Set(active.map((row) => row.itemId));
  const issuers = await loadIssuerReadiness(tx, { orgId: input.orgId, issuerIds: [...new Set(raw.map((row) => row.issuerId))], now: input.now });
  return raw
    .map((row) => {
      const issuer = issuers.get(row.issuerId);
      return {
        modelId: row.modelId,
        itemId: row.itemId,
        issuerId: row.issuerId,
        takerId: row.takerId,
        issuerName: issuer?.name ?? "",
        takerName: row.takerName,
        takerDocument: row.takerDocument,
        amount: row.amount,
        description: row.description,
        address: buildNfseTakerAddress(row.takerAddress as NfseClientAddress | null, ibgeCityCode),
        requireAddress: Boolean(issuer?.template?.ibsCbs),
        hasActiveInvoice: row.itemId ? activeItems.has(row.itemId) : false,
        issuerProblem: issuer ? issuer.problem : "Empresa emissora não encontrada.",
        modelService: row.modelService,
        modelActive: row.modelActive,
      };
    })
    .sort((a, b) => a.issuerName.localeCompare(b.issuerName, "pt-BR") || a.takerName.localeCompare(b.takerName, "pt-BR"));
}

/**
 * Guarda a nota do mês das notas padrão dadas (com o valor e a descrição do
 * padrão), se ainda não existir. É o que acontece ao ajustar ou emitir.
 */
async function ensureClientNfseItems(tx: OrgTx, input: Actor & Period & { modelIds: readonly string[] }): Promise<void> {
  if (input.modelIds.length === 0) return;
  const md = schema.clientNfseModels;
  const models = await tx
    .select({ id: md.id, issuerId: md.issuerId, takerId: md.takerId, amount: md.amount, description: md.description, reference: md.reference })
    .from(md)
    .where(and(eq(md.orgId, input.orgId), inArray(md.id, [...input.modelIds])));
  if (models.length === 0) return;
  const period = { year: input.year, month: input.month };
  const it = schema.clientNfseItems;
  await tx
    .insert(it)
    .values(
      models.map((model) => ({
        orgId: input.orgId,
        modelId: model.id,
        issuerId: model.issuerId,
        takerId: model.takerId,
        periodYear: input.year,
        periodMonth: input.month,
        amount: model.amount,
        description: clientNfseMonthDescription(model.description, period, model.reference),
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })),
    )
    .onConflictDoNothing({ target: [it.orgId, it.modelId, it.periodYear, it.periodMonth] });
}

/** Ajusta valor e descrição só deste mês; a nota padrão não muda. */
export async function adjustClientNfseMonthNote(
  tx: OrgTx,
  input: Actor & Period & { modelId: string; amount: string; description: string },
): Promise<ActionResult> {
  await ensureClientNfseItems(tx, { ...input, modelIds: [input.modelId] });
  const it = schema.clientNfseItems;
  const [item] = await tx
    .select({ id: it.id })
    .from(it)
    .where(and(eq(it.orgId, input.orgId), eq(it.modelId, input.modelId), eq(it.periodYear, input.year), eq(it.periodMonth, input.month)))
    .for("update");
  if (!item) return err("Nota padrão não encontrada.");
  const n = schema.clientNfseInvoices;
  const [active] = await tx
    .select({ id: n.id })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), eq(n.itemId, item.id), ne(n.status, "cancelled")))
    .limit(1);
  if (active) return err("Esta nota já foi pedida. Para mudar, cancele a nota antes.");
  await tx
    .update(it)
    .set({ amount: input.amount, description: input.description.trim(), updatedBy: input.actorId, updatedAt: new Date() })
    .where(and(eq(it.orgId, input.orgId), eq(it.id, item.id)));
  return { ok: true };
}

/** O que pode sair agora e o que fica de fora, recalculado no servidor. */
export async function loadClientNfsePreview(
  tx: OrgTx,
  input: { orgId: string; now: Date } & Period,
): Promise<ClientNfseBatch> {
  return selectClientNfseBatch(await loadClientNfseMonthRows(tx, input));
}

/**
 * Grava na fila as notas escolhidas (uma, as de uma empresa ou várias). Trava
 * os emissores envolvidos (serializa cliques simultâneos e a numeração), guarda
 * a nota do mês de quem ainda não tinha, recalcula e só segue se for o mesmo
 * que a pessoa viu; reserva os números de DPS de cada emissor na mesma
 * transação — o número nunca muda depois.
 */
export async function enqueueClientNfseBatch(
  tx: OrgTx,
  input: Actor & Period & {
    /** Notas padrão escolhidas (a nota do mês de cada uma). */
    selected: readonly string[];
    expectedCount: number;
    expectedTotalCents: number;
    today: string;
    now: Date;
  },
): Promise<ActionResult<{ queued: number }>> {
  if (isFutureNfsePeriod(input, input.today)) return err("Não dá para emitir nota de um mês que ainda não começou.");
  const wanted = new Set(input.selected);
  const candidates = await loadClientNfseMonthRows(tx, input);
  const issuerIds = [...new Set(candidates.filter((row) => wanted.has(row.modelId)).map((row) => row.issuerId))].sort();
  if (issuerIds.length === 0) return err("Escolha ao menos uma nota para emitir.");
  const i = schema.clientNfseIssuers;
  const locked = await tx
    .select({ id: i.id, nextDpsNumber: i.nextDpsNumber })
    .from(i)
    .where(and(eq(i.orgId, input.orgId), inArray(i.id, issuerIds)))
    .orderBy(asc(i.id))
    .for("update");
  await ensureClientNfseItems(tx, { ...input, modelIds: [...wanted] });
  // Recalcula depois da trava: outra pessoa pode ter emitido ou ajustado no meio.
  const fresh = await loadClientNfseMonthRows(tx, input);
  const batch = selectClientNfseBatch(fresh);
  const items = batch.items.filter((item) => wanted.has(item.modelId));
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  if (items.length !== wanted.size || items.length !== input.expectedCount || totalCents !== input.expectedTotalCents) {
    return err("A nota mudou enquanto a tela estava aberta (ajuste, emissão ou cadastro). Confira e tente de novo.");
  }
  const readiness = await loadIssuerReadiness(tx, { orgId: input.orgId, issuerIds, now: input.now });
  const rowByModel = new Map(fresh.map((row) => [row.modelId, row]));
  const next = new Map(locked.map((row) => [row.id, row.nextDpsNumber]));
  const values = items.map((item) => {
    const issuer = readiness.get(item.issuerId)!;
    const row = rowByModel.get(item.modelId)!;
    const number = next.get(item.issuerId)!;
    next.set(item.issuerId, number + 1);
    const template = issuerTemplateFor(issuer.template!, row.modelService);
    return {
      orgId: input.orgId,
      issuerId: item.issuerId,
      clientId: issuer.clientId,
      takerId: row.takerId,
      itemId: row.itemId!,
      periodYear: input.year,
      periodMonth: input.month,
      amount: centsToNfseAmount(item.amountCents),
      providerCnpj: issuer.cnpj!,
      template,
      takerDocument: item.takerDocument,
      takerName: item.takerName,
      takerAddress: item.address,
      description: item.description,
      dpsSeries: issuer.dpsSeries,
      dpsNumber: number,
      dpsId: buildDpsId({ cityCode: template.cityCode, cnpj: issuer.cnpj!, series: issuer.dpsSeries, number }),
      requestedBy: input.actorId,
    };
  });
  for (const [issuerId, nextNumber] of next) {
    await tx.update(i).set({ nextDpsNumber: nextNumber }).where(and(eq(i.orgId, input.orgId), eq(i.id, issuerId)));
  }
  const inserted = await tx.insert(schema.clientNfseInvoices).values(values).returning({ id: schema.clientNfseInvoices.id });
  await tx.insert(schema.clientNfseInvoiceEvents).values(
    inserted.map((row) => ({ orgId: input.orgId, invoiceId: row.id, eventType: "requested" as const, actorId: input.actorId })),
  );
  return { ok: true, data: { queued: inserted.length } };
}

export async function requestClientNfseCancel(
  tx: OrgTx,
  input: Actor & { invoiceId: string; reasonCode: NfseCancelReasonCode; reasonText: string },
): Promise<ActionResult> {
  const t = schema.clientNfseInvoices;
  const [invoice] = await tx
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.invoiceId)))
    .for("update");
  if (!invoice) return err("Nota não encontrada.");
  if (invoice.status !== "issued") return err("Só uma nota emitida pode ser cancelada.");
  await tx
    .update(t)
    .set({
      status: "cancel_requested",
      cancelRequestedBy: input.actorId,
      cancelReasonCode: input.reasonCode,
      cancelReasonText: input.reasonText,
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, invoice.id)));
  await tx.insert(schema.clientNfseInvoiceEvents).values({
    orgId: input.orgId,
    invoiceId: invoice.id,
    eventType: "cancel_requested",
    actorId: input.actorId,
    detail: { reasonCode: input.reasonCode, reasonText: input.reasonText },
  });
  return { ok: true };
}

/**
 * Recoloca na fila uma nota que falhou, com o endereço relido. Mantém o
 * número da DPS (é ele que impede nota duplicada) — salvo quando a série do
 * emissor mudou: é o conserto da série que colidiu com outro sistema da
 * empresa, e a nota ganha número novo na série nova.
 */
export async function requeueClientNfseInvoice(tx: OrgTx, input: Actor & { invoiceId: string }): Promise<ActionResult> {
  const t = schema.clientNfseInvoices;
  const [invoice] = await tx
    .select({ id: t.id, status: t.status, takerId: t.takerId, template: t.template, issuerId: t.issuerId, providerCnpj: t.providerCnpj, dpsSeries: t.dpsSeries })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.invoiceId)))
    .for("update");
  if (!invoice) return err("Nota não encontrada.");
  if (invoice.status !== "failed") return err("Só uma nota com erro volta para a fila.");
  const [taker] = await tx
    .select({ address: schema.clientNfseTakers.address })
    .from(schema.clientNfseTakers)
    .where(and(eq(schema.clientNfseTakers.orgId, input.orgId), eq(schema.clientNfseTakers.id, invoice.takerId)));
  const takerAddress = buildNfseTakerAddress((taker?.address ?? null) as NfseClientAddress | null, ibgeCityCode);
  if ((invoice.template as NfseIssuerTemplate).ibsCbs && !takerAddress) {
    return err("O endereço do tomador está incompleto (rua, bairro, CEP e cidade). Complete no cadastro e tente de novo.");
  }
  const issuers = schema.clientNfseIssuers;
  const [issuer] = await tx
    .select({ dpsSeries: issuers.dpsSeries, nextDpsNumber: issuers.nextDpsNumber })
    .from(issuers)
    .where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, invoice.issuerId)))
    .for("update");
  let renumber: { dpsSeries: string; dpsNumber: number; dpsId: string } | null = null;
  if (issuer && issuer.dpsSeries !== invoice.dpsSeries) {
    renumber = {
      dpsSeries: issuer.dpsSeries,
      dpsNumber: issuer.nextDpsNumber,
      dpsId: buildDpsId({ cityCode: (invoice.template as NfseIssuerTemplate).cityCode, cnpj: invoice.providerCnpj, series: issuer.dpsSeries, number: issuer.nextDpsNumber }),
    };
    await tx.update(issuers).set({ nextDpsNumber: issuer.nextDpsNumber + 1 }).where(and(eq(issuers.orgId, input.orgId), eq(issuers.id, invoice.issuerId)));
  }
  await tx
    .update(t)
    .set({ status: "queued", attemptCount: 0, nextAttemptAt: new Date(), lastError: null, takerAddress, ...renumber, updatedAt: new Date() })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, invoice.id)));
  await tx.insert(schema.clientNfseInvoiceEvents).values({
    orgId: input.orgId,
    invoiceId: invoice.id,
    eventType: "retried",
    actorId: input.actorId,
    detail: renumber ? { dpsSeries: renumber.dpsSeries, dpsNumber: renumber.dpsNumber } : {},
  });
  return { ok: true };
}
