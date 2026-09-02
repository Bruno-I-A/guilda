import "server-only";

/**
 * Consulta de CNPJ em fontes públicas gratuitas — usada
 * pelo fluxo "Novo cliente", pela conferência do Fluxo Societário e pela
 * aba de dados da empresa para exibir o retrato cadastral disponível (ver
 * docs/superpowers/specs/2026-08-18-cnpj-lookup-novo-cliente-design.md).
 */

const PROVIDER_TIMEOUT_MS = 8000;

export interface CnpjActivity {
  code: string;
  description: string;
}

export interface CnpjQsaMember {
  name: string;
  document: string | null;
  qualification: string | null;
  joinedAt: string | null;
  /** A consulta pública normalmente não informa a participação societária. */
  participation: string | null;
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
  | { ok: false; reason: "not_found" | "rate_limited" | "service_error" };

interface BrasilApiCnaeRaw {
  codigo?: unknown;
  descricao?: unknown;
}

interface BrasilApiQsaRaw {
  nome_socio?: unknown;
  cnpj_cpf_do_socio?: unknown;
  qualificacao_socio?: unknown;
  data_entrada_sociedade?: unknown;
  percentual_capital_social?: unknown;
  participacao_societaria?: unknown;
  participacao?: unknown;
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

function asNormalizedCode(value: unknown): string | null {
  const code = asCode(value);
  if (!code) return null;
  return code.replace(/\D/g, "") || code;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function asDate(value: unknown): string | null {
  const raw = asText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

function asDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().replace(",", ".");
  const numeric = Number(raw);
  return raw && Number.isFinite(numeric) ? numeric.toFixed(2) : null;
}

function asPercentage(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().replace(",", ".").replace(/%$/, "").trim();
  const numeric = Number(raw);
  if (!raw || !Number.isFinite(numeric)) return null;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(numeric)}%`;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = asText(value)?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized === "sim") return true;
  if (normalized === "nao") return false;
  return null;
}

function usefulPhone(value: unknown): string | null {
  const phone = asText(value);
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return /^\d{10,11}$/.test(digits) && !/^(\d)\1+$/.test(digits)
    ? digits
    : null;
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
        participation: asPercentage(
          item.percentual_capital_social ??
            item.participacao_societaria ??
            item.participacao,
        ),
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

/** Mapeia a API pública do CNPJ.ws para o contrato interno da Guilda. */
export function mapCnpjWsResponse(raw: unknown): CnpjLookupData | null {
  const body = asRecord(raw);
  const establishment = asRecord(body?.estabelecimento);
  if (!body || !establishment) return null;

  const legalName = asText(body.razao_social);
  if (!legalName) return null;

  const mainActivity = asRecord(establishment.atividade_principal);
  const secondaryCnaes = (Array.isArray(establishment.atividades_secundarias)
    ? establishment.atividades_secundarias
    : [])
    .map((entry): CnpjActivity | null => {
      const item = asRecord(entry);
      const code = asNormalizedCode(item?.id);
      const description = asText(item?.descricao);
      return code && description ? { code, description } : null;
    })
    .filter((entry): entry is CnpjActivity => entry !== null);

  const qsa = (Array.isArray(body.socios) ? body.socios : [])
    .map((entry): CnpjQsaMember | null => {
      const item = asRecord(entry);
      const name = asText(item?.nome);
      if (!name) return null;
      return {
        name,
        document: asText(item?.cpf_cnpj_socio),
        qualification: asText(asRecord(item?.qualificacao_socio)?.descricao),
        joinedAt: asDate(item?.data_entrada),
        participation: null,
      };
    })
    .filter((entry): entry is CnpjQsaMember => entry !== null);

  const city = asRecord(establishment.cidade);
  const state = asRecord(establishment.estado);
  const street = [
    asText(establishment.tipo_logradouro),
    asText(establishment.logradouro),
  ].filter(Boolean).join(" ") || null;
  const address: CnpjAddress = {
    street,
    number: asText(establishment.numero),
    complement: asText(establishment.complemento),
    district: asText(establishment.bairro),
    city: asText(city?.nome),
    state: asText(state?.sigla),
    zipCode: asText(establishment.cep),
  };
  const simples = asRecord(body.simples);
  const phones = [
    usefulPhone(`${asText(establishment.ddd1) ?? ""}${asText(establishment.telefone1) ?? ""}`),
    usefulPhone(`${asText(establishment.ddd2) ?? ""}${asText(establishment.telefone2) ?? ""}`),
  ].filter((phone): phone is string => phone !== null);

  return {
    legalName,
    tradeName: asText(establishment.nome_fantasia),
    cnaeCode: asNormalizedCode(mainActivity?.id),
    cnaeDescription: asText(mainActivity?.descricao),
    secondaryCnaes,
    openedAt: asDate(establishment.data_inicio_atividade),
    isSimplesOptant: asBoolean(simples?.simples),
    isMeiOptant: asBoolean(simples?.mei),
    cadastralSituation: asText(establishment.situacao_cadastral),
    cadastralSituationDate: asDate(establishment.data_situacao_cadastral),
    companySize: asText(asRecord(body.porte)?.descricao),
    legalNature: asText(asRecord(body.natureza_juridica)?.descricao),
    shareCapital: asDecimal(body.capital_social),
    headquartersType: asText(establishment.tipo),
    email: asText(establishment.email),
    phones,
    address: Object.values(address).some(Boolean) ? address : null,
    qsa,
    taxRegimes: [],
  };
}

/** Mapeia a resposta gratuita da ReceitaWS para o contrato interno. */
export function mapReceitaWsResponse(raw: unknown): CnpjLookupData | null {
  const body = asRecord(raw);
  if (!body || asText(body.status)?.toUpperCase() === "ERROR") return null;
  const legalName = asText(body.nome);
  if (!legalName) return null;

  const primary = asRecord(
    Array.isArray(body.atividade_principal) ? body.atividade_principal[0] : null,
  );
  const secondaryCnaes = (Array.isArray(body.atividades_secundarias)
    ? body.atividades_secundarias
    : [])
    .map((entry): CnpjActivity | null => {
      const item = asRecord(entry);
      const code = asNormalizedCode(item?.code);
      const description = asText(item?.text);
      return code && description ? { code, description } : null;
    })
    .filter((entry): entry is CnpjActivity => entry !== null);
  const qsa = (Array.isArray(body.qsa) ? body.qsa : [])
    .map((entry): CnpjQsaMember | null => {
      const item = asRecord(entry);
      const name = asText(item?.nome);
      return name ? {
        name,
        document: null,
        qualification: asText(item?.qual),
        joinedAt: null,
        participation: null,
      } : null;
    })
    .filter((entry): entry is CnpjQsaMember => entry !== null);
  const address: CnpjAddress = {
    street: asText(body.logradouro),
    number: asText(body.numero),
    complement: asText(body.complemento),
    district: asText(body.bairro),
    city: asText(body.municipio),
    state: asText(body.uf),
    zipCode: asText(body.cep),
  };
  const phones = (asText(body.telefone)?.split("/") ?? [])
    .map(usefulPhone)
    .filter((phone): phone is string => phone !== null);

  return {
    legalName,
    tradeName: asText(body.fantasia),
    cnaeCode: asNormalizedCode(primary?.code),
    cnaeDescription: asText(primary?.text),
    secondaryCnaes,
    openedAt: asDate(body.abertura),
    isSimplesOptant: asBoolean(asRecord(body.simples)?.optante),
    isMeiOptant: asBoolean(asRecord(body.simei)?.optante),
    cadastralSituation: asText(body.situacao),
    cadastralSituationDate: asDate(body.data_situacao),
    companySize: asText(body.porte),
    legalNature: asText(body.natureza_juridica),
    shareCapital: asDecimal(body.capital_social),
    headquartersType: asText(body.tipo),
    email: asText(body.email),
    phones,
    address: Object.values(address).some(Boolean) ? address : null,
    qsa,
    taxRegimes: [],
  };
}

type LookupFailureReason = Exclude<CnpjLookupResult, { ok: true }>["reason"];

const CNPJ_PROVIDERS = [
  {
    url: (cnpj: string) => `https://publica.cnpj.ws/cnpj/${cnpj}`,
    map: mapCnpjWsResponse,
  },
  {
    url: (cnpj: string) => `https://www.receitaws.com.br/v1/cnpj/${cnpj}`,
    map: mapReceitaWsResponse,
  },
  {
    url: (cnpj: string) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    map: mapBrasilApiResponse,
  },
] as const;

async function queryProvider(
  provider: (typeof CNPJ_PROVIDERS)[number],
  normalizedCnpj: string,
): Promise<CnpjLookupResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(provider.url(normalizedCnpj), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Guilda/1.0 (contabilidade; +https://github.com/Bruno-I-A/guilda)",
        Accept: "application/json",
      },
    });
    if (response.status === 404) return { ok: false, reason: "not_found" };
    if (
      response.status === 429 ||
      (response.status === 403 && response.headers.get("x-vercel-mitigated") === "deny")
    ) {
      return { ok: false, reason: "rate_limited" };
    }
    if (!response.ok) return { ok: false, reason: "service_error" };
    const data = provider.map(await response.json());
    return data ? { ok: true, data } : { ok: false, reason: "service_error" };
  } catch {
    return { ok: false, reason: "service_error" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Busca um CNPJ já normalizado (14 dígitos), tentando fontes independentes.
 * Nunca lança — falha de rede/timeout vira `{ ok: false, reason: "service_error" }`
 * para o chamador decidir a mensagem (o preenchimento manual continua liberado).
 */
export async function lookupCnpj(normalizedCnpj: string): Promise<CnpjLookupResult> {
  const failures: LookupFailureReason[] = [];
  for (const provider of CNPJ_PROVIDERS) {
    const result = await queryProvider(provider, normalizedCnpj);
    if (result.ok) return result;
    failures.push(result.reason);
  }
  if (failures.includes("rate_limited")) return { ok: false, reason: "rate_limited" };
  if (failures.includes("service_error")) return { ok: false, reason: "service_error" };
  return { ok: false, reason: "not_found" };
}
