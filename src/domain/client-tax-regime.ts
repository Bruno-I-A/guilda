import type { TaxRegime } from "@/lib/clients-ui";

interface CnpjTaxRegimeFacts {
  isMeiOptant: boolean | null;
  isSimplesOptant: boolean | null;
  legalNature: string | null;
  taxRegimes: { year: number | null; form: string }[];
}

function folded(value: string | null | undefined): string {
  return value
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase() ?? "";
}

/** Traduz o retrato público do CNPJ para o enum usado pela operação. */
export function inferTaxRegimeFromCnpj(
  lookup: CnpjTaxRegimeFacts,
): TaxRegime | null {
  if (lookup.isMeiOptant) return "mei";
  if (lookup.isSimplesOptant) return "simples";

  const latest = [...lookup.taxRegimes]
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0]?.form;
  const latestFolded = folded(latest);
  if (latestFolded.includes("PRESUMIDO")) return "presumido";
  if (latestFolded.includes("REAL")) return "real";
  return folded(lookup.legalNature).includes("ASSOCIACAO PRIVADA")
    ? "association"
    : null;
}
