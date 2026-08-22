/**
 * Roteamento de uma ação de informativo para o seu destino.
 *
 * O mapeamento setor→destino é determinístico no servidor: a IA devolve o
 * setor como texto e as regras configuradas pela organização decidem. Uma
 * regra pode apontar para a fila do clã ou para uma pessoa daquele clã.
 */

export interface RoutingClan {
  id: string;
  name: string;
  slug: string;
}

/** Regra carregada da configuração da organização, nunca escolhida pela IA. */
export interface InformativeRoutingRule {
  sector: string;
  normalizedSector: string;
  clanId: string;
  userId: string | null;
  userName: string | null;
}

/** Nome citado no `Att.`, já confrontado com o diretório de membros. */
export interface AssigneeSuggestion {
  rawName: string;
  userId: string | null;
  name: string | null;
}

export interface RecognizedAssignee extends AssigneeSuggestion {
  userId: string;
  name: string;
}

export type InformativeRoute =
  | { outcome: "clan"; clan: RoutingClan }
  | {
      outcome: "individual";
      assignees: readonly RecognizedAssignee[];
      /** Presente quando a própria regra fixou também o contexto do clã. */
      clan?: RoutingClan;
    }
  | { outcome: "pending"; reason: string };

export interface RouteInformativeTaskInput {
  /** Setor como veio no informativo ("CONTABIL", "RH — PRÓ-LABORE", …). */
  sector: string | null;
  suggestions: readonly AssigneeSuggestion[];
  /** Somente clãs ATIVOS da organização da sessão. */
  clans: readonly RoutingClan[];
  /** Regras da organização. Lista vazia significa que nada foi configurado. */
  rules?: readonly InformativeRoutingRule[];
}

/**
 * Configuração inicial das organizações antigas e do bootstrap. O pipeline de
 * Informativos não consulta esta constante: ele recebe as regras do banco.
 */
export const SECTOR_CLAN_SYNONYMS: Readonly<Record<string, string>> = {
  // Fiscal
  fiscal: "fiscal",
  fiscais: "fiscal",
  informativo: "fiscal",
  informativos: "fiscal",
  impostos: "fiscal",
  tributario: "fiscal",
  "obrigacoes acessorias": "fiscal",
  // Contabilidade
  contabil: "contabilidade",
  contabeis: "contabilidade",
  contabilidade: "contabilidade",
  contabilizacao: "contabilidade",
  escrituracao: "contabilidade",
  balanco: "contabilidade",
  balancete: "contabilidade",
  // RH
  rh: "rh",
  "recursos humanos": "rh",
  "pro labore": "rh",
  prolabore: "rh",
  folha: "rh",
  "folha de pagamento": "rh",
  "departamento pessoal": "rh",
  dp: "rh",
  trabalhista: "rh",
  admissao: "rh",
  rescisao: "rh",
  ferias: "rh",
  // Societário
  societario: "societario",
  legalizacao: "societario",
  abertura: "societario",
  alteracao: "societario",
  baixa: "societario",
  "contrato social": "societario",
  junta: "societario",
  // Financeiro
  financeiro: "financeiro",
  cobranca: "financeiro",
  cobrancas: "financeiro",
  honorario: "financeiro",
  honorarios: "financeiro",
  "contas a receber": "financeiro",
  "contas a pagar": "financeiro",
  // Sucesso do Cliente
  "sucesso do cliente": "sucesso-do-cliente",
  "fiscal emissao de notas informativos": "sucesso-do-cliente",
  "fiscal emissao de notas": "sucesso-do-cliente",
  "fiscal emissao de nota": "sucesso-do-cliente",
  "fiscal emissao de nfe": "sucesso-do-cliente",
  "emissao de notas": "sucesso-do-cliente",
  "emissao de nota": "sucesso-do-cliente",
  "emissao de nfe": "sucesso-do-cliente",
  "nota fiscal": "sucesso-do-cliente",
  "notas fiscais": "sucesso-do-cliente",
  notas: "sucesso-do-cliente",
  arquivo: "sucesso-do-cliente",
  arquivos: "sucesso-do-cliente",
  "certificado digital": "sucesso-do-cliente",
  "certificados digitais": "sucesso-do-cliente",
  automacao: "sucesso-do-cliente",
  automacoes: "sucesso-do-cliente",
};

/** Minúsculas, sem acento e sem pontuação — a chave da tabela de sinônimos. */
export function normalizeSectorText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Remove a decoração que o informativo do WhatsApp costuma trazer:
 * numeração ("1.1 –"), negrito com asterisco e travessões soltos nas pontas.
 */
export function stripSectorDecorations(value: string): string {
  return value
    .replace(/\*/g, "")
    .replace(/^\s*\d+(?:\.\d+)*\s*[-–—:]?\s*/, "")
    .replace(/^[\s\-–—:/|]+/, "")
    .replace(/[\s\-–—:/|]+$/, "")
    .trim();
}

/**
 * Resolve o clã de um setor. Quando `rules` é informado, somente a
 * configuração da organização é considerada. Segmentos do mesmo rótulo composto
 * ("FISCAL / EMISSÃO DE NOTAS / INFORMATIVOS") precisam concordar; se
 * apontarem para clãs diferentes o retorno é null e a decisão volta para o
 * humano — nunca adivinhar.
 */
export function resolveSectorClan(
  sector: string | null | undefined,
  clans: readonly RoutingClan[],
  rules?: readonly InformativeRoutingRule[],
): RoutingClan | null {
  if (!sector) return null;
  const cleaned = stripSectorDecorations(sector);
  if (!cleaned) return null;

  const byId = new Map(clans.map((clan) => [clan.id, clan]));
  const configuredBySector = rules
    ? new Map(rules.map((rule) => [rule.normalizedSector, rule]))
    : null;
  const bySlug = new Map(clans.map((clan) => [clan.slug, clan]));
  const byName = new Map(clans.map((clan) => [normalizeSectorText(clan.name), clan]));

  const matchSegment = (segment: string): RoutingClan | null => {
    const normalized = normalizeSectorText(segment);
    if (!normalized) return null;
    if (configuredBySector) {
      const rule = configuredBySector.get(normalized);
      return rule ? byId.get(rule.clanId) ?? null : null;
    }
    const byExactName = byName.get(normalized);
    if (byExactName) return byExactName;
    const slug = SECTOR_CLAN_SYNONYMS[normalized];
    return slug ? bySlug.get(slug) ?? null : null;
  };

  const whole = matchSegment(cleaned);
  if (whole) return whole;

  const matches: RoutingClan[] = [];
  for (const segment of cleaned.split(/[/|,;]|\s[-–—]\s|[-–—]/)) {
    const match = matchSegment(segment);
    if (match && !matches.some((found) => found.id === match.id)) {
      matches.push(match);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/** Resolve a regra completa para distinguir fila do clã de destino pessoal. */
export function resolveInformativeRoutingRule(
  sector: string | null | undefined,
  rules: readonly InformativeRoutingRule[],
): InformativeRoutingRule | null {
  if (!sector) return null;
  const cleaned = stripSectorDecorations(sector);
  if (!cleaned) return null;
  const bySector = new Map(rules.map((rule) => [rule.normalizedSector, rule]));

  const matchConfiguredSegment = (value: string): InformativeRoutingRule | null => {
    const normalized = normalizeSectorText(value);
    const exact = bySector.get(normalized);
    if (exact) return exact;

    // Permite que uma regra estável como "Automação" reconheça variações do
    // informativo como "AUTOMAÇÃO FABI – ONVIO" sem cadastrar cada ferramenta
    // ou colaborador no código. A maior chave ganha para evitar generalizações.
    return rules
      .filter((rule) => normalized.startsWith(`${rule.normalizedSector} `))
      .sort((left, right) => right.normalizedSector.length - left.normalizedSector.length)[0] ?? null;
  };

  const whole = bySector.get(normalizeSectorText(cleaned));
  if (whole) return whole;

  const matches: InformativeRoutingRule[] = [];
  for (const segment of cleaned.split(/[/|,;]|\s[-–—]\s|[-–—]/)) {
    const match = matchConfiguredSegment(segment);
    if (match && !matches.some((found) => found.clanId === match.clanId && found.userId === match.userId)) {
      matches.push(match);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * A tabela de regras, na ordem:
 *   1. setor casa com regra ativa  → fila do clã ou pessoa configurada;
 *   2. sem clã mas `Att.` casa     → missão individual da(s) pessoa(s);
 *   3. sem clã e sem nome          → pendente de decisão humana.
 */
export function routeInformativeTask(
  input: RouteInformativeTaskInput,
): InformativeRoute {
  if (input.rules) {
    const configured = resolveInformativeRoutingRule(input.sector, input.rules);
    if (configured) {
      const clan = input.clans.find((candidate) => candidate.id === configured.clanId);
      if (clan && configured.userId && configured.userName) {
        return {
          outcome: "individual",
          clan,
          assignees: [{
            rawName: configured.userName,
            userId: configured.userId,
            name: configured.userName,
          }],
        };
      }
      if (clan) return { outcome: "clan", clan };
    }
  } else {
    const clan = resolveSectorClan(input.sector, input.clans);
    if (clan) return { outcome: "clan", clan };
  }

  const recognized: RecognizedAssignee[] = [];
  for (const suggestion of input.suggestions) {
    if (!suggestion.userId || !suggestion.name) continue;
    if (recognized.some((found) => found.userId === suggestion.userId)) continue;
    recognized.push({
      rawName: suggestion.rawName,
      userId: suggestion.userId,
      name: suggestion.name,
    });
  }
  if (recognized.length > 0) {
    return { outcome: "individual", assignees: recognized };
  }

  const unknownNames = input.suggestions.map((suggestion) => suggestion.rawName);
  if (unknownNames.length > 0) {
    return {
      outcome: "pending",
      reason: `Setor sem clã e nome não reconhecido: ${unknownNames.join(", ")}.`,
    };
  }
  return {
    outcome: "pending",
    reason: "Sem setor de clã e sem pessoa indicada. Escolha o destino.",
  };
}
