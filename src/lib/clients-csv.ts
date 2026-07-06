import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import type { TaxRegime } from "@/lib/clients-ui";

/**
 * Parser puro do CSV de empresas-cliente (`nome;cnpj;regime`).
 * Usado pelo script `npm run import:clients`; testado em Vitest.
 */

export interface ClientCsvRow {
  name: string;
  cnpj?: string;
  taxRegime: TaxRegime;
}

export type ClientCsvLineResult =
  | { kind: "row"; row: ClientCsvRow }
  | { kind: "skip" } // linha vazia ou cabeçalho
  | { kind: "error"; error: string };

/** Aceita a chave do enum ou o rótulo humano (com/sem acento, qualquer caixa). */
const REGIME_ALIASES: Record<string, TaxRegime> = {
  simples: "simples",
  "simples nacional": "simples",
  presumido: "presumido",
  "lucro presumido": "presumido",
  real: "real",
  "lucro real": "real",
};

function normalizeRegime(value: string): TaxRegime | undefined {
  const key = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return REGIME_ALIASES[key];
}

export function parseClientCsvLine(line: string): ClientCsvLineResult {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "skip" };

  const [rawName = "", rawCnpj = "", rawRegime = ""] = trimmed
    .split(";")
    .map((part) => part.trim());

  // Cabeçalho opcional na primeira linha
  if (rawName.toLowerCase() === "nome" && rawRegime.toLowerCase() === "regime") {
    return { kind: "skip" };
  }

  if (rawName.length < 2 || rawName.length > 200) {
    return { kind: "error", error: "nome deve ter entre 2 e 200 caracteres" };
  }

  const taxRegime = normalizeRegime(rawRegime);
  if (!taxRegime) {
    return {
      kind: "error",
      error: `regime desconhecido "${rawRegime}" (use simples, presumido ou real)`,
    };
  }

  let cnpj: string | undefined;
  if (rawCnpj) {
    cnpj = normalizeCnpj(rawCnpj);
    if (!validateCnpj(cnpj)) {
      return { kind: "error", error: `CNPJ inválido "${rawCnpj}"` };
    }
  }

  return { kind: "row", row: { name: rawName, cnpj, taxRegime } };
}
