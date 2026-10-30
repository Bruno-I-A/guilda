import "server-only";

import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { amountToCents, buildDpsId, type NfseCancelReasonCode } from "@/domain/nfse";
import { loadNfseCertificate, NfseCertificateError } from "@/lib/nfse/certificate";
import { runNfseJob, type NfseJob, type NfseJobOutcome } from "@/lib/nfse/processor";
import {
  createMtlsTransport,
  createSefinClient,
  NFSE_ENDPOINTS,
  type NfseEnvironmentName,
  type SefinClient,
} from "@/lib/nfse/sefin-client";
import type { NfseSigningKey } from "@/lib/nfse/sign";
import { parseNfseIssuerTemplate, type NfseIssuerTemplate } from "@/lib/nfse/template";
import { vaultEnvelopeSchema, VaultError, type VaultKey } from "@/lib/nfse/vault";
import { firstElementText } from "@/lib/nfse/xml";

import { nextDpsSeriesAfter } from "./suggest";
import { dpsConflictMessage, nfseXmlMismatch } from "./verify";

/**
 * O lado do serviço fiscal das notas dos clientes: reivindica uma nota da
 * fila, abre o certificado DA EMPRESA no cofre (só em memória, só para ela),
 * emite ou cancela com o mesmo runNfseJob dos honorários e grava o desfecho.
 *
 * Os logs daqui dizem só id e desfecho: nada de envelope, senha, certificado
 * ou XML.
 */

const LEASE_MINUTES = 5;

export interface ClientNfseClaim extends NfseJob {
  lockToken: string;
  issuerId: string;
  clientId: string;
  providerCnpj: string;
  template: NfseIssuerTemplate | null;
}

export async function claimClientNfseJob(orgId: string): Promise<ClientNfseClaim | null> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.clientNfseInvoices;
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
      takerCnpj: row.takerDocument,
      takerName: row.takerName,
      takerAddress: row.takerAddress ?? null,
      description: row.description,
      accessKey: row.accessKey,
      issuedEnvironment: row.environment === 1 || row.environment === 2 ? row.environment : null,
      cancelReasonCode: (row.cancelReasonCode as NfseCancelReasonCode | null) ?? null,
      cancelReasonText: row.cancelReasonText,
      lockToken,
      issuerId: row.issuerId,
      clientId: row.clientId,
      providerCnpj: row.providerCnpj,
      template: parseNfseIssuerTemplate(row.template),
    };
  });
}

function eventFor(claim: ClientNfseClaim, outcome: NfseJobOutcome) {
  switch (outcome.kind) {
    case "issued":
      return { eventType: "issued" as const, detail: { accessKey: outcome.accessKey, nfseNumber: outcome.nfseNumber, environment: outcome.environment } };
    case "failed":
      return { eventType: "failed" as const, detail: { message: outcome.message, errors: outcome.errors } };
    case "cancelled":
      return { eventType: "cancelled" as const, detail: {} };
    case "cancel_rejected":
      return {
        eventType: "cancel_failed" as const,
        detail: { message: outcome.message, errors: outcome.errors, reasonCode: claim.cancelReasonCode, reasonText: claim.cancelReasonText },
      };
    case "retry":
      return null;
  }
}

/** Grava o desfecho só se o lease ainda for desta rodada. */
export async function finishClientNfseJob(
  orgId: string,
  claim: ClientNfseClaim,
  outcome: NfseJobOutcome,
  xml: string | null,
): Promise<boolean> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.clientNfseInvoices;
    const now = new Date();
    const release = { lockedAt: null, lockToken: null, updatedAt: now };
    const values: Partial<typeof t.$inferInsert> =
      outcome.kind === "issued"
        ? {
            ...release,
            status: "issued",
            accessKey: outcome.accessKey,
            nfseNumber: outcome.nfseNumber,
            environment: outcome.environment,
            issuedAt: now,
            xmlGz: xml ? new Uint8Array(gzipSync(Buffer.from(xml, "utf8"))) : null,
            lastError: null,
          }
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
    if (event) await tx.insert(schema.clientNfseInvoiceEvents).values({ orgId, invoiceId: claim.id, actorId: null, ...event });
    return true;
  });
}

interface IssuerConnection {
  client: SefinClient;
  signingKey: NfseSigningKey;
}

/**
 * Abre o A1 da empresa para emitir. Confere de novo o que o app já conferiu:
 * certificado conferido, do CNPJ da nota e dentro da validade. As mensagens
 * do cofre e do certificado já são seguras; qualquer outra vira genérica.
 */
async function openIssuer(
  orgId: string,
  claim: ClientNfseClaim,
  vault: VaultKey,
  environment: NfseEnvironmentName,
): Promise<IssuerConnection | string> {
  const c = schema.nfseClientCertificates;
  const [row] = await withOrgTx(orgId, (tx) =>
    tx
      .select({ envelope: c.envelope, status: c.status, cnpj: c.certificateCnpj, validUntil: c.validUntil })
      .from(c)
      .where(and(eq(c.orgId, orgId), eq(c.clientId, claim.clientId))),
  );
  if (!row) return "A empresa não tem certificado A1 na Guilda.";
  if (row.status !== "valid" || row.cnpj !== claim.providerCnpj) return "O certificado da empresa não está válido para este CNPJ.";
  if (row.validUntil && row.validUntil <= new Date()) return "O certificado da empresa venceu.";
  const envelope = vaultEnvelopeSchema.safeParse(row.envelope);
  if (!envelope.success) return "O certificado da empresa precisa ser enviado de novo.";
  try {
    const secret = vault.open(envelope.data);
    const certificate = loadNfseCertificate(secret.pfx, secret.password);
    if (certificate.cnpj !== claim.providerCnpj) return "O certificado é de outro CNPJ.";
    return {
      client: createSefinClient(environment, createMtlsTransport({ privateKeyPem: certificate.privateKeyPem, chainPem: certificate.chainPem })),
      signingKey: { privateKeyPem: certificate.privateKeyPem, certificatePem: certificate.certificatePem },
    };
  } catch (error) {
    if (error instanceof VaultError || error instanceof NfseCertificateError) return error.message;
    return "Não foi possível abrir o certificado da empresa.";
  }
}

/**
 * Consome a fila das notas dos clientes até esvaziar. A conexão de cada
 * empresa fica aberta só durante esta chamada.
 */
export async function runClientNfseQueue(orgId: string, vault: VaultKey, environment: NfseEnvironmentName): Promise<void> {
  const tpAmb = NFSE_ENDPOINTS[environment].tpAmb;
  const connections = new Map<string, IssuerConnection | string>();
  const seriesMoves = new Map<string, number>();
  for (let claim = await claimClientNfseJob(orgId); claim; claim = await claimClientNfseJob(orgId)) {
    let connection = connections.get(claim.issuerId);
    if (!connection) {
      connection = await openIssuer(orgId, claim, vault, environment);
      connections.set(claim.issuerId, connection);
    }
    let outcome: NfseJobOutcome;
    let xml: string | null = null;
    if (!claim.template) {
      outcome = { kind: "failed", message: "O modelo fiscal guardado no pedido é inválido. Cancele e peça de novo.", errors: [] };
    } else if (typeof connection === "string") {
      outcome =
        claim.status === "queued"
          ? { kind: "failed", message: connection, errors: [] }
          : { kind: "cancel_rejected", message: connection, errors: [] };
    } else {
      outcome = await runNfseJob(claim, {
        client: connection.client,
        environment: tpAmb,
        providerCnpj: claim.providerCnpj,
        template: claim.template,
        signingKey: connection.signingKey,
        now: new Date(),
      });
      if (outcome.kind === "issued") {
        try {
          xml = await connection.client.getNfseXml(outcome.accessKey);
        } catch {
          // Sem o XML agora: a nota está emitida; o PDF usa o que a rotina de XML guardar.
          xml = null;
        }
        // Só a nota ACHADA pela DPS pode ser de outro sistema. A que a Guilda
        // acabou de emitir é nossa: marcá-la como erro esconderia uma nota
        // real, e trocar a série emitiria outra igual.
        const request = { providerCnpj: claim.providerCnpj, takerDocument: claim.takerCnpj, amountCents: claim.amountCents };
        const found = xml && outcome.foundByDps ? nfseXmlMismatch(xml, request) : null;
        const moves = seriesMoves.get(claim.issuerId) ?? 0;
        if (found && moves < MAX_SERIES_MOVES) {
          const moved = await moveToNextSeries(orgId, claim);
          if (moved) {
            seriesMoves.set(claim.issuerId, moves + 1);
            console.log(`Nota de cliente ${claim.id}: DPS ${moved.from}/${claim.dpsNumber} ocupada por outro sistema, renumerada para ${moved.to}/${moved.number}.`);
            continue;
          }
        }
        if (found) {
          outcome = {
            kind: "failed",
            message: dpsConflictMessage({ dpsSeries: claim.dpsSeries, dpsNumber: claim.dpsNumber, request, found }),
            errors: [],
          };
          xml = null;
        }
      }
    }
    const finished = await finishClientNfseJob(orgId, claim, outcome, xml);
    console.log(`Nota de cliente ${claim.id}: ${outcome.kind}${finished ? "" : " (lease vencido, descartado)"}.`);
  }
}

/** Quantas vezes uma empresa troca de série sozinha numa passada da fila. */
const MAX_SERIES_MOVES = 5;

/**
 * A DPS desta nota é de outro sistema da empresa — e a nota NÃO foi emitida:
 * a consulta achou a DPS ocupada antes de enviar. Passa a empresa para a
 * série seguinte que nenhuma nota guardada nem pedida usa e põe a nota de
 * volta na fila com número novo, sem ninguém trocar a série no cadastro. Se
 * outra nota já moveu a empresa, só renumera na série nova.
 */
export async function moveToNextSeries(orgId: string, claim: ClientNfseClaim): Promise<{ from: string; to: string; number: number } | null> {
  if (!claim.template) return null;
  const template = claim.template;
  return withOrgTx(orgId, async (tx) => {
    const issuers = schema.clientNfseIssuers;
    const t = schema.clientNfseInvoices;
    const [issuer] = await tx
      .select({ dpsSeries: issuers.dpsSeries, nextDpsNumber: issuers.nextDpsNumber })
      .from(issuers)
      .where(and(eq(issuers.orgId, orgId), eq(issuers.id, claim.issuerId)))
      .for("update");
    if (!issuer) return null;
    let series = issuer.dpsSeries;
    let number = issuer.nextDpsNumber;
    if (series === claim.dpsSeries) {
      const n = schema.nfseIssuedNotes;
      const stored = await tx.select({ xmlGz: n.xmlGz }).from(n).where(and(eq(n.orgId, orgId), eq(n.clientId, claim.clientId))).limit(20_000);
      const ours = await tx.selectDistinct({ series: t.dpsSeries }).from(t).where(and(eq(t.orgId, orgId), eq(t.issuerId, claim.issuerId)));
      const moved = nextDpsSeriesAfter(series, [
        ...stored.map((row) => firstElementText(gunzipSync(Buffer.from(row.xmlGz)).toString("utf8"), "serie")),
        ...ours.map((row) => row.series),
      ]);
      if (!moved) return null;
      series = moved;
      number = 1;
    }
    const now = new Date();
    const [renumbered] = await tx
      .update(t)
      .set({
        dpsSeries: series,
        dpsNumber: number,
        dpsId: buildDpsId({ cityCode: template.cityCode, cnpj: claim.providerCnpj, series, number }),
        status: "queued",
        attemptCount: 0,
        nextAttemptAt: now,
        lastError: null,
        lockedAt: null,
        lockToken: null,
        updatedAt: now,
      })
      .where(and(eq(t.orgId, orgId), eq(t.id, claim.id), eq(t.lockToken, claim.lockToken)))
      .returning({ id: t.id });
    if (!renumbered) return null;
    await tx.update(issuers).set({ dpsSeries: series, nextDpsNumber: number + 1 }).where(and(eq(issuers.orgId, orgId), eq(issuers.id, claim.issuerId)));
    await tx.insert(schema.clientNfseInvoiceEvents).values({
      orgId,
      invoiceId: claim.id,
      eventType: "retried",
      actorId: null,
      detail: { dpsSeries: series, dpsNumber: number, previousSeries: claim.dpsSeries, reason: "dps_taken_by_other_system" },
    });
    return { from: claim.dpsSeries, to: series, number };
  });
}
