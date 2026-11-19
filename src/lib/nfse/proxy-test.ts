import "server-only";

import type { ProxyStatus } from "@/domain/nfse-credentials";

import { AdnRejectionError, fetchAdnBatch, withTransientRetry } from "./adn-client";
import { readAdnDocument } from "./adn-documents";
import { clearProxyTestRequests, listProxyTestTargets, saveProxyStatus, storedNsuByKey } from "./credentials-repository";
import type { HttpTransport, NfseEnvironmentName } from "./sefin-client";

/**
 * Testes de procuração pedidos na aba XML (decisão de 2026-11-18): uma
 * leitura no ADN com o A1 do escritório em nome de cada empresa. Medido no
 * Tero: com procuração vem o lote; sem ela, HTTP 400 com E2245.
 *
 * Lê a partir da nota mais antiga já guardada (NSU − 1), para que o primeiro
 * documento seja uma nota que a Guilda já tem e dê para medir se a sequência
 * de NSU é a mesma da leitura com o A1 da empresa. Só lê: não grava nota nem
 * mexe no cursor.
 *
 * Classificação: lote legível (ou nenhum documento) confirma; recusa declarada
 * (4xx, REJEICAO) é procuração recusada; rede, 5xx e formato desconhecido são
 * falha técnica, que nunca vira recusa.
 */
export async function runProxyTests(
  orgId: string,
  office: HttpTransport,
  environment: NfseEnvironmentName,
  options: { retryDelaysMs?: readonly number[] } = {},
): Promise<number> {
  const startedAt = new Date();
  const targets = await listProxyTestTargets(orgId);
  if (targets.length === 0) return 0;
  for (const target of targets) {
    const afterNsu = target.oldestStoredNsu ? target.oldestStoredNsu - 1 : 0;
    let outcome: { status: ProxyStatus; code: string | null; message: string | null; sameSequence: boolean | null };
    try {
      const batch = await withTransientRetry(() => fetchAdnBatch(office, environment, { afterNsu, cnpj: target.cnpj }), {
        delaysMs: options.retryDelaysMs,
      });
      outcome = {
        status: "confirmed",
        code: null,
        message: batch.documents.length > 0 ? `${batch.documents.length} documento(s) no primeiro lote.` : "Nenhum documento ainda.",
        sameSequence: await measureSequence(orgId, target.clientId, target.cnpj, batch.documents),
      };
    } catch (error) {
      const refused = error instanceof AdnRejectionError && error.httpStatus !== null;
      outcome = {
        status: refused ? "invalid" : "technical_failure",
        code: refused ? (error.code ?? String(error.httpStatus)) : null,
        message: error instanceof Error ? error.message : "Falha desconhecida.",
        sameSequence: null,
      };
    }
    await saveProxyStatus(orgId, target.clientId, { ...outcome, checkedAt: new Date() });
  }
  await clearProxyTestRequests(orgId, startedAt);
  console.log(`Teste de procuração: ${targets.length} empresa(s).`);
  return targets.length;
}

/** true/false quando alguma nota do lote já está guardada; null quando não dá para comparar. */
async function measureSequence(
  orgId: string,
  clientId: string,
  cnpj: string,
  documents: readonly { nsu: number; xml: string }[],
): Promise<boolean | null> {
  const issued = documents.flatMap((doc) => {
    const reading = readAdnDocument(doc.xml, cnpj);
    return reading.kind === "issued" ? [{ accessKey: reading.accessKey, nsu: doc.nsu }] : [];
  });
  const stored = await storedNsuByKey(orgId, clientId, issued.map((doc) => doc.accessKey));
  const compared = issued.filter((doc) => stored.has(doc.accessKey));
  if (compared.length === 0) return null;
  return compared.every((doc) => stored.get(doc.accessKey) === doc.nsu);
}
