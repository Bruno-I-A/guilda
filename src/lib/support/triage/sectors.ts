import type { SetorValido } from "./classificacao";

/**
 * O prompt do Scharff classifica nos setores do escritório (fiscal, contábil,
 * DP...). Na Guilda, quem atende é o clã: aqui se acha o clã de cada setor
 * pelo nome, sem cadastro novo. "outro", ou setor sem clã correspondente,
 * fica sem clã e a conversa segue para quem distribui.
 */
const SECTOR_PATTERNS: Record<Exclude<SetorValido, "outro">, RegExp> = {
  fiscal: /fiscal/,
  contabil: /contab/,
  "trabalhista/dp": /\b(dp|rh)\b|pessoal|trabalh|folha/,
  societario: /societ|legaliza/,
  financeiro: /financ/,
};

export const SECTOR_LABELS: Record<SetorValido, string> = {
  fiscal: "Fiscal",
  contabil: "Contábil",
  "trabalhista/dp": "Departamento pessoal",
  societario: "Societário",
  financeiro: "Financeiro do escritório",
  outro: "Sem setor claro",
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function clanForSector<T extends { id: string; name: string; slug: string }>(sector: SetorValido, clans: readonly T[]): T | null {
  if (sector === "outro") return null;
  const pattern = SECTOR_PATTERNS[sector];
  const matches = clans.filter((clan) => pattern.test(normalize(`${clan.name} ${clan.slug.replace(/-/g, " ")}`)));
  // Dois clãs casando com o mesmo setor é ambíguo: melhor não sugerir do que errar.
  return matches.length === 1 ? matches[0] : null;
}
