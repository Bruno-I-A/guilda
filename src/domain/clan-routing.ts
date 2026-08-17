/**
 * Roteamento de uma ação de informativo para o seu destino.
 *
 * O mapeamento setor→clã é DETERMINÍSTICO NO SERVIDOR: a IA devolve o setor
 * como texto e esta função pura decide. Clã ganha da pessoa — quando o setor
 * casa com um clã ativo, a missão nasce do clã, sem responsável, e o `Att.`
 * vira sugestão para o líder distribuir.
 */

export interface RoutingClan {
  id: string;
  name: string;
  slug: string;
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
  | { outcome: "individual"; assignees: readonly RecognizedAssignee[] }
  | { outcome: "pending"; reason: string };

export interface RouteInformativeTaskInput {
  /** Setor como veio no informativo ("CONTABIL", "RH — PRÓ-LABORE", …). */
  sector: string | null;
  suggestions: readonly AssigneeSuggestion[];
  /** Somente clãs ATIVOS da organização da sessão. */
  clans: readonly RoutingClan[];
}

/**
 * Sinônimos de setor por slug de clã. Os cinco clãs são fixos (Fiscal,
 * Contabilidade, RH, Societário, Financeiro); setores fora desta tabela —
 * Certificado Digital, Automação, Servidor, Arquivo, Administrativo —
 * NÃO viram clã: exigem nome na linha.
 */
export const SECTOR_CLAN_SYNONYMS: Readonly<Record<string, string>> = {
  // Fiscal
  fiscal: "fiscal",
  fiscais: "fiscal",
  "emissao de notas": "fiscal",
  "emissao de nota": "fiscal",
  "emissao de nfe": "fiscal",
  "nota fiscal": "fiscal",
  "notas fiscais": "fiscal",
  notas: "fiscal",
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
 * Resolve o clã de um setor. Segmentos do mesmo rótulo composto
 * ("FISCAL / EMISSÃO DE NOTAS / INFORMATIVOS") precisam concordar; se
 * apontarem para clãs diferentes o retorno é null e a decisão volta para o
 * humano — nunca adivinhar.
 */
export function resolveSectorClan(
  sector: string | null | undefined,
  clans: readonly RoutingClan[],
): RoutingClan | null {
  if (!sector) return null;
  const cleaned = stripSectorDecorations(sector);
  if (!cleaned) return null;

  const bySlug = new Map(clans.map((clan) => [clan.slug, clan]));
  const byName = new Map(
    clans.map((clan) => [normalizeSectorText(clan.name), clan]),
  );

  const matchSegment = (segment: string): RoutingClan | null => {
    const normalized = normalizeSectorText(segment);
    if (!normalized) return null;
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

/**
 * A tabela de três regras da spec, na ordem:
 *   1. setor casa com clã ativo    → missão do clã, sem responsável;
 *   2. sem clã mas `Att.` casa     → missão individual da(s) pessoa(s);
 *   3. sem clã e sem nome          → pendente de decisão humana.
 */
export function routeInformativeTask(
  input: RouteInformativeTaskInput,
): InformativeRoute {
  const clan = resolveSectorClan(input.sector, input.clans);
  if (clan) return { outcome: "clan", clan };

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
