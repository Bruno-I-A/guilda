import type { Client } from "@/db/schema";

/** Rótulos e estilos de apresentação das empresas-cliente (pt-BR). */

export type TaxRegime = Client["taxRegime"];

export const TAX_REGIMES = [
  "mei",
  "simples",
  "presumido",
  "association",
  "real",
] as const;

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  association: "Associação",
  real: "Lucro Real",
};

/**
 * Badge por regime (paleta do tema; ouro segue exclusivo de recompensa).
 *
 * "Lucro Real" usava `amber-400/amber-300` crus do Tailwind — um âmbar que
 * lia como ouro, e regime tributário não é prêmio. Agora usa `warning`, que
 * é cobre SATURADO justamente para não se confundir com o ouro fosco do XP.
 */
export const TAX_REGIME_BADGE_CLASSES: Record<TaxRegime, string> = {
  mei: "bg-secondary text-silver border-transparent",
  simples: "bg-secondary text-silver border-transparent",
  presumido: "bg-primary/15 text-primary border-transparent",
  association: "bg-primary/15 text-primary border-transparent",
  real: "bg-warning/10 text-warning border-transparent",
};
