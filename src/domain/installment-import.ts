import { normalizeCompanyName } from "./fiscal-import";

export interface ParsedInstallmentImportRow {
  companyName: string;
  normalizedCompanyName: ReturnType<typeof normalizeCompanyName>;
  installmentType: string;
  notes: string | null;
  deliveryMethod: string | null;
  installmentNumber: string | null;
}

export interface InstallmentProgress {
  paidInstallments: number;
  totalInstallments: number | null;
}

/** Interpreta "10/13" como pagas/total; "13" significa total ainda não pago. */
export function parseInstallmentProgress(value: string | null): InstallmentProgress {
  if (!value) return { paidInstallments: 0, totalInstallments: null };
  const fraction = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const paid = Number(fraction[1]);
    const total = Number(fraction[2]);
    if (Number.isInteger(total) && total >= 1) {
      return {
        paidInstallments: Math.min(Math.max(paid, 0), total),
        totalInstallments: total,
      };
    }
  }
  const total = Number(value.trim());
  return Number.isInteger(total) && total >= 1
    ? { paidInstallments: 0, totalInstallments: total }
    : { paidInstallments: 0, totalInstallments: null };
}

export interface InstallmentSpreadsheetRow {
  rowNumber: number;
  parsed: ParsedInstallmentImportRow;
}

export interface ParsedInstallmentSpreadsheet {
  headerRowNumber: number | null;
  rows: readonly InstallmentSpreadsheetRow[];
  rejectedRows: readonly { rowNumber: number; message: string }[];
  skippedRows: number;
  errors: readonly string[];
}

type Field =
  | "companyName"
  | "installmentType"
  | "notes"
  | "deliveryMethod"
  | "installmentNumber";

type ColumnMap = Partial<Record<Field, number>>;

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = value instanceof Date ? value.toLocaleDateString("pt-BR") : String(value);
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  return normalized || null;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[º°ª]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HEADERS = new Map<string, Field>(
  [
    ["empresa", "companyName"],
    ["empresas", "companyName"],
    ["razao social", "companyName"],
    ["cliente", "companyName"],
    ["tipo de parcelamento", "installmentType"],
    ["tipo parcelamento", "installmentType"],
    ["parcelamento", "installmentType"],
    ["caminho obs", "notes"],
    ["caminho observacao", "notes"],
    ["caminho observacoes", "notes"],
    ["observacao", "notes"],
    ["observacoes", "notes"],
    ["obs", "notes"],
    ["entregar para", "deliveryMethod"],
    ["forma de entrega", "deliveryMethod"],
    ["entrega", "deliveryMethod"],
    ["meio de entrega", "deliveryMethod"],
    ["n de parcelas", "installmentNumber"],
    ["numero de parcelas", "installmentNumber"],
    ["parcelas", "installmentNumber"],
  ].map(([header, field]) => [header, field as Field]),
);

function columnsFromHeader(row: readonly unknown[]): ColumnMap {
  const columns: ColumnMap = {};
  row.forEach((cell, index) => {
    const value = cellText(cell);
    if (!value) return;
    const field = HEADERS.get(fold(value));
    if (field && columns[field] === undefined) columns[field] = index;
  });
  return columns;
}

function isHeader(columns: ColumnMap): boolean {
  return columns.companyName !== undefined && columns.installmentType !== undefined;
}

function at(row: readonly unknown[], columns: ColumnMap, field: Field): string | null {
  const index = columns[field];
  return index === undefined ? null : cellText(row[index]);
}

/** Lê a tabela simples de parcelamentos e preserva cada linha separadamente. */
export function parseInstallmentSpreadsheetRows(
  input: readonly (readonly unknown[])[],
): ParsedInstallmentSpreadsheet {
  const rows = input.map((row) => (Array.isArray(row) ? row : []));
  let headerIndex = -1;
  let columns: ColumnMap = {};

  for (let index = 0; index < rows.length; index += 1) {
    const candidate = columnsFromHeader(rows[index] ?? []);
    if (isHeader(candidate)) {
      headerIndex = index;
      columns = candidate;
      break;
    }
  }

  if (headerIndex < 0) {
    return {
      headerRowNumber: null,
      rows: [],
      rejectedRows: [],
      skippedRows: rows.length,
      errors: [
        "Cabeçalho não encontrado. A planilha precisa ter as colunas Empresa e Tipo de parcelamento.",
      ],
    };
  }

  const parsedRows: InstallmentSpreadsheetRow[] = [];
  const rejectedRows: { rowNumber: number; message: string }[] = [];
  let skippedRows = headerIndex + 1;

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((cell) => cellText(cell) === null)) {
      skippedRows += 1;
      continue;
    }
    if (isHeader(columnsFromHeader(row))) {
      skippedRows += 1;
      continue;
    }
    const companyName = at(row, columns, "companyName");
    const installmentType = at(row, columns, "installmentType");
    const hasOtherData = (["notes", "deliveryMethod", "installmentNumber"] as const)
      .some((field) => at(row, columns, field) !== null);

    // Títulos ou lembretes mesclados costumam ocupar só a primeira célula.
    if (companyName && !installmentType && !hasOtherData) {
      skippedRows += 1;
      continue;
    }
    if (!companyName || !installmentType) {
      rejectedRows.push({
        rowNumber: index + 1,
        message: !companyName
          ? "Empresa não informada."
          : "Tipo de parcelamento não informado.",
      });
      continue;
    }

    parsedRows.push({
      rowNumber: index + 1,
      parsed: {
        companyName,
        normalizedCompanyName: normalizeCompanyName(companyName),
        installmentType,
        notes: at(row, columns, "notes"),
        deliveryMethod: at(row, columns, "deliveryMethod"),
        installmentNumber: at(row, columns, "installmentNumber"),
      },
    });
  }

  return {
    headerRowNumber: headerIndex + 1,
    rows: parsedRows,
    rejectedRows,
    skippedRows,
    errors: [],
  };
}
