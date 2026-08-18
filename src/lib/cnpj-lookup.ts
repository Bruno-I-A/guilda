import "server-only";

/**
 * Consulta de CNPJ na Receita via BrasilAPI (gratuita, sem chave) — usada
 * só pelo fluxo "Novo cliente" dos Informativos para pré-preencher razão
 * social, atividades e data de abertura (ver
 * docs/superpowers/specs/2026-08-18-cnpj-lookup-novo-cliente-design.md).
 */

const BRASIL_API_TIMEOUT_MS = 8000;

export interface CnpjActivity {
  code: string;
  description: string;
}

export interface CnpjLookupData {
  legalName: string;
  cnaeCode: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: CnpjActivity[];
  /** "YYYY-MM-DD", já no formato usado pelo restante do projeto. */
  openedAt: string | null;
  /** null quando a Receita não informa a opção pelo Simples. */
  isSimplesOptant: boolean | null;
  /** Ex.: "ATIVA", "BAIXADA", "SUSPENSA", "INAPTA". */
  cadastralSituation: string | null;
}

export type CnpjLookupResult =
  | { ok: true; data: CnpjLookupData }
  | { ok: false; reason: "not_found" | "service_error" };

interface BrasilApiCnaeRaw {
  codigo?: unknown;
  descricao?: unknown;
}

interface BrasilApiResponseRaw {
  razao_social?: unknown;
  data_inicio_atividade?: unknown;
  cnae_fiscal?: unknown;
  cnae_fiscal_descricao?: unknown;
  cnaes_secundarios?: unknown;
  opcao_pelo_simples?: unknown;
  descricao_situacao_cadastral?: unknown;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asCode(value: unknown): string | null {
  if (typeof value === "string") return asText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Mapeia a resposta bruta da BrasilAPI para o formato do projeto. Pura —
 * sem rede — para ser testável isoladamente.
 */
export function mapBrasilApiResponse(raw: unknown): CnpjLookupData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as BrasilApiResponseRaw;

  const legalName = asText(body.razao_social);
  if (!legalName) return null;

  const secondaryCnaesRaw = Array.isArray(body.cnaes_secundarios)
    ? body.cnaes_secundarios
    : [];
  const secondaryCnaes: CnpjActivity[] = secondaryCnaesRaw
    .map((entry): CnpjActivity | null => {
      const item = entry as BrasilApiCnaeRaw;
      const code = asCode(item?.codigo);
      const description = asText(item?.descricao);
      return code && description ? { code, description } : null;
    })
    .filter((entry): entry is CnpjActivity => entry !== null);

  const openedAtRaw = asText(body.data_inicio_atividade);
  const openedAt =
    openedAtRaw && /^\d{4}-\d{2}-\d{2}/.test(openedAtRaw)
      ? openedAtRaw.slice(0, 10)
      : null;

  return {
    legalName,
    cnaeCode: asCode(body.cnae_fiscal),
    cnaeDescription: asText(body.cnae_fiscal_descricao),
    secondaryCnaes,
    openedAt,
    isSimplesOptant:
      typeof body.opcao_pelo_simples === "boolean" ? body.opcao_pelo_simples : null,
    cadastralSituation: asText(body.descricao_situacao_cadastral),
  };
}

/**
 * Busca um CNPJ já normalizado (14 dígitos) na BrasilAPI.
 * Nunca lança — falha de rede/timeout vira `{ ok: false, reason: "service_error" }`
 * para o chamador decidir a mensagem (o preenchimento manual continua liberado).
 */
export async function lookupCnpj(normalizedCnpj: string): Promise<CnpjLookupResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRASIL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://brasilapi.com.br/api/cnpj/v1/${normalizedCnpj}`,
      {
        signal: controller.signal,
        // Sem User-Agent explícito, a proteção da BrasilAPI recusa o fetch
        // padrão do Node com 403 — descoberto testando contra a API de
        // verdade (nenhum teste automatizado pega isso, é comportamento do
        // serviço externo).
        headers: {
          "User-Agent": "Guilda/1.0 (contabilidade; +https://github.com/Bruno-I-A/guilda)",
          Accept: "application/json",
        },
      },
    );

    if (response.status === 404) {
      return { ok: false, reason: "not_found" };
    }
    if (!response.ok) {
      return { ok: false, reason: "service_error" };
    }

    const data = mapBrasilApiResponse(await response.json());
    return data ? { ok: true, data } : { ok: false, reason: "service_error" };
  } catch {
    return { ok: false, reason: "service_error" };
  } finally {
    clearTimeout(timeout);
  }
}
