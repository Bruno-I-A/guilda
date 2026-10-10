import { Agent, request as httpsRequest } from "node:https";

import { firstElementText, gunzipBase64, gzipBase64 } from "./xml";

export type NfseEnvironmentName = "restrita" | "producao";

export const NFSE_ENDPOINTS: Record<NfseEnvironmentName, { sefin: string; adn: string; tpAmb: 1 | 2 }> = {
  restrita: {
    sefin: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
    adn: "https://adn.producaorestrita.nfse.gov.br",
    tpAmb: 2,
  },
  producao: {
    sefin: "https://sefin.nfse.gov.br/SefinNacional",
    adn: "https://adn.nfse.gov.br",
    tpAmb: 1,
  },
};

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  json?: unknown;
  accept?: string;
}
export interface HttpResponse {
  status: number;
  body: Buffer;
  contentType: string | null;
}
export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

/** Rede, timeout, 5xx: vale tentar de novo mais tarde. */
export class NfseTransientError extends Error {}

export interface NfseApiError {
  code: string;
  message: string;
}
export type EmitResult =
  | { kind: "issued"; accessKey: string; nfseNumber: string | null }
  | { kind: "rejected"; errors: NfseApiError[] };
export type CancelResult = { kind: "cancelled" } | { kind: "rejected"; errors: NfseApiError[] };

export interface SefinClient {
  emit(signedDpsXml: string): Promise<EmitResult>;
  findAccessKeyByDps(dpsId: string): Promise<string | null>;
  getNfseNumber(accessKey: string): Promise<string | null>;
  cancel(accessKey: string, signedEventXml: string): Promise<CancelResult>;
  getDanfse(accessKey: string): Promise<Buffer>;
}

/** Transporte real: HTTPS com o certificado do escritório na conexão (mTLS). */
export function createMtlsTransport(input: {
  privateKeyPem: string;
  chainPem: string;
  timeoutMs?: number;
}): HttpTransport {
  const agent = new Agent({ key: input.privateKeyPem, cert: input.chainPem, keepAlive: true, maxSockets: 4 });
  const timeoutMs = input.timeoutMs ?? 30_000;
  return (req) =>
    new Promise((resolve, reject) => {
      const payload = req.json === undefined ? undefined : Buffer.from(JSON.stringify(req.json), "utf8");
      const call = httpsRequest(
        req.url,
        {
          method: req.method,
          agent,
          timeout: timeoutMs,
          headers: {
            Accept: req.accept ?? "application/json",
            ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks),
              contentType: res.headers["content-type"] ?? null,
            }),
          );
          res.on("error", (error) => reject(new NfseTransientError(error.message)));
        },
      );
      call.on("timeout", () => call.destroy(new Error("Tempo esgotado falando com o Sistema Nacional.")));
      call.on("error", (error) => reject(new NfseTransientError(error.message)));
      if (payload) call.write(payload);
      call.end();
    });
}

function parseBody(res: HttpResponse): Record<string, unknown> {
  try {
    const value = JSON.parse(res.body.toString("utf8")) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Campo por nome, sem diferenciar maiúscula de minúscula. */
function field(body: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(body).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : body[key];
}

function stringField(body: Record<string, unknown>, name: string): string | null {
  const value = field(body, name);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function apiErrors(body: Record<string, unknown>): NfseApiError[] {
  const raw = field(body, "erros") ?? field(body, "erro");
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const code = field(item, "codigo");
      const description = field(item, "descricao");
      const complement = field(item, "complemento");
      return {
        code: typeof code === "string" ? code : "",
        message: [description, complement].filter((part) => typeof part === "string" && part).join(" — ") || "Sem descrição.",
      };
    });
}

function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function rejection(res: HttpResponse, body: Record<string, unknown>): { kind: "rejected"; errors: NfseApiError[] } {
  if (isTransientStatus(res.status)) {
    throw new NfseTransientError(`O Sistema Nacional respondeu ${res.status}.`);
  }
  const errors = apiErrors(body);
  if (errors.length > 0) return { kind: "rejected", errors };
  const message =
    res.status === 401 || res.status === 403
      ? "O Sistema Nacional recusou o certificado do escritório."
      : `Recusa sem detalhe (HTTP ${res.status}).`;
  return { kind: "rejected", errors: [{ code: String(res.status), message }] };
}

function unexpected(res: HttpResponse, what: string): NfseTransientError {
  const detail = apiErrors(parseBody(res)).map((error) => error.message).join(" · ");
  return new NfseTransientError(`${what}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}.`);
}

export function createSefinClient(environment: NfseEnvironmentName, transport: HttpTransport): SefinClient {
  const base = NFSE_ENDPOINTS[environment];

  async function nfseNumberFrom(body: Record<string, unknown>): Promise<string | null> {
    const xml = stringField(body, "nfseXmlGZipB64");
    return xml ? firstElementText(gunzipBase64(xml), "nNFSe") : null;
  }

  return {
    async emit(signedDpsXml) {
      const res = await transport({
        method: "POST",
        url: `${base.sefin}/nfse`,
        json: { dpsXmlGZipB64: gzipBase64(signedDpsXml) },
      });
      const body = parseBody(res);
      if (res.status >= 200 && res.status < 300) {
        const accessKey = stringField(body, "chaveAcesso");
        if (!accessKey) throw new NfseTransientError("Resposta de emissão sem chave de acesso.");
        return { kind: "issued", accessKey, nfseNumber: await nfseNumberFrom(body) };
      }
      return rejection(res, body);
    },

    async findAccessKeyByDps(dpsId) {
      const res = await transport({ method: "GET", url: `${base.sefin}/dps/${dpsId}` });
      if (res.status === 404) return null;
      if (res.status >= 200 && res.status < 300) return stringField(parseBody(res), "chaveAcesso");
      throw unexpected(res, "Consulta da DPS falhou");
    },

    async getNfseNumber(accessKey) {
      const res = await transport({ method: "GET", url: `${base.sefin}/nfse/${accessKey}` });
      if (res.status >= 200 && res.status < 300) return nfseNumberFrom(parseBody(res));
      throw unexpected(res, "Consulta da nota falhou");
    },

    async cancel(accessKey, signedEventXml) {
      const res = await transport({
        method: "POST",
        url: `${base.sefin}/nfse/${accessKey}/eventos`,
        json: { pedidoRegistroEventoXmlGZipB64: gzipBase64(signedEventXml) },
      });
      if (res.status >= 200 && res.status < 300) return { kind: "cancelled" };
      return rejection(res, parseBody(res));
    },

    async getDanfse(accessKey) {
      const res = await transport({ method: "GET", url: `${base.adn}/danfse/${accessKey}`, accept: "application/pdf" });
      if (res.status >= 200 && res.status < 300 && res.contentType?.includes("pdf")) return res.body;
      throw new Error(`DANFSe indisponível para a nota ${accessKey} (HTTP ${res.status}).`);
    },
  };
}
