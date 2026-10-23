import "./load-env";

import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { runClientNfseQueue } from "../src/lib/client-nfse/service";
import { loadNfseCertificate, type NfseCertificate } from "../src/lib/nfse/certificate";
import { readDanfse } from "../src/lib/nfse/danfse-data";
import { renderDanfsePdf } from "../src/lib/nfse/danfse-pdf";
import { MIN_SERVICE_TOKEN_LENGTH } from "../src/lib/nfse/danfse-zip";
import { createFiscalHttpHandler } from "../src/lib/nfse/fiscal-http";
import { loadVaultKey, type VaultKey } from "../src/lib/nfse/vault";
import { isXmlRoutineDueNow, runXmlRoutineCycle, serviceVaultTick } from "../src/lib/nfse/xml-cycle";
import { runNfseJob } from "../src/lib/nfse/processor";
import {
  claimNfseJob,
  finishNfseJob,
  loadServiceSettings,
  registerFiscalService,
} from "../src/lib/nfse/repository";
import {
  createMtlsTransport,
  createSefinClient,
  NFSE_ENDPOINTS,
  type NfseEnvironmentName,
  type SefinClient,
} from "../src/lib/nfse/sefin-client";

/**
 * Serviço fiscal: o ÚNICO processo com o certificado do escritório. Consome a
 * fila de notas (emitir/cancelar) e serve, só na rede interna, os PDFs
 * (src/lib/nfse/fiscal-http.ts). O governo suspendeu a API do DANFSe em
 * 03/08/2026: o PDF é montado aqui, do XML da nota (NT 008/2026). Sobe com
 * GUILDA_SERVICE=fiscal (scripts/start-production.mjs). Tambem confere os
 * certificados das empresas, coleta os XML com o A1 de cada empresa e emite
 * as notas dos clientes com o A1 da empresa emissora.
 */

const POLL_MS = 10_000;

// Ausente ou inválido vale produção restrita: nota de verdade exige a variável explícita.
const environment: NfseEnvironmentName = process.env.NFSE_AMBIENTE === "producao" ? "producao" : "restrita";
const tpAmb = NFSE_ENDPOINTS[environment].tpAmb;
const token = process.env.FISCAL_SERVICE_TOKEN ?? "";
const port = Number(process.env.FISCAL_SERVICE_PORT ?? 4100);

function openCertificate(): { certificate: NfseCertificate | null; error: string | null } {
  try {
    const certificate = loadNfseCertificate(process.env.NFSE_CERT_PFX_BASE64 ?? "", process.env.NFSE_CERT_PASSWORD ?? "");
    if (certificate.validUntil.getTime() < Date.now()) {
      return { certificate, error: `Certificado vencido em ${certificate.validUntil.toLocaleDateString("pt-BR")}.` };
    }
    return { certificate, error: null };
  } catch (error) {
    return { certificate: null, error: error instanceof Error ? error.message : "Certificado inválido." };
  }
}

function openVault(): VaultKey | null {
  if (!process.env.NFSE_VAULT_PRIVATE_KEY) {
    console.warn("NFSE_VAULT_PRIVATE_KEY ausente: cofre e rotina de XML desligados.");
    return null;
  }
  try {
    return loadVaultKey(process.env.NFSE_VAULT_PRIVATE_KEY);
  } catch {
    console.error("NFSE_VAULT_PRIVATE_KEY inválida: cofre e rotina de XML desligados.");
    return null;
  }
}

function startHttp(client: SefinClient | null) {
  if (token.length < MIN_SERVICE_TOKEN_LENGTH) {
    console.warn("FISCAL_SERVICE_TOKEN ausente ou curto: o download de PDFs fica desligado.");
  }
  const handler = createFiscalHttpHandler({
    environment,
    token,
    buildPdf: client ? async (accessKey) => renderDanfsePdf(readDanfse(await client.getNfseXml(accessKey))) : null,
  });
  createServer(handler).listen(port, "0.0.0.0", () => console.log(`Serviço fiscal ouvindo na porta ${port} (${environment}).`));
}

/** O Drizzle embrulha o erro do Postgres ("Failed query"); a causa real fica em error.cause. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : null;
  return cause ? `${cause} (em: ${error.message.split("\n")[0]})` : error.message;
}

async function main() {
  const { certificate, error: certificateError } = openCertificate();
  if (!certificate) console.error(`Serviço fiscal sem certificado: ${certificateError}`);
  const client = certificate
    ? createSefinClient(environment, createMtlsTransport({ privateKeyPem: certificate.privateKeyPem, chainPem: certificate.chainPem }))
    : null;
  startHttp(certificateError ? null : client);
  const vault = openVault();
  let xmlRoutineRunning = false;

  while (true) {
    const started = Date.now();
    try {
      if (certificate) {
        const orgId = await registerFiscalService({
          cnpj: certificate.cnpj,
          environment: tpAmb,
          certificateValidUntil: certificate.validUntil,
          error: certificateError,
        });
        if (!orgId) {
          console.warn(`Nenhuma organização configurada com o CNPJ ${certificate.cnpj}.`);
        } else if (client && !certificateError) {
          const settings = await loadServiceSettings(orgId);
          if (vault) {
            try {
              await serviceVaultTick(orgId, vault);
              if (!xmlRoutineRunning && (await isXmlRoutineDueNow(orgId, new Date()))) {
                xmlRoutineRunning = true;
                void runXmlRoutineCycle(orgId, vault, environment)
                  .catch(() => console.error("Falha na rotina de XML; a leitura será retomada."))
                  .finally(() => { xmlRoutineRunning = false; });
              }
            } catch {
              console.error("Falha no ciclo do cofre; nova tentativa no próximo ciclo.");
            }
            try {
              await runClientNfseQueue(orgId, vault, environment);
            } catch (error) {
              console.error("Falha na fila das notas dos clientes:", describeError(error));
            }
          }
          if (settings?.template && settings.providerCnpj === certificate.cnpj) {
            const signingKey = { privateKeyPem: certificate.privateKeyPem, certificatePem: certificate.certificatePem };
            for (let claim = await claimNfseJob(orgId); claim; claim = await claimNfseJob(orgId)) {
              const outcome = await runNfseJob(claim, {
                client,
                environment: tpAmb,
                providerCnpj: settings.providerCnpj,
                template: settings.template,
                signingKey,
                now: new Date(),
              });
              const finished = await finishNfseJob(orgId, claim, outcome);
              console.log(`Nota ${claim.id}: ${outcome.kind}${finished ? "" : " (lease vencido, descartado)"}.`);
            }
          }
        }
      }
    } catch (error) {
      console.error("Falha no ciclo do serviço fiscal:", describeError(error));
    }
    await delay(Math.max(1_000, POLL_MS - (Date.now() - started)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
