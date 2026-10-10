import "server-only";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  buildDpsId,
  centsToNfseAmount,
  danfseFileName,
  isFutureNfsePeriod,
  normalizeDpsSeries,
  renderNfseDescription,
  selectNfseBatch,
  type NfseCancelReasonCode,
  type NfseEmissionPreviewView,
} from "@/domain/nfse";

import { parseNfseTemplate, type NfseTemplate } from "./template";

export type NfseCommandResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

export interface NfseSettingsRecord {
  providerCnpj: string;
  dpsSeries: string;
  template: NfseTemplate | null;
  nextDpsNumber: number;
  serviceSeenAt: Date | null;
  serviceEnvironment: number | null;
  certificateValidUntil: Date | null;
  serviceError: string | null;
}

export async function loadNfseSettings(
  tx: OrgTx,
  orgId: string,
  options: { lock?: boolean } = {},
): Promise<NfseSettingsRecord | null> {
  const query = tx.select().from(schema.nfseSettings).where(eq(schema.nfseSettings.orgId, orgId));
  const [row] = options.lock ? await query.for("update") : await query;
  if (!row) return null;
  return {
    providerCnpj: row.providerCnpj,
    dpsSeries: row.dpsSeries,
    template: parseNfseTemplate(row.template),
    nextDpsNumber: row.nextDpsNumber,
    serviceSeenAt: row.serviceSeenAt,
    serviceEnvironment: row.serviceEnvironment,
    certificateValidUntil: row.certificateValidUntil,
    serviceError: row.serviceError,
  };
}

/** Prévia do lote do mês, recalculada no servidor a cada pedido. */
export async function loadNfseEmissionPreview(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; includeAdditional: boolean },
): Promise<NfseEmissionPreviewView> {
  const control = schema.officeFeeControlPeriods;
  const rows = await tx
    .select({
      id: control.id,
      clientId: control.clientId,
      clientName: control.clientNameSnapshot,
      cnpj: control.clientCnpjSnapshot,
      snapshot: control.profileSnapshot,
    })
    .from(control)
    .where(and(eq(control.orgId, input.orgId), eq(control.periodYear, input.year), eq(control.periodMonth, input.month)))
    .orderBy(asc(control.clientNameSnapshot));
  const invoices = schema.nfseInvoices;
  const active = await tx
    .select({ clientId: invoices.clientId, kind: invoices.kind, periodMonth: invoices.periodMonth })
    .from(invoices)
    .where(and(eq(invoices.orgId, input.orgId), eq(invoices.periodYear, input.year), ne(invoices.status, "cancelled")));
  const [withoutFee] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clients)
    .leftJoin(
      schema.officeFeeProfiles,
      and(eq(schema.officeFeeProfiles.orgId, schema.clients.orgId), eq(schema.officeFeeProfiles.clientId, schema.clients.id)),
    )
    .where(and(eq(schema.clients.orgId, input.orgId), eq(schema.clients.active, true), isNull(schema.officeFeeProfiles.id)));
  const batch = selectNfseBatch({
    candidates: rows.map((row) => ({
      controlPeriodId: row.id,
      clientId: row.clientId,
      clientName: row.clientName,
      cnpj: row.cnpj,
      monthlyFee: row.snapshot.monthlyFee,
      chargesAdditionalInstallment: row.snapshot.chargesAdditionalInstallment,
    })),
    activeMonthlyClientIds: new Set(
      active.filter((row) => row.kind === "monthly" && row.periodMonth === input.month).map((row) => row.clientId),
    ),
    activeAdditionalClientIds: new Set(
      active.filter((row) => row.kind === "additional_installment").map((row) => row.clientId),
    ),
    includeAdditional: input.includeAdditional,
  });
  return { ...batch, companiesWithoutFee: withoutFee?.count ?? 0 };
}

/**
 * Grava o lote na fila. Trava a configuração (serializa cliques simultâneos),
 * recalcula a prévia e só segue se ela for a mesma que a pessoa viu; reserva
 * os números de DPS na mesma transação — o número nunca muda depois.
 */
export async function enqueueNfseBatch(
  tx: OrgTx,
  input: {
    orgId: string;
    actorId: string;
    year: number;
    month: number;
    includeAdditional: boolean;
    expectedCount: number;
    expectedTotalCents: number;
    today: string;
  },
): Promise<NfseCommandResult<{ queued: number }>> {
  const settings = await loadNfseSettings(tx, input.orgId, { lock: true });
  const template = settings?.template;
  if (!settings || !template) return fail("Configure o modelo da nota antes de emitir.");
  if (isFutureNfsePeriod(input, input.today)) return fail("Não dá para emitir nota de um mês que ainda não começou.");
  const preview = await loadNfseEmissionPreview(tx, input);
  if (preview.items.length === 0) return fail("Nenhuma nota para emitir neste mês.");
  if (preview.items.length !== input.expectedCount || preview.totalCents !== input.expectedTotalCents) {
    return fail("A lista mudou desde a prévia. Abra a prévia de novo antes de emitir.");
  }
  const first = settings.nextDpsNumber;
  await tx
    .update(schema.nfseSettings)
    .set({ nextDpsNumber: first + preview.items.length })
    .where(eq(schema.nfseSettings.orgId, input.orgId));
  try {
    const inserted = await tx
      .insert(schema.nfseInvoices)
      .values(
        preview.items.map((item, index) => {
          const dpsNumber = first + index;
          return {
            orgId: input.orgId,
            clientId: item.clientId,
            controlPeriodId: item.controlPeriodId,
            kind: item.kind,
            periodYear: input.year,
            periodMonth: input.month,
            amount: centsToNfseAmount(item.amountCents),
            takerCnpj: item.cnpj,
            takerName: item.clientName,
            description: renderNfseDescription(
              item.kind === "monthly" ? template.descriptions.monthly : template.descriptions.additionalInstallment,
              input,
            ),
            dpsSeries: settings.dpsSeries,
            dpsNumber,
            dpsId: buildDpsId({ cityCode: template.cityCode, cnpj: settings.providerCnpj, series: settings.dpsSeries, number: dpsNumber }),
            requestedBy: input.actorId,
          };
        }),
      )
      .returning({ id: schema.nfseInvoices.id });
    await tx.insert(schema.nfseInvoiceEvents).values(
      inserted.map((row) => ({ orgId: input.orgId, invoiceId: row.id, eventType: "requested" as const, actorId: input.actorId })),
    );
    return { ok: true, data: { queued: inserted.length } };
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Outra pessoa emitiu notas deste mês ao mesmo tempo. Abra a prévia de novo.");
    throw error;
  }
}

export async function requestNfseCancel(
  tx: OrgTx,
  input: { orgId: string; actorId: string; invoiceId: string; reasonCode: NfseCancelReasonCode; reasonText: string },
): Promise<NfseCommandResult> {
  const t = schema.nfseInvoices;
  const [invoice] = await tx
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.invoiceId)))
    .for("update");
  if (!invoice) return fail("Nota não encontrada.");
  if (invoice.status !== "issued") return fail("Só uma nota emitida pode ser cancelada.");
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
  await tx.insert(schema.nfseInvoiceEvents).values({
    orgId: input.orgId,
    invoiceId: invoice.id,
    eventType: "cancel_requested",
    actorId: input.actorId,
    detail: { reasonCode: input.reasonCode, reasonText: input.reasonText },
  });
  return { ok: true, data: undefined };
}

/** Recoloca na fila uma nota que falhou, com o MESMO número de DPS. */
export async function requeueNfseInvoice(
  tx: OrgTx,
  input: { orgId: string; actorId: string; invoiceId: string },
): Promise<NfseCommandResult> {
  const t = schema.nfseInvoices;
  const [invoice] = await tx
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.id, input.invoiceId)))
    .for("update");
  if (!invoice) return fail("Nota não encontrada.");
  if (invoice.status !== "failed") return fail("Só uma nota com erro volta para a fila.");
  await tx
    .update(t)
    .set({ status: "queued", attemptCount: 0, nextAttemptAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(eq(t.orgId, input.orgId), eq(t.id, invoice.id)));
  await tx.insert(schema.nfseInvoiceEvents).values({
    orgId: input.orgId,
    invoiceId: invoice.id,
    eventType: "retried",
    actorId: input.actorId,
  });
  return { ok: true, data: undefined };
}

export async function upsertNfseSettings(
  tx: OrgTx,
  input: { orgId: string; actorId: string; providerCnpj: string; dpsSeries: string; template: NfseTemplate },
): Promise<NfseCommandResult> {
  const series = normalizeDpsSeries(input.dpsSeries);
  const current = await loadNfseSettings(tx, input.orgId, { lock: true });
  const changesIdentity =
    !current ||
    current.providerCnpj !== input.providerCnpj ||
    current.dpsSeries !== series ||
    current.template?.cityCode !== input.template.cityCode;
  if (current && changesIdentity) {
    const [busy] = await tx
      .select({ id: schema.nfseInvoices.id })
      .from(schema.nfseInvoices)
      .where(and(eq(schema.nfseInvoices.orgId, input.orgId), inArray(schema.nfseInvoices.status, ["queued", "cancel_requested"])))
      .limit(1);
    if (busy) return fail("Há notas na fila. Espere a fila esvaziar para trocar CNPJ, série ou município.");
  }
  try {
    await tx
      .insert(schema.nfseSettings)
      .values({ orgId: input.orgId, providerCnpj: input.providerCnpj, dpsSeries: series, template: input.template, updatedBy: input.actorId })
      .onConflictDoUpdate({
        target: schema.nfseSettings.orgId,
        set: { providerCnpj: input.providerCnpj, dpsSeries: series, template: input.template, updatedBy: input.actorId, updatedAt: new Date() },
      });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Este CNPJ já está configurado em outra organização.");
    throw error;
  }
  return { ok: true, data: undefined };
}

export interface NfseInvoiceRow {
  id: string;
  clientName: string;
  kind: "monthly" | "additional_installment";
  amount: string;
  status: "queued" | "issued" | "failed" | "cancel_requested" | "cancelled";
  nfseNumber: string | null;
  issuedAt: Date | null;
  lastError: string | null;
  environment: number | null;
}

export async function loadNfseMonth(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number },
): Promise<NfseInvoiceRow[]> {
  const t = schema.nfseInvoices;
  return tx
    .select({
      id: t.id,
      clientName: t.takerName,
      kind: t.kind,
      amount: t.amount,
      status: t.status,
      nfseNumber: t.nfseNumber,
      issuedAt: t.issuedAt,
      lastError: t.lastError,
      environment: t.environment,
    })
    .from(t)
    .where(and(eq(t.orgId, input.orgId), eq(t.periodYear, input.year), eq(t.periodMonth, input.month)))
    .orderBy(asc(t.takerName), asc(t.kind), asc(t.createdAt));
}

/** Chaves e nomes de arquivo das notas emitidas do mês (ou de uma nota). */
export async function loadDanfseItems(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; invoiceId?: string },
): Promise<{ accessKey: string; fileName: string }[]> {
  const t = schema.nfseInvoices;
  const rows = await tx
    .select({ accessKey: t.accessKey, nfseNumber: t.nfseNumber, dpsNumber: t.dpsNumber, takerName: t.takerName, kind: t.kind })
    .from(t)
    .where(
      and(
        eq(t.orgId, input.orgId),
        eq(t.periodYear, input.year),
        eq(t.periodMonth, input.month),
        eq(t.status, "issued"),
        input.invoiceId ? eq(t.id, input.invoiceId) : undefined,
      ),
    )
    .orderBy(asc(t.takerName));
  const used = new Set<string>();
  return rows.flatMap((row) => {
    if (!row.accessKey) return [];
    let fileName = danfseFileName({ nfseNumber: row.nfseNumber, dpsNumber: row.dpsNumber, takerName: row.takerName });
    if (row.kind === "additional_installment") fileName = fileName.replace(/\.pdf$/, "-pa.pdf");
    if (used.has(fileName)) fileName = fileName.replace(/\.pdf$/, `-${row.dpsNumber}.pdf`);
    used.add(fileName);
    return [{ accessKey: row.accessKey, fileName }];
  });
}
