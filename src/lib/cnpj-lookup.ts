import "server-only";

/**
 * Consulta de CNPJ na Receita via BrasilAPI (gratuita, sem chave) — usada
 * pelo fluxo "Novo cliente", pela conferência do Fluxo Societário e pela
 * aba de dados da empresa para exibir o retrato cadastral disponível (ver
 * docs/superpowers/specs/2026-08-18-cnpj-lookup-novo-cliente-design.md).
 */

const BRASIL_API_TIMEOUT_MS = 8000;

export interface CnpjActivity {
  code: string;
  description: string;
}

export interface CnpjQsaMember {
  name: string;
  document: string | null;
  qualification: string | null;
  joinedAt: string | null;
}

export interface CnpjTaxRegimeEntry {
  year: number | null;
  form: string;
}

export interface CnpjAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

export interface CnpjLookupData {
  legalName: string;
  tradeName: string | null;
  cnaeCode: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: CnpjActivity[];
  /** "YYYY-MM-DD", já no formato usado pelo restante do projeto. */
  openedAt: string | null;
  /** null quando a Receita não informa a opção pelo Simples. */
  isSimplesOptant: boolean | null;
  isMeiOptant: boolean | null;
  /** Ex.: "ATIVA", "BAIXADA", "SUSPENSA", "INAPTA". */
  cadastralSituation: string | null;
  cadastralSituationDate: string | null;
  companySize: string | null;
  legalNature: string | null;
  shareCapital: string | null;
  headquartersType: string | null;
  email: string | null;
  phones: string[];
  address: CnpjAddress | null;
  qsa: CnpjQsaMember[];
  taxRegimes: CnpjTaxRegimeEntry[];
}

export type CnpjLookupResult =
  | { ok: true; data: CnpjLookupData }
  | { ok: false; reason: "not_found" | "service_error" };

interface BrasilApiCnaeRaw {
  codigo?: unknown;
  descricao?: unknown;
}

interface BrasilApiQsaRaw {
  nome_socio?: unknown;
  cnpj_cpf_do_socio?: unknown;
  qualificacao_socio?: unknown;
  data_entrada_sociedade?: unknown;
}

interface BrasilApiTaxRegimeRaw {
  ano?: unknown;
  forma_de_tributacao?: unknown;
}

interface BrasilApiResponseRaw {
  razao_social?: unknown;
  nome_fantasia?: unknown;
  data_inicio_atividade?: unknown;
  cnae_fiscal?: unknown;
  cnae_fiscal_descricao?: unknown;
  cnaes_secundarios?: unknown;
  opcao_pelo_simples?: unknown;
  opcao_pelo_mei?: unknown;
  descricao_situacao_cadastral?: unknown;
  data_situacao_cadastral?: unknown;
  porte?: unknown;
  descricao_porte?: unknown;
  natureza_juridica?: unknown;
  capital_social?: unknown;
  descricao_identificador_matriz_filial?: unknown;
  identificador_matriz_filial?: unknown;
  email?: unknown;
  ddd_telefone_1?: unknown;
  ddd_telefone_2?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  municipio?: unknown;
  uf?: unknown;
  cep?: unknown;
  qsa?: unknown;
  regime_tributario?: unknown;
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

function asDate(value: unknown): string | null {
  const raw = asText(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function asDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().replace(",", ".");
  const numeric = Number(raw);
  return raw && Number.isFinite(numeric) ? numeric.toFixed(2) : null;
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
  const openedAt = asDate(openedAtRaw);

  const qsaRaw = Array.isArray(body.qsa) ? body.qsa : [];
  const qsa: CnpjQsaMember[] = qsaRaw
    .map((entry): CnpjQsaMember | null => {
      const item = entry as BrasilApiQsaRaw;
      const name = asText(item?.nome_socio);
      if (!name) return null;
      return {
        name,
        document: asText(item.cnpj_cpf_do_socio),
        qualification: asText(item.qualificacao_socio),
        joinedAt: asDate(item.data_entrada_sociedade),
      };
    })
    .filter((entry): entry is CnpjQsaMember => entry !== null);

  const taxRegimesRaw = Array.isArray(body.regime_tributario)
    ? body.regime_tributario
    : [];
  const taxRegimes: CnpjTaxRegimeEntry[] = taxRegimesRaw
    .map((entry): CnpjTaxRegimeEntry | null => {
      const item = entry as BrasilApiTaxRegimeRaw;
      const form = asText(item?.forma_de_tributacao);
      if (!form) return null;
      return {
        year:
          typeof item.ano === "number" && Number.isInteger(item.ano)
            ? item.ano
            : null,
        form,
      };
    })
    .filter((entry): entry is CnpjTaxRegimeEntry => entry !== null);

  const address: CnpjAddress = {
    street: asText(body.logradouro),
    number: asText(body.numero),
    complement: asText(body.complemento),
    district: asText(body.bairro),
    city: asText(body.municipio),
    state: asText(body.uf),
    zipCode: asText(body.cep),
  };
  const hasAddress = Object.values(address).some(Boolean);
  const phones = [asText(body.ddd_telefone_1), asText(body.ddd_telefone_2)]
    .filter((phone): phone is string => Boolean(phone));
  const headquartersType =
    asText(body.descricao_identificador_matriz_filial) ??
    (body.identificador_matriz_filial === 1
      ? "MATRIZ"
      : body.identificador_matriz_filial === 2
        ? "FILIAL"
        : null);

  return {
    legalName,
    tradeName: asText(body.nome_fantasia),
    cnaeCode: asCode(body.cnae_fiscal),
    cnaeDescription: asText(body.cnae_fiscal_descricao),
    secondaryCnaes,
    openedAt,
    isSimplesOptant:
      typeof body.opcao_pelo_simples === "boolean" ? body.opcao_pelo_simples : null,
    isMeiOptant:
      typeof body.opcao_pelo_mei === "boolean" ? body.opcao_pelo_mei : null,
    cadastralSituation: asText(body.descricao_situacao_cadastral),
    cadastralSituationDate: asDate(body.data_situacao_cadastral),
    companySize: asText(body.porte) ?? asText(body.descricao_porte),
    legalNature: asText(body.natureza_juridica),
    shareCapital: asDecimal(body.capital_social),
    headquartersType,
    email: asText(body.email),
    phones,
    address: hasAddress ? address : null,
    qsa,
    taxRegimes,
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
