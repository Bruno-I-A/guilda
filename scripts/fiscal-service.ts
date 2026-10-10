import "./load-env";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { loadNfseCertificate, type NfseCertificate } from "../src/lib/nfse/certificate";
import { buildDanfseZip, MIN_SERVICE_TOKEN_LENGTH, parseDanfseRequest, tokenMatches } from "../src/lib/nfse/danfse-zip";
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
 * fila de notas (emitir/cancelar) e serve, só na rede interna, o .zip de
 * PDFs. Sobe com GUILDA_SERVICE=fiscal (scripts/start-production.mjs).
 */

const POLL_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Pedido grande demais.");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function reply(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function startHttp(client: SefinClient | null) {
  if (token.length < MIN_SERVICE_TOKEN_LENGTH) {
    console.warn("FISCAL_SERVICE_TOKEN ausente ou curto: o download de PDFs fica desligado.");
  }
  createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        reply(res, 200, `ok ${environment}`);
        return;
      }
      if (req.method !== "POST" || req.url !== "/danfse.zip") {
        reply(res, 404, "Não encontrado.");
        return;
      }
      if (!tokenMatches(token, req.headers.authorization)) {
        reply(res, 401, "Não autorizado.");
        return;
      }
      if (!client) {
        reply(res, 503, "Serviço fiscal sem certificado válido.");
        return;
      }
      const items = parseDanfseRequest(await readBody(req));
      if (!items) {
        reply(res, 400, "Pedido de PDFs inválido.");
        return;
      }
      const { zip } = await buildDanfseZip(items, (accessKey) => client.getDanfse(accessKey));
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": zip.length });
      res.end(Buffer.from(zip));
    } catch (error) {
      console.error("Falha no download de PDFs:", error instanceof Error ? error.message : error);
      if (!res.headersSent) reply(res, 500, "Falha ao montar os PDFs.");
    }
  }).listen(port, "0.0.0.0", () => console.log(`Serviço fiscal ouvindo na porta ${port} (${environment}).`));
}

async function main() {
  const { certificate, error: certificateError } = openCertificate();
  if (!certificate) console.error(`Serviço fiscal sem certificado: ${certificateError}`);
  const client = certificate
    ? createSefinClient(environment, createMtlsTransport({ privateKeyPem: certificate.privateKeyPem, chainPem: certificate.chainPem }))
    : null;
  startHttp(certificateError ? null : client);

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
      console.error("Falha no ciclo do serviço fiscal:", error instanceof Error ? error.message : error);
    }
    await delay(Math.max(1_000, POLL_MS - (Date.now() - started)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
