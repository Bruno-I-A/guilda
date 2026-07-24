import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import type { TaxRegime } from "@/lib/clients-ui";

export interface ClientImportRow {
  name: string;
  cnpj?: string;
  taxRegime: TaxRegime;
}

export interface ClientImportRejectedRow {
  rowNumber: number;
  error: string;
}

export interface ParsedClientImport {
  rows: ClientImportRow[];
  rejected: ClientImportRejectedRow[];
  skipped: number;
}

export type ClientImportCellValue =
  | string
  | number
  | boolean
  | Date
  | DateConstructor
  | null
  | undefined;

const NAME_HEADERS = new Set([
  "cliente",
  "empresa",
  "nome",
  "nome da empresa",
  "razao social",
  "razao",
  "fantasia",
]);

const CNPJ_HEADERS = new Set(["cnpj", "cpf/cnpj", "documento"]);

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function cellText(value: ClientImportCellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date || value === Date) return "";
  return String(value).trim();
}

function isEmptyRow(row: ClientImportCellValue[]): boolean {
  return row.every((cell) => !cellText(cell));
}

function detectColumns(rows: ClientImportCellValue[][]): {
  headerIndex: number | null;
  nameIndex: number;
  cnpjIndex: number | null;
} {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const normalized = rows[i].map((cell) => normalizeHeader(cellText(cell)));
    const nameIndex = normalized.findIndex((value) => NAME_HEADERS.has(value));
    if (nameIndex === -1) continue;
    const cnpjIndex = normalized.findIndex((value) => CNPJ_HEADERS.has(value));
    return { headerIndex: i, nameIndex, cnpjIndex: cnpjIndex === -1 ? null : cnpjIndex };
  }

  return { headerIndex: null, nameIndex: 0, cnpjIndex: 1 };
}

export function parseClientImportRows(
  rows: ClientImportCellValue[][],
  taxRegime: TaxRegime,
): ParsedClientImport {
  const columns = detectColumns(rows);
  const parsed: ClientImportRow[] = [];
  const rejected: ClientImportRejectedRow[] = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    if (columns.headerIndex === i) {
      skipped++;
      continue;
    }

    const row = rows[i];
    if (isEmptyRow(row)) {
      skipped++;
      continue;
    }

    const name = cellText(row[columns.nameIndex]);
    const rawCnpj = columns.cnpjIndex === null ? "" : cellText(row[columns.cnpjIndex]);

    if (name.length < 2 || name.length > 200) {
      rejected.push({
        rowNumber: i + 1,
        error: "nome deve ter entre 2 e 200 caracteres",
      });
      continue;
    }

    let cnpj: string | undefined;
    if (rawCnpj) {
      cnpj = normalizeCnpj(rawCnpj);
      if (!validateCnpj(cnpj)) {
        rejected.push({
          rowNumber: i + 1,
          error: `CNPJ inválido "${rawCnpj}"`,
        });
        continue;
      }
    }

    parsed.push({ name, cnpj, taxRegime });
  }

  return { rows: parsed, rejected, skipped };
}
