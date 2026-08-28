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

const CNPJ_HEADERS = new Set([
  "cnpj",
  "cpf/cnpj",
  "cpf ou cnpj",
  "cnpj/cpf/cei",
  "documento",
]);
const EMAIL_HEADERS = new Set(["email", "e-mail", "email do cliente"]);
const PHONE_HEADERS = new Set([
  "celular",
  "telefone",
  "fone",
  "whatsapp",
  "telefone/celular",
]);

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export interface ClientReplacementRow {
  rowNumber: number;
  spreadsheetName: string;
  operationalEmail: string | null;
  operationalPhone: string | null;
  cnpj: string;
}

export function parseClientReplacementRows(
  rows: ClientImportCellValue[][],
): { rows: ClientReplacementRow[]; rejected: ClientImportRejectedRow[] } {
  let headerIndex = -1;
  let nameIndex = -1;
  let cnpjIndex = -1;
  let emailIndex = -1;
  let phoneIndex = -1;

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const normalized = rows[i].map((cell) => normalizeHeader(cellText(cell)));
    const candidateName = normalized.findIndex((value) => NAME_HEADERS.has(value));
    const candidateCnpj = normalized.findIndex((value) => CNPJ_HEADERS.has(value));
    if (candidateName === -1 || candidateCnpj === -1) continue;
    headerIndex = i;
    nameIndex = candidateName;
    cnpjIndex = candidateCnpj;
    emailIndex = normalized.findIndex((value) => EMAIL_HEADERS.has(value));
    phoneIndex = normalized.findIndex((value) => PHONE_HEADERS.has(value));
    break;
  }

  if (headerIndex === -1) {
    return {
      rows: [],
      rejected: [{ rowNumber: 1, error: "não encontrei as colunas de Nome/Razão Social e CNPJ" }],
    };
  }

  const parsed: ClientReplacementRow[] = [];
  const rejected: ClientImportRejectedRow[] = [];
  const seen = new Set<string>();
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;
    const spreadsheetName = cellText(row[nameIndex]);
    const cnpj = normalizeCnpj(cellText(row[cnpjIndex]));
    if (spreadsheetName.length < 2 || spreadsheetName.length > 200) {
      rejected.push({ rowNumber: i + 1, error: "razão social inválida" });
      continue;
    }
    if (!validateCnpj(cnpj)) {
      rejected.push({ rowNumber: i + 1, error: "CNPJ inválido" });
      continue;
    }
    if (seen.has(cnpj)) {
      rejected.push({ rowNumber: i + 1, error: "CNPJ repetido na planilha" });
      continue;
    }
    seen.add(cnpj);
    const operationalEmail = emailIndex === -1 ? null : cellText(row[emailIndex]) || null;
    const operationalPhone = phoneIndex === -1
      ? null
      : cellText(row[phoneIndex]).replace(/\D/g, "") || null;
    if (operationalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operationalEmail)) {
      rejected.push({ rowNumber: i + 1, error: "e-mail inválido" });
      continue;
    }
    if (operationalPhone && !/^\d{10,11}$/.test(operationalPhone)) {
      rejected.push({ rowNumber: i + 1, error: "celular deve ter 10 ou 11 dígitos" });
      continue;
    }
    parsed.push({ rowNumber: i + 1, spreadsheetName, operationalEmail, operationalPhone, cnpj });
  }
  return { rows: parsed, rejected };
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
