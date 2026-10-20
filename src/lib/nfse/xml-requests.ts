import "server-only";

import { gunzipSync } from "node:zlib";

import { and, asc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  certificateState,
  type CertificateStatus,
  emissionMonthRange,
  XML_ROUTINE_DEFAULTS,
  xmlCompanyFolder,
  xmlNoteFileName,
  type XmlRoutineSchedule,
} from "@/domain/nfse-xml";

import type { ArchiveCompany, ArchiveMissing } from "./xml-archive";

export interface ClientCertificateView {
  status: CertificateStatus;
  statusMessage: string | null;
  certificateCnpj: string | null;
  validUntil: string | null;
  uploadedAt: string;
}

export async function loadClientCertificates(tx: OrgTx, orgId: string): Promise<Map<string, ClientCertificateView>> {
  const c = schema.nfseClientCertificates;
  const rows = await tx
    .select({ clientId: c.clientId, status: c.status, statusMessage: c.statusMessage, certificateCnpj: c.certificateCnpj, validUntil: c.validUntil, uploadedAt: c.uploadedAt })
    .from(c)
    .where(eq(c.orgId, orgId));
  return new Map(
    rows.map((row) => [
      row.clientId,
      { status: row.status, statusMessage: row.statusMessage, certificateCnpj: row.certificateCnpj, validUntil: row.validUntil?.toISOString() ?? null, uploadedAt: row.uploadedAt.toISOString() },
    ]),
  );
}

/** Chave pública do cofre; null quando o serviço fiscal ainda não publicou (ou não existe, como na homologação). */
export async function loadVaultPublicKey(tx: OrgTx, orgId: string): Promise<{ keyId: string; publicKeySpki: string } | null> {
  const [row] = await tx
    .select({ keyId: schema.nfseSettings.vaultKeyId, publicKeySpki: schema.nfseSettings.vaultPublicKey })
    .from(schema.nfseSettings)
    .where(eq(schema.nfseSettings.orgId, orgId));
  return row?.keyId && row.publicKeySpki ? { keyId: row.keyId, publicKeySpki: row.publicKeySpki } : null;
}

export interface XmlRoutineView {
  schedule: XmlRoutineSchedule;
  /** "AAAA-MM" ou null = histórico inteiro. */
  keepSince: string | null;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  runRequested: boolean;
  vaultReady: boolean;
  problems: { clientName: string; message: string }[];
}

export async function loadXmlRoutineView(tx: OrgTx, orgId: string, now: Date): Promise<XmlRoutineView> {
  const r = schema.nfseXmlRoutines;
  const [row] = await tx.select().from(r).where(eq(r.orgId, orgId));
  const certificates = await tx
    .select({ name: schema.clients.name, status: schema.nfseClientCertificates.status, validUntil: schema.nfseClientCertificates.validUntil })
    .from(schema.nfseClientCertificates)
    .innerJoin(schema.clients, and(eq(schema.clients.orgId, schema.nfseClientCertificates.orgId), eq(schema.clients.id, schema.nfseClientCertificates.clientId)))
    .where(eq(schema.nfseClientCertificates.orgId, orgId));
  const cursorErrors = await tx
    .select({ name: schema.clients.name, lastError: schema.nfseDfeCursors.lastError })
    .from(schema.nfseDfeCursors)
    .innerJoin(schema.clients, and(eq(schema.clients.orgId, schema.nfseDfeCursors.orgId), eq(schema.clients.id, schema.nfseDfeCursors.clientId)))
    .where(and(eq(schema.nfseDfeCursors.orgId, orgId), isNotNull(schema.nfseDfeCursors.lastError)));
  const problems = [
    ...certificates.flatMap((cert) => {
      const { state } = certificateState({ status: cert.status, validUntil: cert.validUntil, now });
      if (state === "expired") return [{ clientName: cert.name, message: "certificado vencido" }];
      if (state === "invalid") return [{ clientName: cert.name, message: "certificado com problema" }];
      return [];
    }),
    ...cursorErrors.map((cursor) => ({ clientName: cursor.name, message: (cursor.lastError ?? "").slice(0, 120) })),
  ];
  return {
    schedule: row ? { enabled: row.enabled, frequency: row.frequency, dayOfMonth: row.dayOfMonth, time: row.runTime } : XML_ROUTINE_DEFAULTS,
    keepSince: row?.keepSince?.slice(0, 7) ?? null,
    lastRunStartedAt: row?.lastRunStartedAt?.toISOString() ?? null,
    lastRunFinishedAt: row?.lastRunFinishedAt?.toISOString() ?? null,
    runRequested: Boolean(row?.runRequestedAt && (!row.lastRunStartedAt || row.runRequestedAt > row.lastRunStartedAt)),
    vaultReady: Boolean(await loadVaultPublicKey(tx, orgId)),
    problems,
  };
}

/** Quantas notas cada empresa emitiu no mês (e quantas foram canceladas). */
export async function countIssuedNotes(
  tx: OrgTx,
  input: { orgId: string; clientIds: string[]; year: number; month: number },
): Promise<Map<string, { total: number; cancelled: number }>> {
  if (input.clientIds.length === 0) return new Map();
  const n = schema.nfseIssuedNotes;
  const { start, end } = emissionMonthRange(input.year, input.month);
  const rows = await tx
    .select({
      clientId: n.clientId,
      total: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${n.cancelledAt} IS NOT NULL)::int`,
    })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), inArray(n.clientId, input.clientIds), gte(n.issuedAt, start), lt(n.issuedAt, end)))
    .groupBy(n.clientId);
  return new Map(rows.map((row) => [row.clientId, { total: row.total, cancelled: row.cancelled }]));
}

export interface XmlCompanyView {
  clientId: string;
  name: string;
  cnpj: string | null;
  certificate: ClientCertificateView | null;
  /** Notas emitidas no mês escolhido na aba. */
  notes: { total: number; cancelled: number };
  /** Leitura da rotina; null = a rotina ainda não passou pela empresa. */
  sync: { initialSyncAt: string | null; lastSyncedAt: string | null; lastError: string | null } | null;
}

/**
 * A lista da aba XML das notas: as empresas ativas, mais as inativas que
 * ainda têm certificado (para dar para remover), com o certificado, as notas
 * do mês e a última leitura.
 */
export async function loadXmlCompanies(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number },
): Promise<XmlCompanyView[]> {
  const cl = schema.clients;
  const c = schema.nfseClientCertificates;
  const rows = await tx
    .select({ clientId: cl.id, name: cl.name, cnpj: cl.cnpj })
    .from(cl)
    .leftJoin(c, and(eq(c.orgId, cl.orgId), eq(c.clientId, cl.id)))
    .where(and(eq(cl.orgId, input.orgId), or(eq(cl.active, true), isNotNull(c.id))))
    .orderBy(asc(cl.name));
  const clientIds = rows.map((row) => row.clientId);
  const certificates = await loadClientCertificates(tx, input.orgId);
  const counts = await countIssuedNotes(tx, { orgId: input.orgId, clientIds, year: input.year, month: input.month });
  const cur = schema.nfseDfeCursors;
  const cursors = new Map(
    (
      await tx
        .select({ clientId: cur.clientId, initialSyncAt: cur.initialSyncAt, lastSyncedAt: cur.lastSyncedAt, lastError: cur.lastError })
        .from(cur)
        .where(eq(cur.orgId, input.orgId))
    ).map((row) => [row.clientId, row]),
  );
  return rows.map((row) => {
    const cursor = cursors.get(row.clientId);
    return {
      ...row,
      certificate: certificates.get(row.clientId) ?? null,
      notes: counts.get(row.clientId) ?? { total: 0, cancelled: 0 },
      sync: cursor
        ? {
            initialSyncAt: cursor.initialSyncAt?.toISOString() ?? null,
            lastSyncedAt: cursor.lastSyncedAt?.toISOString() ?? null,
            lastError: cursor.lastError,
          }
        : null,
    };
  });
}

/** Os meses da pasta de uma empresa, do mais recente ao mais antigo (mês de emissão em Brasília). */
export async function loadClientXmlMonths(
  tx: OrgTx,
  input: { orgId: string; clientId: string },
): Promise<{ year: number; month: number; total: number; cancelled: number }[]> {
  const n = schema.nfseIssuedNotes;
  const monthKey = sql<string>`to_char((${n.issuedAt} AT TIME ZONE 'UTC') - interval '3 hours', 'YYYY-MM')`;
  const rows = await tx
    .select({
      month: monthKey,
      total: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${n.cancelledAt} IS NOT NULL)::int`,
    })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), eq(n.clientId, input.clientId)))
    .groupBy(monthKey)
    .orderBy(sql`1 DESC`);
  return rows.map((row) => ({ year: Number(row.month.slice(0, 4)), month: Number(row.month.slice(5, 7)), total: row.total, cancelled: row.cancelled }));
}

/**
 * O que vai no download do mês: as empresas do Controle mensal daquela
 * competência (ou só uma) com as notas do período, e, no do mês inteiro, o
 * LEIA-ME das que têm "Importar notas" marcado e ficaram sem XML.
 */
export async function loadXmlArchiveInput(
  tx: OrgTx,
  input: { orgId: string; year: number; month: number; clientId?: string; now: Date },
): Promise<{ companies: ArchiveCompany[]; missing: ArchiveMissing[] }> {
  const fcp = schema.fiscalControlPeriods;
  const cl = schema.clients;
  // Uma empresa (pasta dela, ou a linha do controle): direto do cadastro, esteja
  // ou não no controle daquele mês. O mês inteiro: as empresas do controle.
  const controlRows: { clientId: string; name: string; cnpj: string | null; nfsApplicability: string | null }[] = input.clientId
    ? await tx
        .select({ clientId: cl.id, name: cl.name, cnpj: cl.cnpj, nfsApplicability: sql<string | null>`NULL` })
        .from(cl)
        .where(and(eq(cl.orgId, input.orgId), eq(cl.id, input.clientId)))
    : await tx
        .select({ clientId: fcp.clientId, name: cl.name, cnpj: cl.cnpj, nfsApplicability: schema.fiscalClientProfiles.nfsApplicability })
        .from(fcp)
        .innerJoin(cl, and(eq(cl.orgId, fcp.orgId), eq(cl.id, fcp.clientId)))
        .leftJoin(schema.fiscalClientProfiles, and(eq(schema.fiscalClientProfiles.orgId, fcp.orgId), eq(schema.fiscalClientProfiles.id, fcp.profileId)))
        .where(and(eq(fcp.orgId, input.orgId), eq(fcp.periodYear, input.year), eq(fcp.periodMonth, input.month)))
        .orderBy(asc(cl.name));
  const n = schema.nfseIssuedNotes;
  const { start, end } = emissionMonthRange(input.year, input.month);
  if (!input.clientId) {
    // Quem tem nota guardada no período entra mesmo sem a competência aberta
    // no Controle mensal: a aba XML das notas baixa qualquer mês.
    const known = new Set(controlRows.map((row) => row.clientId));
    const withNotes = await tx
      .selectDistinct({ clientId: cl.id, name: cl.name, cnpj: cl.cnpj })
      .from(n)
      .innerJoin(cl, and(eq(cl.orgId, n.orgId), eq(cl.id, n.clientId)))
      .where(and(eq(n.orgId, input.orgId), gte(n.issuedAt, start), lt(n.issuedAt, end)));
    for (const row of withNotes) if (!known.has(row.clientId)) controlRows.push({ ...row, nfsApplicability: null });
    controlRows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }
  const clientIds = controlRows.map((row) => row.clientId);
  if (clientIds.length === 0) return { companies: [], missing: [] };

  const notes = await tx
    .select({ clientId: n.clientId, nsu: n.nsu, nfseNumber: n.nfseNumber, xmlGz: n.xmlGz, cancelXmlGz: n.cancelXmlGz })
    .from(n)
    .where(and(eq(n.orgId, input.orgId), inArray(n.clientId, clientIds), gte(n.issuedAt, start), lt(n.issuedAt, end)))
    .orderBy(asc(n.nfseNumber), asc(n.nsu));
  const certificates = await loadClientCertificates(tx, input.orgId);
  const cursors = new Map(
    (
      await tx
        .select({ clientId: schema.nfseDfeCursors.clientId, initialSyncAt: schema.nfseDfeCursors.initialSyncAt, lastError: schema.nfseDfeCursors.lastError })
        .from(schema.nfseDfeCursors)
        .where(and(eq(schema.nfseDfeCursors.orgId, input.orgId), inArray(schema.nfseDfeCursors.clientId, clientIds)))
    ).map((row) => [row.clientId, row]),
  );

  const companies: ArchiveCompany[] = [];
  const missing: ArchiveMissing[] = [];
  for (const row of controlRows) {
    const mine = notes.filter((note) => note.clientId === row.clientId);
    if (mine.length > 0) {
      companies.push({
        folder: xmlCompanyFolder(row.name, row.cnpj),
        notes: mine.map((note) => ({
          // A numeracao pode se repetir em anos/series diferentes no mesmo mes.
          fileName: mine.filter((other) => xmlNoteFileName(other.nfseNumber, other.nsu) === xmlNoteFileName(note.nfseNumber, note.nsu)).length > 1
            ? xmlNoteFileName(note.nfseNumber, note.nsu).replace(/\.xml$/, `-nsu-${note.nsu}.xml`)
            : xmlNoteFileName(note.nfseNumber, note.nsu),
          xml: gunzipSync(note.xmlGz).toString("utf8"),
          cancellation: note.cancelXmlGz ? gunzipSync(note.cancelXmlGz).toString("utf8") : null,
        })),
      });
      continue;
    }
    if (row.nfsApplicability !== "required" && !input.clientId) continue;
    const certificate = certificates.get(row.clientId);
    const cursor = cursors.get(row.clientId);
    const { state } = certificateState({ status: certificate?.status ?? null, validUntil: certificate?.validUntil ? new Date(certificate.validUntil) : null, now: input.now });
    const reason =
      state === "missing" ? "sem certificado cadastrado"
      : state === "pending" ? "certificado ainda em conferência"
      : state === "invalid" ? `certificado com problema: ${certificate?.statusMessage ?? "envie de novo"}`
      : state === "expired" ? "certificado vencido"
      : !cursor?.initialSyncAt ? (cursor?.lastError ? `a primeira leitura falhou: ${cursor.lastError}` : "primeira leitura ainda não feita")
      : cursor.lastError ? `a última rodada falhou: ${cursor.lastError}`
      : "nenhuma nota emitida no período";
    missing.push({ companyName: row.name, reason });
  }
  return { companies, missing };
}
