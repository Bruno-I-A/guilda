import "server-only";

import { and, eq, inArray, isNotNull, lte, min, ne, sql } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { effectiveCredentialMode, type CredentialMode, type ProxyStatus } from "@/domain/nfse-credentials";
import { nfseIssuer } from "@/domain/nfse-service";

/**
 * Procuração (decisão de 2026-11-18): o padrão do escritório, a credencial de
 * cada empresa e os pedidos de teste. As funções `...In`/`...For` recebem a
 * transação de quem chama (o app, dentro de asFiscalOperator); as demais
 * abrem a sua (serviço fiscal).
 */

export interface CredentialPolicy {
  defaultMode: CredentialMode;
  proxyTestRequestedAt: Date | null;
}

export async function credentialPolicyIn(tx: OrgTx, orgId: string): Promise<CredentialPolicy> {
  const s = schema.nfseCredentialSettings;
  const [row] = await tx.select({ defaultMode: s.defaultMode, proxyTestRequestedAt: s.proxyTestRequestedAt }).from(s).where(eq(s.orgId, orgId));
  return { defaultMode: row?.defaultMode ?? "certificate", proxyTestRequestedAt: row?.proxyTestRequestedAt ?? null };
}

export interface ClientCredential {
  /** O modo que vale, já com o padrão do escritório. */
  mode: CredentialMode;
  /** O que foi marcado na empresa; null = segue o padrão. */
  explicitMode: CredentialMode | null;
  proxyStatus: ProxyStatus;
}

export async function clientCredentialIn(tx: OrgTx, orgId: string, clientId: string): Promise<ClientCredential> {
  const policy = await credentialPolicyIn(tx, orgId);
  const cc = schema.nfseClientCredentials;
  const [row] = await tx.select({ mode: cc.mode, proxyStatus: cc.proxyStatus }).from(cc).where(and(eq(cc.orgId, orgId), eq(cc.clientId, clientId)));
  return {
    mode: effectiveCredentialMode(row?.mode, policy.defaultMode),
    explicitMode: row?.mode ?? null,
    proxyStatus: row?.proxyStatus ?? "untested",
  };
}

export function loadClientCredential(orgId: string, clientId: string): Promise<ClientCredential> {
  return withOrgTx(orgId, (tx) => clientCredentialIn(tx, orgId, clientId));
}

export async function setDefaultModeIn(tx: OrgTx, orgId: string, input: { mode: CredentialMode; actorId: string; now: Date }): Promise<void> {
  const s = schema.nfseCredentialSettings;
  const values = { defaultMode: input.mode, updatedBy: input.actorId, updatedAt: input.now };
  await tx.insert(s).values({ orgId, ...values }).onConflictDoUpdate({ target: s.orgId, set: values });
}

export async function setClientModeIn(
  tx: OrgTx,
  orgId: string,
  input: { clientId: string; mode: CredentialMode | null; actorId: string; now: Date },
): Promise<void> {
  const cc = schema.nfseClientCredentials;
  const values = { mode: input.mode, updatedBy: input.actorId, updatedAt: input.now };
  await tx.insert(cc).values({ orgId, clientId: input.clientId, ...values }).onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: values });
}

/** clientId null = todas as empresas de serviço; senão, só ela. */
export async function requestProxyTestFor(tx: OrgTx, orgId: string, input: { clientId: string | null; actorId: string; now: Date }): Promise<void> {
  if (input.clientId === null) {
    const s = schema.nfseCredentialSettings;
    await tx
      .insert(s)
      .values({ orgId, proxyTestRequestedAt: input.now, updatedBy: input.actorId, updatedAt: input.now })
      .onConflictDoUpdate({ target: s.orgId, set: { proxyTestRequestedAt: input.now } });
    return;
  }
  const cc = schema.nfseClientCredentials;
  await tx
    .insert(cc)
    .values({ orgId, clientId: input.clientId, proxyTestRequestedAt: input.now, updatedBy: input.actorId, updatedAt: input.now })
    .onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: { proxyTestRequestedAt: input.now } });
}

/**
 * A leitura desta empresa recomeça do zero com a credencial nova (decisão 4
 * do desenho), como a migração 0100: nada se apaga, nota repetida é ignorada.
 * A releitura do histórico em andamento também recomeça.
 */
export async function resetCursorForMode(orgId: string, clientId: string, mode: CredentialMode, now: Date): Promise<void> {
  await withOrgTx(orgId, async (tx) => {
    const cur = schema.nfseDfeCursors;
    await tx
      .insert(cur)
      .values({ orgId, clientId, lastNsu: 0, updatedAt: now })
      .onConflictDoUpdate({
        target: [cur.orgId, cur.clientId],
        set: { lastNsu: 0, historyNsu: sql`CASE WHEN ${cur.historyNsu} IS NULL THEN NULL ELSE 0 END`, updatedAt: now },
      });
    const cc = schema.nfseClientCredentials;
    await tx
      .insert(cc)
      .values({ orgId, clientId, readMode: mode, updatedAt: now })
      .onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: { readMode: mode, updatedAt: now } });
  });
}

export async function saveProxyStatus(
  orgId: string,
  clientId: string,
  input: { status: ProxyStatus; code: string | null; message: string | null; checkedAt: Date; sameSequence?: boolean | null },
): Promise<void> {
  const cc = schema.nfseClientCredentials;
  const values = {
    proxyStatus: input.status,
    proxyCode: input.code?.slice(0, 30) ?? null,
    proxyMessage: input.message?.slice(0, 300) ?? null,
    proxyCheckedAt: input.checkedAt,
    // Só o teste mede a sequência; a recusa na leitura ou na emissão não mexe no que foi medido.
    ...(input.sameSequence === undefined ? {} : { proxySameSequence: input.sameSequence }),
    updatedAt: input.checkedAt,
  };
  await withOrgTx(orgId, (tx) =>
    tx.insert(cc).values({ orgId, clientId, ...values }).onConflictDoUpdate({ target: [cc.orgId, cc.clientId], set: values }),
  );
}

export interface ProxyTestTarget {
  clientId: string;
  cnpj: string;
  /** NSU da nota mais antiga já guardada, para medir a sequência; null = nenhuma. */
  oldestStoredNsu: number | null;
}

/**
 * Quem testar: o pedido para todas vale para as empresas ativas, não MEI, com
 * CNPJ, de serviço (ou com a procuração marcada); o pedido próprio vale para a
 * empresa pedida.
 */
export async function listProxyTestTargets(orgId: string): Promise<ProxyTestTarget[]> {
  return withOrgTx(orgId, async (tx) => {
    const policy = await credentialPolicyIn(tx, orgId);
    const cl = schema.clients;
    const cc = schema.nfseClientCredentials;
    const fp = schema.fiscalClientProfiles;
    const rows = await tx
      .select({
        clientId: cl.id,
        cnpj: cl.cnpj,
        cnaeCode: cl.cnaeCode,
        applicability: fp.nfseIssuerApplicability,
        mode: cc.mode,
        requestedAt: cc.proxyTestRequestedAt,
      })
      .from(cl)
      .leftJoin(cc, and(eq(cc.orgId, cl.orgId), eq(cc.clientId, cl.id)))
      .leftJoin(fp, and(eq(fp.orgId, cl.orgId), eq(fp.clientId, cl.id)))
      .where(and(eq(cl.orgId, orgId), eq(cl.active, true), ne(cl.taxRegime, "mei"), isNotNull(cl.cnpj)))
      .orderBy(cl.name);
    const chosen = rows.filter(
      (row) =>
        row.requestedAt !== null ||
        (policy.proxyTestRequestedAt !== null &&
          (row.mode === "proxy" || nfseIssuer({ applicability: row.applicability ?? null, cnaeCode: row.cnaeCode }).issues === true)),
    );
    if (chosen.length === 0) return [];
    const n = schema.nfseIssuedNotes;
    const oldest = new Map(
      (
        await tx
          .select({ clientId: n.clientId, nsu: min(n.nsu) })
          .from(n)
          .where(and(eq(n.orgId, orgId), inArray(n.clientId, chosen.map((row) => row.clientId))))
          .groupBy(n.clientId)
      ).map((row) => [row.clientId, row.nsu === null ? null : Number(row.nsu)]),
    );
    // O filtro isNotNull garante o CNPJ; o tipo da coluna não sabe disso.
    return chosen.map((row) => ({ clientId: row.clientId, cnpj: row.cnpj as string, oldestStoredNsu: oldest.get(row.clientId) ?? null }));
  });
}

/** Limpa só os pedidos feitos até `startedAt`: pedido feito durante o teste fica para a próxima volta. */
export async function clearProxyTestRequests(orgId: string, startedAt: Date): Promise<void> {
  await withOrgTx(orgId, async (tx) => {
    const s = schema.nfseCredentialSettings;
    await tx.update(s).set({ proxyTestRequestedAt: null }).where(and(eq(s.orgId, orgId), lte(s.proxyTestRequestedAt, startedAt)));
    const cc = schema.nfseClientCredentials;
    await tx.update(cc).set({ proxyTestRequestedAt: null }).where(and(eq(cc.orgId, orgId), lte(cc.proxyTestRequestedAt, startedAt)));
  });
}

/** NSU guardado de cada chave desta empresa, para medir a sequência. */
export async function storedNsuByKey(orgId: string, clientId: string, accessKeys: readonly string[]): Promise<Map<string, number>> {
  if (accessKeys.length === 0) return new Map();
  return withOrgTx(orgId, async (tx) => {
    const n = schema.nfseIssuedNotes;
    const rows = await tx
      .select({ accessKey: n.accessKey, nsu: n.nsu })
      .from(n)
      .where(and(eq(n.orgId, orgId), eq(n.clientId, clientId), inArray(n.accessKey, [...accessKeys])));
    return new Map(rows.map((row) => [row.accessKey, row.nsu]));
  });
}
