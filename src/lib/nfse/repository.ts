import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { amountToCents, type NfseCancelReasonCode, type NfseInvoiceKind } from "@/domain/nfse";
import { applyOfficeFeeStepChange } from "@/lib/office-fees/step-change";

import type { NfseJob, NfseJobOutcome } from "./processor";
import { parseNfseTemplate, type NfseTemplate } from "./template";

/** Lease vencido: o serviço caiu no meio e outra rodada pode assumir. */
const LEASE_MINUTES = 5;

export interface NfseClaim extends NfseJob {
  lockToken: string;
  kind: NfseInvoiceKind;
  controlPeriodId: string;
  requestedBy: string;
  cancelRequestedBy: string | null;
}

/** Batimento + descoberta da organização pelo CNPJ do certificado. */
export async function registerFiscalService(input: {
  cnpj: string;
  environment: 1 | 2;
  certificateValidUntil: Date | null;
  error: string | null;
}): Promise<string | null> {
  const result = await db.execute<{ org_id: string | null }>(
    sql`SELECT public.nfse_register_service(
          ${input.cnpj}::text,
          ${input.environment}::smallint,
          ${input.certificateValidUntil}::timestamptz,
          ${input.error}::text
        ) AS org_id`,
  );
  return result.rows[0]?.org_id ?? null;
}

export async function loadServiceSettings(
  orgId: string,
): Promise<{ providerCnpj: string; template: NfseTemplate | null } | null> {
  return withOrgTx(orgId, async (tx) => {
    const [row] = await tx
      .select({ providerCnpj: schema.nfseSettings.providerCnpj, template: schema.nfseSettings.template })
      .from(schema.nfseSettings)
      .where(eq(schema.nfseSettings.orgId, orgId));
    return row ? { providerCnpj: row.providerCnpj, template: parseNfseTemplate(row.template) } : null;
  });
}

/** Reivindica a próxima nota pendente (emitir ou cancelar) com lease. */
export async function claimNfseJob(orgId: string): Promise<NfseClaim | null> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.nfseInvoices;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LEASE_MINUTES * 60_000);
    const [candidate] = await tx
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          eq(t.orgId, orgId),
          inArray(t.status, ["queued", "cancel_requested"]),
          lte(t.nextAttemptAt, now),
          or(isNull(t.lockedAt), lt(t.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(t.nextAttemptAt), asc(t.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const lockToken = randomUUID();
    const [row] = await tx
      .update(t)
      .set({ attemptCount: sql`${t.attemptCount} + 1`, lockedAt: now, lockToken, updatedAt: now })
      .where(and(eq(t.orgId, orgId), eq(t.id, candidate.id)))
      .returning();
    if (row.status !== "queued" && row.status !== "cancel_requested") return null;
    return {
      id: row.id,
      status: row.status,
      attemptCount: row.attemptCount,
      dpsId: row.dpsId,
      dpsSeries: row.dpsSeries,
      dpsNumber: row.dpsNumber,
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
      amountCents: amountToCents(row.amount),
      takerCnpj: row.takerCnpj,
      takerName: row.takerName,
      description: row.description,
      accessKey: row.accessKey,
      issuedEnvironment: row.environment === 1 || row.environment === 2 ? row.environment : null,
      cancelReasonCode: (row.cancelReasonCode as NfseCancelReasonCode | null) ?? null,
      cancelReasonText: row.cancelReasonText,
      lockToken,
      kind: row.kind,
      controlPeriodId: row.controlPeriodId,
      requestedBy: row.requestedBy,
      cancelRequestedBy: row.cancelRequestedBy,
    };
  });
}

function eventFor(
  claim: NfseClaim,
  outcome: NfseJobOutcome,
): { eventType: "issued" | "failed" | "cancelled" | "cancel_failed"; detail: Record<string, unknown> } | null {
  switch (outcome.kind) {
    case "issued":
      return { eventType: "issued", detail: { accessKey: outcome.accessKey, nfseNumber: outcome.nfseNumber, environment: outcome.environment } };
    case "failed":
      return { eventType: "failed", detail: { message: outcome.message, errors: outcome.errors } };
    case "cancelled":
      return { eventType: "cancelled", detail: {} };
    case "cancel_rejected":
      return {
        eventType: "cancel_failed",
        detail: { message: outcome.message, errors: outcome.errors, reasonCode: claim.cancelReasonCode, reasonText: claim.cancelReasonText },
      };
    case "retry":
      return null;
  }
}

/**
 * Grava o desfecho só se o lease ainda for desta rodada. Nota emitida marca a
 * etapa do controle na MESMA transação; cancelada, reabre.
 */
export async function finishNfseJob(orgId: string, claim: NfseClaim, outcome: NfseJobOutcome): Promise<boolean> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.nfseInvoices;
    const now = new Date();
    const release = { lockedAt: null, lockToken: null, updatedAt: now };
    const values: Partial<typeof t.$inferInsert> =
      outcome.kind === "issued"
        ? { ...release, status: "issued", accessKey: outcome.accessKey, nfseNumber: outcome.nfseNumber, environment: outcome.environment, issuedAt: now, lastError: null }
        : outcome.kind === "failed"
          ? { ...release, status: "failed", lastError: outcome.message }
          : outcome.kind === "retry"
            ? { ...release, lastError: outcome.message, nextAttemptAt: new Date(now.getTime() + outcome.delayMinutes * 60_000) }
            : outcome.kind === "cancelled"
              ? { ...release, status: "cancelled", cancelledAt: now, lastError: null }
              : { ...release, status: "issued", lastError: `Cancelamento recusado: ${outcome.message}`, cancelRequestedBy: null, cancelReasonCode: null, cancelReasonText: null };
    const [updated] = await tx
      .update(t)
      .set(values)
      .where(and(eq(t.orgId, orgId), eq(t.id, claim.id), eq(t.lockToken, claim.lockToken)))
      .returning({ id: t.id });
    if (!updated) return false;
    const event = eventFor(claim, outcome);
    if (event) {
      await tx.insert(schema.nfseInvoiceEvents).values({ orgId, invoiceId: claim.id, actorId: null, ...event });
    }
    const stage = claim.kind === "monthly" ? "invoice" : "additional_installment";
    if (outcome.kind === "issued") {
      await applyOfficeFeeStepChange(tx, { orgId, controlPeriodId: claim.controlPeriodId, stage, stepStatus: "completed", actorId: claim.requestedBy });
    }
    if (outcome.kind === "cancelled") {
      await applyOfficeFeeStepChange(tx, {
        orgId,
        controlPeriodId: claim.controlPeriodId,
        stage,
        stepStatus: "pending",
        actorId: claim.cancelRequestedBy ?? claim.requestedBy,
      });
    }
    return true;
  });
}
