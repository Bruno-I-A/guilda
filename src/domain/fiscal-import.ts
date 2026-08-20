/**
 * Regras puras para preparar a importação do controle fiscal legado.
 *
 * Este módulo deliberadamente não decide nem cria vínculos no banco. Ele só
 * normaliza a linha da planilha e oferece correspondências explicáveis para
 * que uma pessoa confirme a conciliação com um cliente já cadastrado.
 */

const CONNECTOR_TOKENS = new Set([
  "a",
  "as",
  "d",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
]);

const GENERIC_BUSINESS_TOKENS = new Set([
  "assessoria",
  "comercio",
  "consultoria",
  "empresa",
  "empreendimentos",
  "grupo",
  "industria",
  "representacoes",
  "servicos",
  "solucoes",
]);

// Só são retirados no FIM do nome. "SA Transportes", por exemplo, preserva
// "sa", pois ali ele pode fazer parte do nome fantasia e não do tipo jurídico.
const LEGAL_SUFFIXES = new Set([
  "cia",
  "eireli",
  "epp",
  "limitada",
  "ltda",
  "me",
  "mei",
  "microempresa",
  "sa",
  "slu",
  "ss",
  "unipessoal",
]);

export interface NormalizedCompanyName {
  /** Texto sem acentos, caixa ou pontuação; conserva conectores e sufixos. */
  canonical: string;
  /** Versão de comparação sem tipo societário final e conectores. */
  core: string;
  tokens: readonly string[];
  coreTokens: readonly string[];
}

function foldText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " e ")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function withoutLegalSuffixes(tokens: readonly string[]): string[] {
  const result = [...tokens];
  const legalPhrases = [
    ["sociedade", "anonima"],
    ["sociedade", "limitada"],
    ["sociedade", "simples"],
    ["s", "a"],
    ["s", "s"],
  ];
  let changed = true;
  while (result.length > 1 && changed) {
    changed = false;
    const phrase = legalPhrases.find(
      (candidate) =>
        candidate.length < result.length &&
        candidate.every(
          (token, index) =>
            result[result.length - candidate.length + index] === token,
        ),
    );
    if (phrase) {
      result.splice(result.length - phrase.length, phrase.length);
      changed = true;
      continue;
    }
    if (LEGAL_SUFFIXES.has(result.at(-1) ?? "")) {
      result.pop();
      changed = true;
    }
  }
  return result;
}

export function normalizeCompanyName(value: string): NormalizedCompanyName {
  const canonical = foldText(value);
  const tokens = canonical ? canonical.split(" ") : [];
  const withoutSuffixes = withoutLegalSuffixes(tokens);
  const meaningful = withoutSuffixes.filter(
    (token) => !CONNECTOR_TOKENS.has(token),
  );
  // Um nome composto apenas por conectores não deve desaparecer.
  const coreTokens = meaningful.length > 0 ? meaningful : withoutSuffixes;

  return {
    canonical,
    core: coreTokens.join(" "),
    tokens,
    coreTokens,
  };
}

export interface FiscalImportClient {
  id: string;
  name: string;
  /** Nomes já conciliados anteriormente com este cadastro. */
  aliases?: readonly string[];
}

export type CompanyMatchReasonCode =
  | "exact_name"
  | "exact_core_name"
  | "exact_alias"
  | "exact_alias_core"
  | "alias_similarity"
  | "same_compact_name"
  | "token_containment"
  | "token_overlap"
  | "spelling_similarity";

export interface CompanyMatchReason {
  code: CompanyMatchReasonCode;
  label: string;
}

export interface CompanyMatchSuggestion {
  clientId: string;
  clientName: string;
  /** Valor determinístico de 0 a 1, arredondado em quatro casas. */
  score: number;
  matchedAlias: string | null;
  reasons: readonly CompanyMatchReason[];
}

export type CompanyReconciliationStatus =
  | "exact"
  | "suggested"
  | "ambiguous"
  | "unmatched";

export interface CompanyReconciliationResult {
  importedName: string;
  normalizedName: NormalizedCompanyName;
  status: CompanyReconciliationStatus;
  /** Só existe em correspondência exata e inequívoca. */
  exactMatch: CompanyMatchSuggestion | null;
  suggestions: readonly CompanyMatchSuggestion[];
  explanation: string;
}

export interface ReconcileCompanyNameOptions {
  /** Menor score exibido à pessoa. Padrão: 0,58. */
  suggestionThreshold?: number;
  /** Diferença mínima entre 1º e 2º para não marcar ambiguidade. Padrão: 0,08. */
  ambiguityGap?: number;
  /** Limite de opções devolvidas para a tela. Padrão: 5. */
  maxSuggestions?: number;
}

interface SimilarityMetrics {
  score: number;
  compactEqual: boolean;
  tokenContainment: number;
  tokenOverlap: number;
  editSimilarity: number;
}

interface RankedForm {
  client: FiscalImportClient;
  normalized: NormalizedCompanyName;
  alias: string | null;
}

function tokenWeight(token: string): number {
  if (GENERIC_BUSINESS_TOKENS.has(token)) return 0.35;
  if (token.length <= 2) return 0.5;
  return 1;
}

function weightedTokenMetrics(
  leftTokens: readonly string[],
  rightTokens: readonly string[],
): { overlap: number; containment: number } {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const union = new Set([...left, ...right]);
  let intersectionWeight = 0;
  let unionWeight = 0;
  let smallerWeight = Number.POSITIVE_INFINITY;
  let leftWeight = 0;
  let rightWeight = 0;

  for (const token of left) leftWeight += tokenWeight(token);
  for (const token of right) rightWeight += tokenWeight(token);
  for (const token of union) {
    const weight = tokenWeight(token);
    unionWeight += weight;
    if (left.has(token) && right.has(token)) intersectionWeight += weight;
  }
  smallerWeight = Math.min(leftWeight, rightWeight);

  return {
    overlap: unionWeight > 0 ? intersectionWeight / unionWeight : 0,
    containment: smallerWeight > 0 ? intersectionWeight / smallerWeight : 0,
  };
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function bigrams(value: string): Map<string, number> {
  const result = new Map<string, number>();
  if (value.length < 2) {
    if (value) result.set(value, 1);
    return result;
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);
    result.set(pair, (result.get(pair) ?? 0) + 1);
  }
  return result;
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) return left ? 1 : 0;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let intersection = 0;
  let leftCount = 0;
  let rightCount = 0;

  for (const count of leftBigrams.values()) leftCount += count;
  for (const count of rightBigrams.values()) rightCount += count;
  for (const [pair, count] of leftBigrams) {
    intersection += Math.min(count, rightBigrams.get(pair) ?? 0);
  }
  const total = leftCount + rightCount;
  return total > 0 ? (2 * intersection) / total : 0;
}

function similarity(
  source: NormalizedCompanyName,
  target: NormalizedCompanyName,
): SimilarityMetrics {
  const leftCompact = source.core.replace(/\s/g, "");
  const rightCompact = target.core.replace(/\s/g, "");
  const maxLength = Math.max(leftCompact.length, rightCompact.length);
  const editSimilarity =
    maxLength > 0
      ? 1 - levenshteinDistance(leftCompact, rightCompact) / maxLength
      : 0;
  const dice = diceSimilarity(leftCompact, rightCompact);
  const tokens = weightedTokenMetrics(source.coreTokens, target.coreTokens);
  const compactEqual = Boolean(leftCompact && leftCompact === rightCompact);

  let score = Math.max(
    editSimilarity * 0.45 + dice * 0.35 + tokens.overlap * 0.2,
    tokens.overlap * 0.5 + tokens.containment * 0.2 + editSimilarity * 0.3,
  );
  if (compactEqual) score = Math.max(score, 0.97);
  else if (tokens.containment === 1) {
    const lengthCoverage =
      Math.min(leftCompact.length, rightCompact.length) / maxLength;
    score = Math.max(score, 0.72 + lengthCoverage * 0.18);
  }

  return {
    score,
    compactEqual,
    tokenContainment: tokens.containment,
    tokenOverlap: tokens.overlap,
    editSimilarity,
  };
}

function reasonsFor(
  metrics: SimilarityMetrics,
  alias: string | null,
): CompanyMatchReason[] {
  const reasons: CompanyMatchReason[] = [];
  if (alias) {
    reasons.push({
      code: "alias_similarity",
      label: `Semelhança com o nome conhecido “${alias}”.`,
    });
  }
  if (metrics.compactEqual) {
    reasons.push({
      code: "same_compact_name",
      label: "O nome coincide ao ignorar espaços e pontuação.",
    });
  }
  if (metrics.tokenContainment >= 0.999 && !metrics.compactEqual) {
    reasons.push({
      code: "token_containment",
      label: "Todas as palavras relevantes de um nome aparecem no outro.",
    });
  } else if (metrics.tokenOverlap > 0) {
    reasons.push({
      code: "token_overlap",
      label: `${Math.round(metrics.tokenOverlap * 100)}% das palavras ponderadas coincidem.`,
    });
  }
  if (metrics.editSimilarity >= 0.65 && !metrics.compactEqual) {
    reasons.push({
      code: "spelling_similarity",
      label: `${Math.round(metrics.editSimilarity * 100)}% de semelhança na grafia.`,
    });
  }
  return reasons;
}

function exactReason(
  code: Extract<
    CompanyMatchReasonCode,
    "exact_name" | "exact_core_name" | "exact_alias" | "exact_alias_core"
  >,
  alias: string | null,
): CompanyMatchReason {
  const labels: Record<typeof code, string> = {
    exact_name: "Mesmo nome após normalizar acentos, caixa e pontuação.",
    exact_core_name: "Mesmo nome após retirar conectores e tipo societário final.",
    exact_alias: `Nome idêntico ao alias conhecido “${alias ?? ""}”.`,
    exact_alias_core: `Nome idêntico ao alias “${alias ?? ""}” sem o tipo societário final.`,
  };
  return { code, label: labels[code] };
}

function strongEnoughForCoreExact(normalized: NormalizedCompanyName): boolean {
  if (normalized.coreTokens.length >= 2) return true;
  const only = normalized.coreTokens[0] ?? "";
  return only.length >= 5 && !GENERIC_BUSINESS_TOKENS.has(only);
}

function exactSuggestion(
  form: RankedForm,
  reason: CompanyMatchReason,
): CompanyMatchSuggestion {
  return {
    clientId: form.client.id,
    clientName: form.client.name,
    score: 1,
    matchedAlias: form.alias,
    reasons: [reason],
  };
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function validateOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

/**
 * Concilia um nome da planilha com cadastros existentes.
 *
 * Somente igualdade normalizada inequívoca preenche `exactMatch`. Resultados
 * aproximados são sugestões para confirmação humana — esta função jamais
 * manda criar uma empresa nova nem escolhe silenciosamente entre semelhantes.
 */
export function reconcileCompanyName(
  importedName: string,
  clients: readonly FiscalImportClient[],
  options: ReconcileCompanyNameOptions = {},
): CompanyReconciliationResult {
  const normalizedName = normalizeCompanyName(importedName);
  if (!normalizedName.canonical) {
    return {
      importedName,
      normalizedName,
      status: "unmatched",
      exactMatch: null,
      suggestions: [],
      explanation: "A linha não contém um nome de empresa utilizável.",
    };
  }

  const forms: RankedForm[] = clients.flatMap((client) => [
    { client, normalized: normalizeCompanyName(client.name), alias: null },
    ...(client.aliases ?? []).map((alias) => ({
      client,
      normalized: normalizeCompanyName(alias),
      alias,
    })),
  ]);

  const findExact = (
    predicate: (form: RankedForm) => boolean,
    reasonCode: Extract<
      CompanyMatchReasonCode,
      "exact_name" | "exact_core_name" | "exact_alias" | "exact_alias_core"
    >,
  ): CompanyMatchSuggestion[] => {
    const byClient = new Map<string, CompanyMatchSuggestion>();
    for (const form of forms.filter(predicate)) {
      if (!byClient.has(form.client.id)) {
        byClient.set(
          form.client.id,
          exactSuggestion(form, exactReason(reasonCode, form.alias)),
        );
      }
    }
    return [...byClient.values()].sort(
      (left, right) =>
        left.clientName.localeCompare(right.clientName, "pt-BR") ||
        left.clientId.localeCompare(right.clientId),
    );
  };

  const exactCanonicalForms = forms.filter(
    (form) => form.normalized.canonical === normalizedName.canonical,
  );
  const exactCanonical = findExact(
    (form) => form.normalized.canonical === normalizedName.canonical,
    exactCanonicalForms[0]?.alias === null ? "exact_name" : "exact_alias",
  );
  const exactChecks: Array<{
    matches: CompanyMatchSuggestion[];
    explanation: string;
  }> = [
    {
      matches: exactCanonical,
      explanation:
        exactCanonicalForms[0]?.alias === null
          ? "Nome normalizado idêntico a um único cadastro."
          : "Nome idêntico a um alias já conhecido e inequívoco.",
    },
  ];

  if (strongEnoughForCoreExact(normalizedName)) {
    const exactCoreForms = forms.filter(
      (form) => form.normalized.core === normalizedName.core,
    );
    exactChecks.push({
      matches: findExact(
        (form) => form.normalized.core === normalizedName.core,
        exactCoreForms[0]?.alias === null
          ? "exact_core_name"
          : "exact_alias_core",
      ),
      explanation:
        exactCoreForms[0]?.alias === null
          ? "Nome-base idêntico a um único cadastro após retirar o tipo societário."
          : "Nome-base idêntico a um alias conhecido após retirar o tipo societário.",
    });
  }

  for (const check of exactChecks) {
    if (check.matches.length === 1) {
      return {
        importedName,
        normalizedName,
        status: "exact",
        exactMatch: check.matches[0] ?? null,
        suggestions: check.matches,
        explanation: check.explanation,
      };
    }
    if (check.matches.length > 1) {
      return {
        importedName,
        normalizedName,
        status: "ambiguous",
        exactMatch: null,
        suggestions: check.matches,
        explanation:
          "Mais de um cadastro possui o mesmo nome normalizado; é necessária confirmação manual.",
      };
    }
  }

  const bestByClient = new Map<string, CompanyMatchSuggestion>();
  for (const form of forms) {
    if (!form.normalized.core) continue;
    const metrics = similarity(normalizedName, form.normalized);
    const aliasBonus = form.alias ? 0.035 : 0;
    const suggestion: CompanyMatchSuggestion = {
      clientId: form.client.id,
      clientName: form.client.name,
      score: roundScore(metrics.score + aliasBonus),
      matchedAlias: form.alias,
      reasons: reasonsFor(metrics, form.alias),
    };
    const previous = bestByClient.get(form.client.id);
    if (
      !previous ||
      suggestion.score > previous.score ||
      (suggestion.score === previous.score &&
        suggestion.matchedAlias !== null &&
        previous.matchedAlias === null)
    ) {
      bestByClient.set(form.client.id, suggestion);
    }
  }

  const threshold = validateOption(options.suggestionThreshold, 0.58, 0, 1);
  const ambiguityGap = validateOption(options.ambiguityGap, 0.08, 0, 1);
  const maxSuggestions = Math.round(
    validateOption(options.maxSuggestions, 5, 1, 50),
  );
  const suggestions = [...bestByClient.values()]
    .filter((suggestion) => suggestion.score >= threshold)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.clientName.localeCompare(right.clientName, "pt-BR") ||
        left.clientId.localeCompare(right.clientId),
    )
    .slice(0, maxSuggestions);

  if (suggestions.length === 0) {
    return {
      importedName,
      normalizedName,
      status: "unmatched",
      exactMatch: null,
      suggestions,
      explanation:
        "Nenhum cadastro atingiu o nível mínimo de semelhança. A linha deve ficar pendente, sem criar empresa automaticamente.",
    };
  }

  const first = suggestions[0];
  const second = suggestions[1];
  const isAmbiguous = Boolean(
    first && second && first.score - second.score < ambiguityGap,
  );
  return {
    importedName,
    normalizedName,
    status: isAmbiguous ? "ambiguous" : "suggested",
    exactMatch: null,
    suggestions,
    explanation: isAmbiguous
      ? "As melhores sugestões têm pontuações muito próximas; a pessoa precisa escolher o cadastro correto."
      : "Há uma sugestão provável, mas o vínculo precisa ser confirmado por uma pessoa.",
  };
}

export type FiscalApplicability = "yes" | "no" | "not_applicable" | null;

export interface ParsedFiscalApplicability {
  value: FiscalApplicability;
  raw: string | null;
  recognized: boolean;
}

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const normalized = value.replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
    return normalized || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function multilineCellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const normalized = value.replace(/\u00a0/g, " ").trim();
    return normalized || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** Converte SIM/NÃO/X/vazio sem descartar valores inesperados silenciosamente. */
export function parseFiscalApplicability(
  input: unknown,
): ParsedFiscalApplicability {
  const raw = cellText(input);
  if (!raw || ["-", "—"].includes(raw)) {
    return { value: null, raw, recognized: true };
  }
  const normalized = foldText(raw).replace(/\s/g, "");
  if (["sim", "s", "yes", "true", "1"].includes(normalized)) {
    return { value: "yes", raw, recognized: true };
  }
  if (["nao", "n", "no", "false", "0"].includes(normalized)) {
    return { value: "no", raw, recognized: true };
  }
  if (
    [
      "x",
      "na",
      "n/a",
      "naoseaplica",
      "naoaplicavel",
      "dispensado",
      "dispensada",
    ].includes(normalized)
  ) {
    return { value: "not_applicable", raw, recognized: true };
  }
  return { value: null, raw, recognized: false };
}

export type FiscalDeliveryKind =
  | "onvio"
  | "malote"
  | "email"
  | "whatsapp"
  | "portal"
  | "printed"
  | "in_person"
  | "custom"
  | null;

export interface ParsedFiscalDelivery {
  kind: FiscalDeliveryKind;
  /** Texto original limpo; preserva nomes de pessoas e combinações próprias. */
  detail: string | null;
  recognized: boolean;
}

export function parseFiscalDelivery(input: unknown): ParsedFiscalDelivery {
  const detail = cellText(input);
  if (!detail || ["-", "—"].includes(detail)) {
    return { kind: null, detail, recognized: true };
  }
  const normalized = foldText(detail);
  const rules: Array<[FiscalDeliveryKind, RegExp]> = [
    ["onvio", /\bonvio\b/],
    ["malote", /\bmalote\b/],
    ["email", /\be ?mail\b/],
    ["whatsapp", /\b(?:whatsapp|whats|wpp)\b/],
    ["portal", /\b(?:portal|site)\b/],
    ["printed", /\b(?:impresso|impressa|papel)\b/],
    ["in_person", /\b(?:presencial|retira|retirada)\b/],
  ];
  const match = rules.find(([, pattern]) => pattern.test(normalized));
  if (match) return { kind: match[0], detail, recognized: true };
  return { kind: "custom", detail, recognized: false };
}

/** Limpa ruído de célula sem alterar caixa, pontuação ou quebras intencionais. */
export function normalizeFiscalObservation(input: unknown): string | null {
  const raw = multilineCellText(input);
  if (!raw) return null;
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter(Boolean)
    .join("\n") || null;
}

export interface RawFiscalImportRow {
  companyName: unknown;
  movements?: unknown;
  incoming?: unknown;
  outgoing?: unknown;
  guide?: unknown;
  delivery?: unknown;
  nfs?: unknown;
  observations?: unknown;
}

export type FiscalImportRowField =
  | "companyName"
  | "movements"
  | "incoming"
  | "outgoing"
  | "guide"
  | "delivery"
  | "nfs";

export interface FiscalImportRowIssue {
  field: FiscalImportRowField;
  raw: string | null;
  message: string;
}

export interface ParsedFiscalImportRow {
  companyName: string | null;
  normalizedCompanyName: NormalizedCompanyName;
  movements: ParsedFiscalApplicability;
  incoming: ParsedFiscalApplicability;
  outgoing: ParsedFiscalApplicability;
  guide: ParsedFiscalApplicability;
  delivery: ParsedFiscalDelivery;
  nfs: ParsedFiscalApplicability;
  observations: string | null;
  issues: readonly FiscalImportRowIssue[];
}

/** Prepara uma linha já mapeada pelo leitor de Excel para pré-visualização. */
export function parseFiscalImportRow(
  row: RawFiscalImportRow,
): ParsedFiscalImportRow {
  const companyName = cellText(row.companyName);
  const movements = parseFiscalApplicability(row.movements);
  const incoming = parseFiscalApplicability(row.incoming);
  const outgoing = parseFiscalApplicability(row.outgoing);
  const guide = parseFiscalApplicability(row.guide);
  const delivery = parseFiscalDelivery(row.delivery);
  const nfs = parseFiscalApplicability(row.nfs);
  const issues: FiscalImportRowIssue[] = [];

  if (!companyName) {
    issues.push({
      field: "companyName",
      raw: null,
      message: "A linha não informa o nome da empresa.",
    });
  }
  const applicabilityFields = [
    ["movements", movements],
    ["incoming", incoming],
    ["outgoing", outgoing],
    ["guide", guide],
    ["nfs", nfs],
  ] as const;
  for (const [field, parsed] of applicabilityFields) {
    if (!parsed.recognized) {
      issues.push({
        field,
        raw: parsed.raw,
        message: "Valor não reconhecido; revise antes de importar.",
      });
    }
  }
  if (!delivery.recognized) {
    issues.push({
      field: "delivery",
      raw: delivery.detail,
      message:
        "Forma de entrega personalizada; confirme ou mantenha o texto original.",
    });
  }

  return {
    companyName,
    normalizedCompanyName: normalizeCompanyName(companyName ?? ""),
    movements,
    incoming,
    outgoing,
    guide,
    delivery,
    nfs,
    observations: normalizeFiscalObservation(row.observations),
    issues,
  };
}

export const FISCAL_SPREADSHEET_FIELDS = [
  "companyName",
  "movements",
  "incoming",
  "outgoing",
  "guide",
  "delivery",
  "nfs",
  "observations",
] as const;

export type FiscalSpreadsheetField =
  (typeof FISCAL_SPREADSHEET_FIELDS)[number];

export type FiscalSpreadsheetColumnMap = Partial<
  Record<FiscalSpreadsheetField, number>
>;

const HEADER_ALIASES: Readonly<Record<FiscalSpreadsheetField, readonly string[]>> = {
  companyName: [
    "empresa",
    "empresas",
    "cliente",
    "clientes",
    "nome empresa",
    "nome da empresa",
    "razao social",
  ],
  movements: [
    "movimento",
    "movimentos",
    "movimentacao",
    "movimentacoes",
  ],
  incoming: [
    "entrada",
    "entradas",
    "documento entrada",
    "documentos entrada",
    "documentos de entrada",
  ],
  outgoing: [
    "saida",
    "saidas",
    "documento saida",
    "documentos saida",
    "documentos de saida",
  ],
  guide: ["guia", "guias", "guia imposto", "guias impostos"],
  delivery: [
    "entrega",
    "entregas",
    "canal entrega",
    "canal de entrega",
    "forma entrega",
    "forma de entrega",
  ],
  nfs: [
    "nf s",
    "nfs",
    "nfs e",
    "nfse",
    "nota fiscal",
    "notas fiscais",
    "nota fiscal servico",
    "nota fiscal de servico",
  ],
  observations: [
    "obs",
    "observacao",
    "observacoes",
    "observacao geral",
    "observacoes gerais",
  ],
};

const HEADER_BY_NAME = new Map<string, FiscalSpreadsheetField>(
  FISCAL_SPREADSHEET_FIELDS.flatMap((field) =>
    HEADER_ALIASES[field].map((alias) => [foldText(alias), field] as const),
  ),
);

function spreadsheetRow(row: readonly unknown[] | undefined): readonly unknown[] {
  return Array.isArray(row) ? row : [];
}

function rowIsBlank(row: readonly unknown[]): boolean {
  return row.every((cell) => cellText(cell) === null);
}

function columnsFromHeader(row: readonly unknown[]): FiscalSpreadsheetColumnMap {
  const columns: FiscalSpreadsheetColumnMap = {};
  row.forEach((cell, columnIndex) => {
    const header = cellText(cell);
    if (!header) return;
    const field = HEADER_BY_NAME.get(foldText(header));
    if (field && columns[field] === undefined) columns[field] = columnIndex;
  });
  return columns;
}

function isViableHeader(columns: FiscalSpreadsheetColumnMap): boolean {
  return (
    columns.companyName !== undefined && Object.keys(columns).length >= 4
  );
}

export type FiscalSpreadsheetSkipReason =
  | "blank"
  | "before_header"
  | "header"
  | "repeated_header"
  | "summary";

export interface FiscalSpreadsheetSkippedRow {
  rowNumber: number;
  rawData: readonly unknown[];
  reason: FiscalSpreadsheetSkipReason;
}

export type FiscalSpreadsheetRejectionReason =
  | "header_not_found"
  | "missing_company_name";

export interface FiscalSpreadsheetRejectedRow {
  rowNumber: number;
  rawData: readonly unknown[];
  reason: FiscalSpreadsheetRejectionReason;
  message: string;
  parsed: ParsedFiscalImportRow | null;
}

export interface FiscalSpreadsheetParsedRow {
  rowNumber: number;
  rawData: readonly unknown[];
  parsed: ParsedFiscalImportRow;
  /** `review` mantém a linha, mas impede importação cega de valor desconhecido. */
  status: "ready" | "review";
}

export interface ParsedFiscalSpreadsheetRows {
  headerRowNumber: number | null;
  columns: FiscalSpreadsheetColumnMap;
  missingColumns: readonly FiscalSpreadsheetField[];
  rows: readonly FiscalSpreadsheetParsedRow[];
  rejectedRows: readonly FiscalSpreadsheetRejectedRow[];
  skippedRows: readonly FiscalSpreadsheetSkippedRow[];
  errors: readonly string[];
}

function valueAt(
  row: readonly unknown[],
  columns: FiscalSpreadsheetColumnMap,
  field: FiscalSpreadsheetField,
): unknown {
  const index = columns[field];
  return index === undefined ? undefined : row[index];
}

function isSummaryRow(
  row: readonly unknown[],
  columns: FiscalSpreadsheetColumnMap,
): boolean {
  const companyName = cellText(valueAt(row, columns, "companyName"));
  if (!companyName || !["total", "totais"].includes(foldText(companyName))) {
    return false;
  }
  return FISCAL_SPREADSHEET_FIELDS.filter((field) => field !== "companyName").every(
    (field) => cellText(valueAt(row, columns, field)) === null,
  );
}

/**
 * Detecta o cabeçalho e prepara todas as linhas de uma planilha fiscal.
 * A numeração é 1-based, igual à exibida no Excel. Linhas de título acima do
 * cabeçalho, vazias e cabeçalhos repetidos são preservados em `skippedRows`;
 * nenhuma linha é vinculada ou criada automaticamente.
 */
export function parseFiscalSpreadsheetRows(
  inputRows: readonly (readonly unknown[])[],
): ParsedFiscalSpreadsheetRows {
  const allRows = inputRows.map((row) => [...spreadsheetRow(row)]);
  let headerIndex = -1;
  let columns: FiscalSpreadsheetColumnMap = {};

  for (let index = 0; index < allRows.length; index += 1) {
    const candidateColumns = columnsFromHeader(allRows[index] ?? []);
    if (isViableHeader(candidateColumns)) {
      headerIndex = index;
      columns = candidateColumns;
      break;
    }
  }

  const rows: FiscalSpreadsheetParsedRow[] = [];
  const rejectedRows: FiscalSpreadsheetRejectedRow[] = [];
  const skippedRows: FiscalSpreadsheetSkippedRow[] = [];

  if (headerIndex < 0) {
    allRows.forEach((rawData, index) => {
      if (rowIsBlank(rawData)) {
        skippedRows.push({ rowNumber: index + 1, rawData, reason: "blank" });
      } else {
        rejectedRows.push({
          rowNumber: index + 1,
          rawData,
          reason: "header_not_found",
          message:
            "Não foi possível localizar o cabeçalho da planilha fiscal.",
          parsed: null,
        });
      }
    });
    return {
      headerRowNumber: null,
      columns: {},
      missingColumns: [...FISCAL_SPREADSHEET_FIELDS],
      rows,
      rejectedRows,
      skippedRows,
      errors: [
        "Cabeçalho não encontrado. Informe pelo menos EMPRESAS e três colunas do controle fiscal.",
      ],
    };
  }

  for (let index = 0; index < headerIndex; index += 1) {
    const rawData = allRows[index] ?? [];
    skippedRows.push({
      rowNumber: index + 1,
      rawData,
      reason: rowIsBlank(rawData) ? "blank" : "before_header",
    });
  }
  skippedRows.push({
    rowNumber: headerIndex + 1,
    rawData: allRows[headerIndex] ?? [],
    reason: "header",
  });

  for (let index = headerIndex + 1; index < allRows.length; index += 1) {
    const rawData = allRows[index] ?? [];
    const rowNumber = index + 1;
    if (rowIsBlank(rawData)) {
      skippedRows.push({ rowNumber, rawData, reason: "blank" });
      continue;
    }
    if (isViableHeader(columnsFromHeader(rawData))) {
      skippedRows.push({ rowNumber, rawData, reason: "repeated_header" });
      continue;
    }
    if (isSummaryRow(rawData, columns)) {
      skippedRows.push({ rowNumber, rawData, reason: "summary" });
      continue;
    }

    const parsed = parseFiscalImportRow({
      companyName: valueAt(rawData, columns, "companyName"),
      movements: valueAt(rawData, columns, "movements"),
      incoming: valueAt(rawData, columns, "incoming"),
      outgoing: valueAt(rawData, columns, "outgoing"),
      guide: valueAt(rawData, columns, "guide"),
      delivery: valueAt(rawData, columns, "delivery"),
      nfs: valueAt(rawData, columns, "nfs"),
      observations: valueAt(rawData, columns, "observations"),
    });
    if (!parsed.companyName) {
      rejectedRows.push({
        rowNumber,
        rawData,
        reason: "missing_company_name",
        message: "A linha tem dados, mas não informa a empresa.",
        parsed,
      });
      continue;
    }
    rows.push({
      rowNumber,
      rawData,
      parsed,
      status: parsed.issues.length > 0 ? "review" : "ready",
    });
  }

  const missingColumns = FISCAL_SPREADSHEET_FIELDS.filter(
    (field) => columns[field] === undefined,
  );
  return {
    headerRowNumber: headerIndex + 1,
    columns,
    missingColumns,
    rows,
    rejectedRows,
    skippedRows,
    errors: [],
  };
}

/** Regras puras usadas antes da mutação transacional do lote. */
export function hasDuplicateFiscalImportTargets(
  clientIds: readonly string[],
): boolean {
  return new Set(clientIds).size !== clientIds.length;
}

export function fiscalImportSourceRowTotal(
  parsedRows: number,
  rejectedRows: number,
): number {
  return parsedRows + rejectedRows;
}
