import type { IncomingMessage, ServerResponse } from "node:http";

import { buildDanfseZip, parseDanfseRequest, tokenMatches } from "./danfse-zip";

const MAX_BODY_BYTES = 64 * 1024;

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

function send(res: ServerResponse, contentType: string, body: Uint8Array) {
  res.writeHead(200, { "Content-Type": contentType, "Content-Length": body.length });
  res.end(Buffer.from(body));
}

/**
 * A porta HTTP do serviço fiscal, só na rede interna: GET /health e, com o
 * token, POST /danfse.pdf (uma nota, o PDF direto) e POST /danfse.zip (várias,
 * num .zip com LEIA-ME das que falharem). Sem certificado válido, buildPdf é
 * null e os PDFs respondem 503.
 */
export function createFiscalHttpHandler(input: {
  environment: string;
  token: string;
  buildPdf: ((accessKey: string) => Promise<Uint8Array>) | null;
}) {
  const { buildPdf } = input;
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        reply(res, 200, `ok ${input.environment}`);
        return;
      }
      if (req.method !== "POST" || (req.url !== "/danfse.zip" && req.url !== "/danfse.pdf")) {
        reply(res, 404, "Não encontrado.");
        return;
      }
      if (!tokenMatches(input.token, req.headers.authorization)) {
        reply(res, 401, "Não autorizado.");
        return;
      }
      if (!buildPdf) {
        reply(res, 503, "Serviço fiscal sem certificado válido.");
        return;
      }
      const items = parseDanfseRequest(await readBody(req));
      if (!items) {
        reply(res, 400, "Pedido de PDFs inválido.");
        return;
      }
      if (req.url === "/danfse.pdf") {
        if (items.length !== 1) {
          reply(res, 400, "O PDF avulso é de uma nota só.");
          return;
        }
        let pdf: Uint8Array;
        try {
          pdf = await buildPdf(items[0].accessKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha desconhecida.";
          console.warn(`PDF não montado (${items[0].fileName}): ${message}`);
          reply(res, 502, `Não foi possível montar o PDF da nota: ${message} Consulte a nota no Portal Nacional.`);
          return;
        }
        send(res, "application/pdf", pdf);
        return;
      }
      const { zip, failures } = await buildDanfseZip(items, buildPdf);
      for (const failure of failures) console.warn(`PDF não montado (${failure.fileName}): ${failure.message}`);
      send(res, "application/zip", zip);
    } catch (error) {
      console.error("Falha no download de PDFs:", error instanceof Error ? error.message : error);
      if (!res.headersSent) reply(res, 500, "Falha ao montar os PDFs.");
    }
  };
}
