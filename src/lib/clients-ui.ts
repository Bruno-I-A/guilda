import type { Client } from "@/db/schema";

/** Rótulos e estilos de apresentação das empresas-cliente (pt-BR). */

export type TaxRegime = Client["taxRegime"];

export const TAX_REGIMES = [
  "simples",
  "presumido",
  "association",
  "real",
] as const;

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  association: "Associação",
  real: "Lucro Real",
};

/** Badge por regime (paleta do tema; ouro segue exclusivo de recompensa). */
export const TAX_REGIME_BADGE_CLASSES: Record<TaxRegime, string> = {
  simples: "bg-secondary text-silver border-transparent",
  presumido: "bg-primary/15 text-primary border-transparent",
  association: "bg-primary/15 text-primary border-transparent",
  real: "bg-amber-400/10 text-amber-300 border-transparent",
};
