import "server-only";

import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { amountToCents, buildDpsId, type NfseCancelReasonCode } from "@/domain/nfse";
import { isProxyAuthorizationError, proxyEmissionProblem } from "@/domain/nfse-credentials";
import { loadNfseCertificate, NfseCertificateError } from "@/lib/nfse/certificate";
import { loadClientCredential, saveProxyStatus } from "@/lib/nfse/credentials-repository";
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
import { dpsConflictMessage, issuedBeforeRequest, nfseDateLabel, nfseXmlDps, nfseXmlIssuedAt, nfseXmlMismatch } from "./verify";

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
  requestedAt: Date;
  /** Alguma tentativa caiu no meio sem resposta clara: a nota pode ter saído. */
  emissionUncertain: boolean;
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
      requestedAt: row.createdAt,
      emissionUncertain: row.emissionUncertain,
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
            ? {
                ...release,
                lastError: outcome.message,
                nextAttemptAt: new Date(now.getTime() + outcome.delayMinutes * 60_000),
                // Emissão que caiu no meio pode ter gerado a nota: o E0014 não troca a série sozinho.
                ...(claim.status === "queued" ? { emissionUncertain: true } : {}),
              }
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

/** O A1 do escritório (o dos honorários), para emitir por procuração. Vem do serviço fiscal. */
export interface OfficeIssuer {
  client: SefinClient;
  signingKey: NfseSigningKey;
}

interface IssuerConnection {
  client: SefinClient;
  signingKey: NfseSigningKey;
  viaProxy: boolean;
}

/**
 * A conexão que emite pela empresa. Por procuração, o A1 do escritório (sem
 * troca silenciosa para o certificado da empresa: procuração recusada para a
 * nota com o motivo). Por certificado, abre o A1 da empresa e confere de novo
 * o que o app já conferiu: certificado conferido, do CNPJ da nota e dentro da
 * validade. As mensagens do cofre e do certificado já são seguras; qualquer
 * outra vira genérica.
 */
async function openIssuer(
  orgId: string,
  claim: ClientNfseClaim,
  vault: VaultKey,
  environment: NfseEnvironmentName,
  office: OfficeIssuer | null,
): Promise<IssuerConnection | string> {
  const credential = await loadClientCredential(orgId, claim.clientId);
  if (credential.mode === "proxy") {
    const problem = proxyEmissionProblem(credential.proxyStatus);
    if (problem) return problem;
    if (!office) return "O A1 do escritório não está disponível no serviço fiscal.";
    return { client: office.client, signingKey: office.signingKey, viaProxy: true };
  }
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
      viaProxy: false,
    };
  } catch (error) {
    if (error instanceof VaultError || error instanceof NfseCertificateError) return error.message;
    return "Não foi possível abrir o certificado da empresa.";
  }
}

/**
 * Conserta as notas que a conferência antiga adotou por engano: a DPS já era
 * de uma nota antiga da empresa, com o mesmo tomador e valor, e nada foi
 * emitido. Voltam para "com erro" (o Fiscal decide reemitir) e o pedido de
 * cancelamento pendente cai: cancelaria a nota antiga, que é verdadeira.
 */
export async function repairAdoptedClientNfse(orgId: string): Promise<number> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.clientNfseInvoices;
    const rows = await tx
      .select({ id: t.id, status: t.status, createdAt: t.createdAt, xmlGz: t.xmlGz, accessKey: t.accessKey, nfseNumber: t.nfseNumber, dpsSeries: t.dpsSeries, dpsNumber: t.dpsNumber })
      .from(t)
      .where(and(eq(t.orgId, orgId), inArray(t.status, ["issued", "cancel_requested", "cancelled"]), isNotNull(t.xmlGz)));
    let repaired = 0;
    for (const row of rows) {
      const issuedAt = nfseXmlIssuedAt(gunzipSync(Buffer.from(row.xmlGz!)).toString("utf8"));
      if (!issuedBeforeRequest(issuedAt, row.createdAt)) continue;
      // Já cancelada: o cancelamento foi ao Sistema Nacional e não se desfaz aqui.
      if (row.status === "cancelled") {
        console.error(`Nota de cliente ${row.id}: cancelada, mas era uma nota anterior ao pedido. Conferir no Portal.`);
        continue;
      }
      const lastError =
        `Esta nota NÃO foi emitida: a DPS ${row.dpsSeries}/${row.dpsNumber} já era da NFS-e nº ${row.nfseNumber ?? "?"}, de ${nfseDateLabel(issuedAt!)}, ` +
        "e a Guilda a tomou por esta nota por engano. Clique em Tentar de novo para emitir.";
      await tx
        .update(t)
        .set({ status: "failed", accessKey: null, nfseNumber: null, environment: null, issuedAt: null, xmlGz: null, lastError, cancelRequestedBy: null, cancelReasonCode: null, cancelReasonText: null, updatedAt: new Date() })
        .where(and(eq(t.orgId, orgId), eq(t.id, row.id)));
      await tx.insert(schema.clientNfseInvoiceEvents).values({
        orgId,
        invoiceId: row.id,
        eventType: "failed",
        actorId: null,
        detail: { message: lastError, errors: [], adoptedAccessKey: row.accessKey, adoptedNfseNumber: row.nfseNumber },
      });
      repaired += 1;
    }
    return repaired;
  });
}

const repairedOrgs = new Set<string>();

/** XML que a rotina da aba XML já guardou desta nota; null = ainda não leu. */
async function storedNoteXml(orgId: string, accessKey: string): Promise<string | null> {
  const n = schema.nfseIssuedNotes;
  const [row] = await withOrgTx(orgId, (tx) => tx.select({ xmlGz: n.xmlGz }).from(n).where(and(eq(n.orgId, orgId), eq(n.accessKey, accessKey))));
  return row ? gunzipSync(Buffer.from(row.xmlGz)).toString("utf8") : null;
}

/**
 * A nota da empresa que usou esta série e número de DPS, entre as que a rotina
 * da aba XML guardou (inclusive cancelada: a DPS continua ocupada).
 */
export async function storedNoteByDps(orgId: string, clientId: string, series: string, number: number): Promise<{ accessKey: string; xml: string } | null> {
  const n = schema.nfseIssuedNotes;
  const wanted = series.trim().replace(/^0+(?=\d)/, "");
  const rows = await withOrgTx(orgId, (tx) => tx.select({ accessKey: n.accessKey, xmlGz: n.xmlGz }).from(n)
    .where(and(eq(n.orgId, orgId), eq(n.clientId, clientId)))
    .orderBy(desc(n.issuedAt))
    .limit(20_000));
  for (const row of rows) {
    const xml = gunzipSync(Buffer.from(row.xmlGz)).toString("utf8");
    const dps = nfseXmlDps(xml);
    if (dps.series === wanted && dps.number === number) return { accessKey: row.accessKey, xml };
  }
  return null;
}

/**
 * E0014: o Sistema Nacional diz que a DPS já gerou uma nota, mas a consulta da
 * DPS não a devolve (2026-11-25, Estética Urban, DPS 900/1, sem nota nenhuma
 * no Portal). Primeiro a nota é procurada nas emitidas que a aba XML guardou:
 * achada, segue o caminho da nota achada pela DPS (é desta emissão e é
 * adotada, ou é de outro sistema e a empresa passa para a próxima série).
 *
 * Não achada, a DPS está ocupada por algo que a Guilda não vê. Se nenhuma
 * tentativa desta nota caiu no meio do envio, ela não saiu por aqui: a
 * empresa passa para a próxima série sozinha (`move`), como o Bruno pediu.
 * Só depois de um envio incerto a nota pode ter saído, e aí a troca às cegas
 * duplicaria: pede a conferência antes.
 */
export async function resolveTakenDps(
  orgId: string,
  claim: Pick<ClientNfseClaim, "clientId" | "dpsSeries" | "dpsNumber" | "emissionUncertain">,
  outcome: NfseJobOutcome,
  environment: 1 | 2,
): Promise<{ kind: "found"; outcome: NfseJobOutcome; xml: string } | { kind: "move" } | { kind: "check"; outcome: NfseJobOutcome } | null> {
  if (outcome.kind !== "failed" || !outcome.errors.some((error) => error.code === "E0014")) return null;
  const stored = await storedNoteByDps(orgId, claim.clientId, claim.dpsSeries, claim.dpsNumber);
  if (stored) {
    return {
      kind: "found",
      outcome: { kind: "issued", accessKey: stored.accessKey, nfseNumber: firstElementText(stored.xml, "nNFSe"), environment, foundByDps: true },
      xml: stored.xml,
    };
  }
  if (!claim.emissionUncertain) return { kind: "move" };
  return {
    kind: "check",
    outcome: {
      ...outcome,
      message: `${outcome.message} Uma tentativa anterior desta nota caiu no meio do envio, então ela pode já ter saído. Confira no Portal Nacional: se não houver nota com a DPS ${claim.dpsSeries}/${claim.dpsNumber}, troque a série nos Dados fiscais e clique em "Tentar de novo"; se houver, rode "Rodar agora" na aba XML e depois "Tentar de novo" para a Guilda registrá-la.`,
    },
  };
}

/**
 * Consome a fila das notas dos clientes até esvaziar. A conexão de cada
 * empresa fica aberta só durante esta chamada. `office` é o A1 do escritório,
 * para as empresas que emitem por procuração.
 */
export async function runClientNfseQueue(
  orgId: string,
  vault: VaultKey,
  environment: NfseEnvironmentName,
  office: OfficeIssuer | null = null,
): Promise<void> {
  // Antes de pegar a fila: um cancelamento pendente de nota adotada cancelaria a antiga.
  if (!repairedOrgs.has(orgId)) {
    const repaired = await repairAdoptedClientNfse(orgId);
    repairedOrgs.add(orgId);
    if (repaired > 0) console.log(`Notas de cliente: ${repaired} adotada(s) por engano voltaram para com erro.`);
  }
  const tpAmb = NFSE_ENDPOINTS[environment].tpAmb;
  const connections = new Map<string, IssuerConnection | string>();
  const seriesMoves = new Map<string, number>();
  for (let claim = await claimClientNfseJob(orgId); claim; claim = await claimClientNfseJob(orgId)) {
    let connection = connections.get(claim.issuerId);
    if (!connection) {
      connection = await openIssuer(orgId, claim, vault, environment, office);
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
        // O XML em três fontes, nesta ordem: a resposta da emissão, a consulta
        // pela chave (recusada por procuração) e o que a rotina da aba XML guardou.
        xml = outcome.xml ?? null;
        if (!xml) {
          try {
            xml = await connection.client.getNfseXml(outcome.accessKey);
          } catch {
            xml = null;
          }
        }
        xml ??= await storedNoteXml(orgId, outcome.accessKey);
        if (!outcome.nfseNumber && xml) outcome = { ...outcome, nfseNumber: firstElementText(xml, "nNFSe") };
      }
      // E0014 sem a nota na consulta da DPS: procura nas notas guardadas pela aba XML.
      const taken = await resolveTakenDps(orgId, claim, outcome, tpAmb);
      if (taken?.kind === "found") {
        outcome = taken.outcome;
        xml = taken.xml;
      } else if (taken?.kind === "check") {
        outcome = taken.outcome;
      } else if (taken?.kind === "move") {
        // A DPS está ocupada no Sistema Nacional e esta nota nunca saiu por aqui: próxima série.
        const moves = seriesMoves.get(claim.issuerId) ?? 0;
        const moved = moves < MAX_SERIES_MOVES ? await moveToNextSeries(orgId, claim) : null;
        if (moved) {
          seriesMoves.set(claim.issuerId, moves + 1);
          console.log(`Nota de cliente ${claim.id}: DPS ${moved.from}/${claim.dpsNumber} ocupada no Sistema Nacional (E0014), renumerada para ${moved.to}/${moved.number}.`);
          continue;
        }
      }
      // A nota ACHADA pela DPS pode ser de outro sistema e precisa ser conferida.
      // Sem XML não se adota no escuro: erro, e o Tentar de novo confere depois.
      // A recém-emitida sem XML segue emitida: o PDF usa o que a rotina guardar.
      if (outcome.kind === "issued" && outcome.foundByDps && !xml) {
        outcome = {
          kind: "failed",
          message: "Não foi possível conferir a nota achada pela DPS. Tente de novo depois da próxima leitura dos XML.",
          errors: [],
        };
      }
      if (outcome.kind === "failed" && connection.viaProxy && isProxyAuthorizationError(outcome.errors)) {
        await saveProxyStatus(orgId, claim.clientId, { status: "no_emission", code: outcome.errors[0]?.code ?? null, message: outcome.message, checkedAt: new Date() });
      }
      if (outcome.kind === "issued") {
        // Só a nota ACHADA pela DPS pode ser de outro sistema. A que a Guilda
        // acabou de emitir é nossa: marcá-la como erro esconderia uma nota
        // real, e trocar a série emitiria outra igual.
        const request = { providerCnpj: claim.providerCnpj, takerDocument: claim.takerCnpj, amountCents: claim.amountCents, requestedAt: claim.requestedAt };
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
