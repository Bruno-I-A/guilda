import "server-only";

import { gzipSync } from "node:zlib";

import { and, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { XML_ROUTINE_DEFAULTS, type XmlRoutineSchedule } from "@/domain/nfse-xml";

import type { CertificateCheck } from "./certificate-check";
import type { VaultEnvelope } from "./vault";
import type { ClientProgress } from "./xml-routine";

/**
 * Persistência do serviço fiscal para o XML das NFS-e prestadas das empresas:
 * a chave pública do cofre, a conferência dos certificados, o estado da rotina
 * e a pasta de XML (notas, cancelamentos e o cursor de NSU de cada empresa).
 */

const gz = (xml: string) => gzipSync(Buffer.from(xml, "utf8"));

/** Publica a chave pública do cofre quando ela muda (troca da NFSE_VAULT_PRIVATE_KEY). */
export async function publishVaultKey(orgId: string, key: { keyId: string; publicKeySpki: string }): Promise<void> {
  const t = schema.nfseSettings;
  await withOrgTx(orgId, (tx) =>
    tx
      .update(t)
      .set({ vaultKeyId: key.keyId, vaultPublicKey: key.publicKeySpki })
      .where(and(eq(t.orgId, orgId), sql`${t.vaultKeyId} IS DISTINCT FROM ${key.keyId}`)),
  );
}

export interface PendingCertificate {
  id: string;
  clientCnpj: string | null;
  /** A wrappedKey do envelope identifica o envio (ver saveCertificateCheck). */
  envelope: VaultEnvelope;
}

export async function listPendingCertificates(orgId: string): Promise<PendingCertificate[]> {
  const c = schema.nfseClientCertificates;
  return withOrgTx(orgId, (tx) =>
    tx
      .select({ id: c.id, clientCnpj: schema.clients.cnpj, envelope: c.envelope })
      .from(c)
      .innerJoin(schema.clients, and(eq(schema.clients.orgId, c.orgId), eq(schema.clients.id, c.clientId)))
      .where(and(eq(c.orgId, orgId), eq(c.status, "pending"))),
  );
}

/**
 * Grava a conferência só se o certificado ainda é o mesmo envio: um reenvio
 * no meio vence. O envio é identificado pela wrappedKey do envelope (cada
 * envio sorteia uma chave AES nova), não pelo uploaded_at — o Postgres guarda
 * microssegundos e o Date do JavaScript só milissegundos, e a comparação nunca
 * casaria.
 */
export async function saveCertificateCheck(
  orgId: string,
  input: { id: string; wrappedKey: string; result: CertificateCheck; now: Date },
): Promise<void> {
  const c = schema.nfseClientCertificates;
  const values =
    input.result.status === "valid"
      ? { status: "valid" as const, statusMessage: null, certificateCnpj: input.result.cnpj, validUntil: input.result.validUntil }
      : { status: "invalid" as const, statusMessage: input.result.message.slice(0, 500), certificateCnpj: null, validUntil: null };
  await withOrgTx(orgId, (tx) =>
    tx
      .update(c)
      .set({ ...values, checkedAt: input.now })
      .where(
        and(
          eq(c.orgId, orgId),
          eq(c.id, input.id),
          eq(c.status, "pending"),
          sql`${c.envelope}->>'wrappedKey' = ${input.wrappedKey}`,
        ),
      ),
  );
}

export interface XmlRoutineState {
  schedule: XmlRoutineSchedule;
  /** "AAAA-MM-DD" ou null. */
  keepSince: string | null;
  runRequestedAt: Date | null;
  lastRunStartedAt: Date | null;
  lastRunFinishedAt: Date | null;
}

export async function loadXmlRoutineState(orgId: string): Promise<XmlRoutineState> {
  const r = schema.nfseXmlRoutines;
  const [row] = await withOrgTx(orgId, (tx) => tx.select().from(r).where(eq(r.orgId, orgId)));
  if (!row) {
    return { schedule: XML_ROUTINE_DEFAULTS, keepSince: null, runRequestedAt: null, lastRunStartedAt: null, lastRunFinishedAt: null };
  }
  return {
    schedule: { enabled: row.enabled, frequency: row.frequency, dayOfMonth: row.dayOfMonth, time: row.runTime },
    keepSince: row.keepSince,
    runRequestedAt: row.runRequestedAt,
    lastRunStartedAt: row.lastRunStartedAt,
    lastRunFinishedAt: row.lastRunFinishedAt,
  };
}

/**
 * Marca o início ou o fim da rodada. O início não mexe no fim: rodada
 * interrompida fica com o fim anterior ao início, e é assim que
 * isXmlRoutineDue a reconhece.
 */
export async function markXmlRoutineRun(orgId: string, mark: { startedAt: Date } | { finishedAt: Date }): Promise<void> {
  const r = schema.nfseXmlRoutines;
  const set = "startedAt" in mark ? { lastRunStartedAt: mark.startedAt } : { lastRunFinishedAt: mark.finishedAt };
  await withOrgTx(orgId, (tx) =>
    tx.insert(r).values({ orgId, ...set }).onConflictDoUpdate({ target: r.orgId, set }),
  );
}

/** Empresas ativas com CNPJ e certificado válido e não vencido, com o cursor. */
export async function listRoutineClients(
  orgId: string,
  now: Date,
): Promise<{ clientId: string; cnpj: string; lastNsu: number; envelope: VaultEnvelope }[]> {
  const c = schema.nfseClientCertificates;
  const cl = schema.clients;
  const cur = schema.nfseDfeCursors;
  const rows = await withOrgTx(orgId, (tx) =>
    tx
      .select({ clientId: c.clientId, cnpj: cl.cnpj, lastNsu: cur.lastNsu, envelope: c.envelope })
      .from(c)
      .innerJoin(cl, and(eq(cl.orgId, c.orgId), eq(cl.id, c.clientId)))
      .leftJoin(cur, and(eq(cur.orgId, c.orgId), eq(cur.clientId, c.clientId)))
      .where(and(eq(c.orgId, orgId), eq(c.status, "valid"), gt(c.validUntil, now), eq(cl.active, true), ne(cl.taxRegime, "mei"), isNotNull(cl.cnpj)))
      .orderBy(cl.name),
  );
  // O filtro isNotNull garante o CNPJ; o tipo da coluna não sabe disso.
  return rows.map((row) => ({ clientId: row.clientId, cnpj: row.cnpj as string, lastNsu: row.lastNsu ?? 0, envelope: row.envelope }));
}

/**
 * Grava um lote e avança o cursor na mesma transação (rodada interrompida
 * retoma sem duplicar). Ordem: notas, cancelamentos (a nota cancelada pode
 * ter vindo no mesmo lote), cursor. O cursor nunca volta (GREATEST) e a
 * primeira leitura completa fica marcada em initial_sync_at.
 */
export async function saveAdnProgress(orgId: string, progress: ClientProgress, now: Date): Promise<void> {
  const n = schema.nfseIssuedNotes;
  const cur = schema.nfseDfeCursors;
  await withOrgTx(orgId, async (tx) => {
    if (progress.issued.length > 0) {
      await tx
        .insert(n)
        .values(
          progress.issued.map((note) => ({
            orgId,
            clientId: progress.clientId,
            accessKey: note.accessKey,
            nsu: note.nsu,
            nfseNumber: note.nfseNumber,
            issuedAt: note.issuedAt,
            competence: note.competence,
            xmlGz: gz(note.xml),
          })),
        )
        .onConflictDoNothing({ target: [n.orgId, n.accessKey] });
    }
    for (const cancellation of progress.cancellations) {
      // Só a nota da própria empresa, e só a primeira vez.
      await tx
        .update(n)
        .set({ cancelledAt: cancellation.cancelledAt ?? now, cancelNsu: cancellation.nsu, cancelXmlGz: gz(cancellation.xml) })
        .where(and(eq(n.orgId, orgId), eq(n.clientId, progress.clientId), eq(n.accessKey, cancellation.accessKey), isNull(n.cancelledAt)));
    }
    // Data em ISO: o driver pg não converte Date dentro de sql``.
    const finished = progress.finished
      ? { lastSyncedAt: now, initialSyncAt: sql`COALESCE(${cur.initialSyncAt}, ${now.toISOString()}::timestamptz)` }
      : {};
    await tx
      .insert(cur)
      .values({
        orgId,
        clientId: progress.clientId,
        lastNsu: progress.lastNsu,
        lastError: null,
        updatedAt: now,
        ...(progress.finished ? { lastSyncedAt: now, initialSyncAt: now } : {}),
      })
      .onConflictDoUpdate({
        target: [cur.orgId, cur.clientId],
        set: { lastNsu: sql`GREATEST(${cur.lastNsu}, excluded.last_nsu)`, lastError: null, updatedAt: now, ...finished },
      });
  });
}

/** Erro da leitura de uma empresa; o cursor fica onde estava (ou nasce no 0). */
export async function saveAdnError(orgId: string, clientId: string, message: string, now: Date): Promise<void> {
  const cur = schema.nfseDfeCursors;
  const lastError = message.slice(0, 500);
  await withOrgTx(orgId, (tx) =>
    tx
      .insert(cur)
      .values({ orgId, clientId, lastError, updatedAt: now })
      .onConflictDoUpdate({ target: [cur.orgId, cur.clientId], set: { lastError, updatedAt: now } }),
  );
}
