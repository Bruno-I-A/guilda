import "server-only";

import { isProxyAuthorizationError, needsCursorReset } from "@/domain/nfse-credentials";
import { isXmlRoutineDue } from "@/domain/nfse-xml";

import { AdnRejectionError, fetchAdnBatch, withTransientRetry } from "./adn-client";
import { loadNfseCertificate, NfseCertificateError } from "./certificate";
import { checkClientCertificate } from "./certificate-check";
import { resetCursorForMode, saveProxyStatus } from "./credentials-repository";
import { createMtlsTransport, type HttpTransport, type NfseEnvironmentName, NfseTransientError } from "./sefin-client";
import { type VaultEnvelope, VaultError, type VaultKey } from "./vault";
import {
  listPendingCertificates,
  listRoutineClients,
  loadXmlRoutineState,
  markXmlRoutineRun,
  publishVaultKey,
  type RoutineClient,
  saveAdnError,
  saveAdnProgress,
  saveCertificateCheck,
} from "./xml-repository";
import { runXmlRoutine } from "./xml-routine";

/**
 * O que o serviço fiscal faz com os certificados das empresas: publicar a
 * chave do cofre, conferir os certificados enviados e rodar a leitura da
 * distribuição do ADN de cada empresa (mTLS) com o certificado dela ou, por
 * procuração, com o A1 do escritório em nome dela.
 *
 * Os logs daqui dizem só id e contagem: nada de envelope, senha, certificado
 * ou XML, nem a mensagem de erro de cada empresa (essa fica no banco).
 */

/** A cada ciclo do serviço: publicar a chave e conferir os certificados enviados. */
export async function serviceVaultTick(orgId: string, vault: VaultKey): Promise<void> {
  await publishVaultKey(orgId, { keyId: vault.keyId, publicKeySpki: vault.publicKeySpki });
  for (const pending of await listPendingCertificates(orgId)) {
    const result = checkClientCertificate({ vault, envelope: pending.envelope, clientCnpj: pending.clientCnpj });
    // A wrappedKey identifica o envio: um reenvio no meio da conferência vence.
    await saveCertificateCheck(orgId, { id: pending.id, wrappedKey: pending.envelope.wrappedKey, result, now: new Date() });
    console.log(`Certificado ${pending.id}: ${result.status}.`);
  }
}

export async function isXmlRoutineDueNow(orgId: string, now: Date): Promise<boolean> {
  const state = await loadXmlRoutineState(orgId);
  return isXmlRoutineDue({ ...state, now });
}

/**
 * Abre o A1 da empresa só para montar o transporte: o .pfx e a senha não
 * saem desta função. A mensagem do erro vai para a tela da empresa; as do
 * cofre e do certificado já são seguras, e qualquer outra vira uma genérica.
 */
function openClientTransport(vault: VaultKey, envelope: VaultEnvelope): HttpTransport {
  try {
    const secret = vault.open(envelope);
    const certificate = loadNfseCertificate(secret.pfx, secret.password);
    return createMtlsTransport({ privateKeyPem: certificate.privateKeyPem, chainPem: certificate.chainPem });
  } catch (error) {
    if (error instanceof VaultError || error instanceof NfseCertificateError) throw error;
    throw new Error("Não foi possível abrir o certificado da empresa.");
  }
}

/** Recusa declarada (com HTTP) que fala de autorização: 401/403, E2245 ou procuração no texto. */
function isProxyRefusal(error: unknown): error is AdnRejectionError & { httpStatus: number } {
  return (
    error instanceof AdnRejectionError &&
    error.httpStatus !== null &&
    isProxyAuthorizationError([{ code: error.code ?? String(error.httpStatus), message: error.message }])
  );
}

/**
 * Uma rodada inteira. O certificado de cada empresa é aberto em memória só
 * para ela e descartado quando a rodada passa para a próxima (runXmlRoutine
 * lê uma empresa por vez).
 *
 * O fim só é marcado quando a rodada chega ao fim normalmente: se algo lançar
 * antes, a rodada fica sem fim registrado e isXmlRoutineDue a trata como
 * interrompida (roda de novo depois de XML_ROUTINE_STALE_MS).
 */
export async function runXmlRoutineCycle(
  orgId: string,
  vault: VaultKey,
  environment: NfseEnvironmentName,
  options: {
    retryDelaysMs?: readonly number[];
    /** O A1 do escritório (o dos honorários), para quem lê por procuração. */
    office?: HttpTransport | null;
  } = {},
): Promise<void> {
  const startedAt = new Date();
  await markXmlRoutineRun(orgId, { startedAt });
  const state = await loadXmlRoutineState(orgId);
  const clients: RoutineClient[] = [];
  for (const client of await listRoutineClients(orgId, startedAt)) {
    // Trocou de credencial desde a última leitura: recomeça do zero, porque não
    // está medido que a sequência de NSU é a mesma (decisão 4 do desenho).
    if (needsCursorReset(client.readMode, client.mode)) {
      await resetCursorForMode(orgId, client.clientId, client.mode, startedAt);
      clients.push({ ...client, lastNsu: 0, historyFromNsu: client.historyFromNsu === null ? null : 0 });
    } else {
      clients.push(client);
    }
  }
  const byId = new Map(clients.map((client) => [client.clientId, client]));

  let current: { clientId: string; transport: HttpTransport } | null = null;
  const transportFor = (clientId: string): HttpTransport => {
    const client = byId.get(clientId);
    if (client?.mode === "proxy") {
      if (!options.office) throw new Error("O A1 do escritório não está disponível no serviço fiscal.");
      return options.office;
    }
    if (current?.clientId === clientId) return current.transport;
    // Solta o da empresa anterior antes de abrir o próximo.
    current = null;
    if (!client?.envelope) throw new Error("O certificado da empresa não veio na rodada.");
    current = { clientId, transport: openClientTransport(vault, client.envelope) };
    return current.transport;
  };

  const results = await runXmlRoutine(clients, {
    // "Guardar a partir de" é um dia de Brasília.
    keepSince: state.keepSince ? new Date(`${state.keepSince}T00:00:00-03:00`) : null,
    fetchBatch: async (client, afterNsu) => {
      try {
        return await withTransientRetry(
          () => fetchAdnBatch(transportFor(client.clientId), environment, { afterNsu, cnpj: client.cnpj }),
          { delaysMs: options.retryDelaysMs },
        );
      } catch (error) {
        // Esgotadas as tentativas: o que já veio está gravado, e a tela diz isso.
        if (error instanceof NfseTransientError) {
          throw new NfseTransientError(`${error.message} A próxima leitura continua de onde parou.`);
        }
        // Por procuração, a recusa de autorização é da procuração: vira selo da empresa.
        if (byId.get(client.clientId)?.mode === "proxy" && isProxyRefusal(error)) {
          await saveProxyStatus(orgId, client.clientId, { status: "invalid", code: error.code, message: error.message, checkedAt: new Date() });
          throw new AdnRejectionError(
            `Procuração recusada pelo Sistema Nacional${error.code ? ` (${error.code})` : ""}. Renove a procuração ou use o certificado da empresa.`,
          );
        }
        throw error;
      }
    },
    saveProgress: (progress) => saveAdnProgress(orgId, progress, new Date()),
    saveError: (clientId, message) => saveAdnError(orgId, clientId, message, new Date()),
  });
  current = null;

  await markXmlRoutineRun(orgId, { finishedAt: new Date() });
  const failed = results.filter((result) => !result.ok).length;
  console.log(`Rotina de XML: ${clients.length} empresa(s), ${failed} com erro.`);
}
