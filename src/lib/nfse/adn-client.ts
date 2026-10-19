import { type HttpResponse, type HttpTransport, type NfseEnvironmentName, NfseTransientError } from "./sefin-client";
import { gunzipBase64 } from "./xml";

// CONFERÊNCIA OBRIGATÓRIA ANTES DO TESTE REAL: os nomes StatusProcessamento,
// LoteDFe, NSU, ArquivoXml, Erros, Codigo e Descricao, e o valor
// NENHUM_DOCUMENTO_LOCALIZADO, vêm do Manual dos Contribuintes e de
// implementações de terceiros, não de um contrato que a Guilda tenha visto
// responder. Confira no Swagger
// (https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html) e,
// se divergir, ajuste este parser e a fixture (testing/adn.ts) juntos.

/**
 * Distribuição de DF-e do ADN para contribuintes (Manual dos Contribuintes —
 * APIs do ADN, v1.0 de 12/02/2026): documentos em que a empresa é emitente,
 * tomadora ou intermediária, em ordem de NSU, até 50 por chamada com
 * lote=true. O caminho é "contribuintes", no plural.
 */
export const ADN_CONTRIBUINTES: Record<NfseEnvironmentName, string> = {
  producao: "https://adn.nfse.gov.br/contribuintes",
  restrita: "https://adn.producaorestrita.nfse.gov.br/contribuintes",
};

export interface AdnDocument {
  nsu: number;
  xml: string;
}

export interface AdnBatch {
  documents: AdnDocument[];
  /** Nada além do NSU pedido: a leitura desta empresa terminou por ora. */
  done: boolean;
}

/** O Sistema Nacional recusou a consulta, ou devolveu algo que não dá para ler com segurança. */
export class AdnRejectionError extends Error {}

const MAX_DESCRIPTION = 200;
const MAX_MESSAGE = 500;

/** Campo pelo nome, sem ligar para maiúsculas: o Swagger e a API já divergiram. */
function field(source: unknown, name: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : (source as Record<string, unknown>)[key];
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** O corpo como objeto JSON; `null` quando não é (HTML de proxy, vazio, texto). */
function parseJsonObject(res: HttpResponse): Record<string, unknown> | null {
  try {
    const value = JSON.parse(res.body.toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Só código e descrição, cortados: nunca o corpo cru da resposta. */
function rejectionMessage(body: unknown, status: number): string {
  if (status === 401 || status === 403) return "O Sistema Nacional recusou o certificado da empresa.";
  const errors = field(body, "Erros");
  const described = (Array.isArray(errors) ? errors : [])
    .map((item) => {
      const code = field(item, "Codigo");
      const description = field(item, "Descricao");
      return [
        typeof code === "string" ? clip(code, 30) : "",
        typeof description === "string" ? clip(description, MAX_DESCRIPTION) : "",
      ]
        .filter(Boolean)
        .join(" — ");
    })
    .filter(Boolean);
  return described.length > 0
    ? clip(described.join(" · "), MAX_MESSAGE)
    : `O Sistema Nacional recusou a consulta (HTTP ${status}).`;
}

/** NSU é inteiro não negativo, número ou texto de dígitos; `null`, vazio e lixo não viram 0. */
function parseNsu(raw: unknown): number | null {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : Number.NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readDocuments(items: unknown): AdnDocument[] {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) {
    throw new AdnRejectionError("O Sistema Nacional devolveu o lote de documentos em formato inesperado.");
  }
  // Documento ilegível derruba o lote inteiro: pular faria o cursor avançar
  // por cima de uma nota que nunca seria lida.
  return items.map((item) => {
    const nsu = parseNsu(field(item, "NSU"));
    const xml = field(item, "ArquivoXml");
    if (nsu === null || typeof xml !== "string") {
      throw new AdnRejectionError("O Sistema Nacional devolveu um documento sem NSU ou sem XML.");
    }
    try {
      return { nsu, xml: gunzipBase64(xml) };
    } catch {
      throw new AdnRejectionError(`Não foi possível descompactar um documento do Sistema Nacional (NSU ${nsu}).`);
    }
  });
}

/**
 * Pede UM lote da distribuição, a partir do NSU, e devolve os XML já
 * descompactados. Erro de rede e timeout chegam como `NfseTransientError`
 * (é o que o transporte real rejeita); 429, 408 e 5xx também.
 */
export async function fetchAdnBatch(
  transport: HttpTransport,
  environment: NfseEnvironmentName,
  input: { fromNsu: number; cnpj: string },
): Promise<AdnBatch> {
  if (!Number.isSafeInteger(input.fromNsu) || input.fromNsu < 0) {
    throw new Error("O NSU inicial da consulta precisa ser um inteiro não negativo.");
  }
  if (!/^\d{14}$/.test(input.cnpj)) {
    throw new Error("O CNPJ da consulta precisa ter 14 dígitos, só números.");
  }
  const url =
    `${ADN_CONTRIBUINTES[environment]}/DFe/${encodeURIComponent(String(input.fromNsu))}` +
    `?lote=true&cnpjConsulta=${encodeURIComponent(input.cnpj)}`;

  const res = await transport({ method: "GET", url });
  if (res.status === 0 || res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new NfseTransientError(`O Sistema Nacional respondeu ${res.status}.`);
  }

  const body = parseJsonObject(res);
  const ok = res.status >= 200 && res.status < 300;
  // Sucesso que não é JSON (página de manutenção, proxy) não é "sem documentos".
  if (ok && body === null) {
    throw new NfseTransientError(`O Sistema Nacional respondeu ${res.status} com um corpo que não é JSON.`);
  }

  const status = String(field(body, "StatusProcessamento") ?? "").toUpperCase();
  const items = field(body, "LoteDFe");
  const declaredRejection = status === "REJEICAO";
  if (
    status === "NENHUM_DOCUMENTO_LOCALIZADO" && (ok || res.status === 404)
  ) {
    return { documents: [], done: true };
  }
  if (!ok || declaredRejection) {
    throw new AdnRejectionError(rejectionMessage(body, res.status));
  }

  // Contrato desconhecido nao prova ausencia de notas. Nao avance o cursor
  // nem marque a primeira leitura como completa sem um lote reconhecivel.
  if (!Array.isArray(items)) {
    throw new AdnRejectionError("O Sistema Nacional devolveu o lote de documentos em formato inesperado.");
  }

  const documents = readDocuments(items);
  return { documents, done: documents.length === 0 };
}
