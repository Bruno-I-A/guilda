import "server-only";

import { isXmlRoutineDue } from "@/domain/nfse-xml";

import { fetchAdnBatch } from "./adn-client";
import { loadNfseCertificate, NfseCertificateError } from "./certificate";
import { checkClientCertificate } from "./certificate-check";
import { createMtlsTransport, type HttpTransport, type NfseEnvironmentName } from "./sefin-client";
import { type VaultEnvelope, VaultError, type VaultKey } from "./vault";
import {
  listPendingCertificates,
  listRoutineClients,
  loadXmlRoutineState,
  markXmlRoutineRun,
  publishVaultKey,
  saveAdnError,
  saveAdnProgress,
  saveCertificateCheck,
} from "./xml-repository";
import { runXmlRoutine } from "./xml-routine";

/**
 * O que o serviço fiscal faz com os certificados das empresas: publicar a
 * chave do cofre, conferir os certificados enviados e rodar a leitura da
 * distribuição do ADN de cada empresa com o certificado dela (mTLS).
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

/**
 * Uma rodada inteira. O certificado de cada empresa é aberto em memória só
 * para ela e descartado quando a rodada passa para a próxima (runXmlRoutine
 * lê uma empresa por vez).
 *
 * O fim só é marcado quando a rodada chega ao fim normalmente: se algo lançar
 * antes, a rodada fica sem fim registrado e isXmlRoutineDue a trata como
 * interrompida (roda de novo depois de XML_ROUTINE_STALE_MS).
 */
export async function runXmlRoutineCycle(orgId: string, vault: VaultKey, environment: NfseEnvironmentName): Promise<void> {
  const startedAt = new Date();
  await markXmlRoutineRun(orgId, { startedAt });
  const state = await loadXmlRoutineState(orgId);
  const clients = await listRoutineClients(orgId, startedAt);
  const envelopes = new Map(clients.map((client) => [client.clientId, client.envelope]));

  let current: { clientId: string; transport: HttpTransport } | null = null;
  const transportFor = (clientId: string): HttpTransport => {
    if (current?.clientId === clientId) return current.transport;
    // Solta o da empresa anterior antes de abrir o próximo.
    current = null;
    const envelope = envelopes.get(clientId);
    if (!envelope) throw new Error("O certificado da empresa não veio na rodada.");
    current = { clientId, transport: openClientTransport(vault, envelope) };
    return current.transport;
  };

  const results = await runXmlRoutine(clients, {
    // "Guardar a partir de" é um dia de Brasília.
    keepSince: state.keepSince ? new Date(`${state.keepSince}T00:00:00-03:00`) : null,
    fetchBatch: async (client, fromNsu) =>
      fetchAdnBatch(transportFor(client.clientId), environment, { fromNsu, cnpj: client.cnpj }),
    saveProgress: (progress) => saveAdnProgress(orgId, progress, new Date()),
    saveError: (clientId, message) => saveAdnError(orgId, clientId, message, new Date()),
  });
  current = null;

  await markXmlRoutineRun(orgId, { finishedAt: new Date() });
  const failed = results.filter((result) => !result.ok).length;
  console.log(`Rotina de XML: ${clients.length} empresa(s), ${failed} com erro.`);
}
