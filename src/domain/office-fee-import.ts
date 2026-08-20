import { normalizeCnpj, validateCnpj } from "./cnpj";
import { normalizeCompanyName } from "./fiscal-import";
import type { OfficeFeeBillingMethod } from "./office-fee-control";

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
    return text || null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function multilineText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const source = typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
  if (!source) return null;
  const text = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter(Boolean)
    .join("\n");
  return text || null;
}

export interface OfficeFeeImportIssue {
  field: "companyName" | "cnpj" | "billingMethod" | "additionalInstallment" | "monthlyFee";
  raw: string | null;
  message: string;
}

export interface ParsedOfficeFeeImportRow {
  companyName: string | null;
  normalizedCompanyName: ReturnType<typeof normalizeCompanyName>;
  cnpj: string | null;
  billingMethod: OfficeFeeBillingMethod | null;
  chargesAdditionalInstallment: boolean | null;
  monthlyFee: string | null;
  observations: string | null;
  issues: readonly OfficeFeeImportIssue[];
}

function parseBillingMethod(input: unknown): {
  value: OfficeFeeBillingMethod | null;
  raw: string | null;
} {
  const raw = cellText(input);
  if (!raw) return { value: null, raw };
  const normalized = fold(raw).replace(/\s/g, "");
  if (normalized === "asaas") return { value: "asaas", raw };
  if (["recibo", "recibos"].includes(normalized)) return { value: "recibo", raw };
  if (normalized === "pix") return { value: "pix", raw };
  return { value: "other", raw };
}

function parseAdditionalInstallment(input: unknown): {
  value: boolean | null;
  raw: string | null;
} {
  const raw = cellText(input);
  if (!raw) return { value: null, raw };
  const normalized = fold(raw).replace(/\s/g, "");
  if (["sim", "s", "yes", "true", "1"].includes(normalized)) return { value: true, raw };
  if (["nao", "n", "no", "false", "0"].includes(normalized)) return { value: false, raw };
  return { value: null, raw };
}

function parseMonthlyFee(input: unknown): { value: string | null; raw: string | null } {
  const raw = cellText(input);
  if (!raw) return { value: null, raw };
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) {
    return { value: input.toFixed(2), raw };
  }
  const compact = raw.replace(/R\$/gi, "").replace(/\s/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return { value: null, raw };
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return { value: null, raw };
  return { value: numeric.toFixed(2), raw };
}

export function parseOfficeFeeImportRow(
  row: {
    companyName?: unknown;
    cnpj?: unknown;
    billingMethod?: unknown;
    additionalInstallment?: unknown;
    monthlyFee?: unknown;
    observations?: unknown;
  },
): ParsedOfficeFeeImportRow {
  const companyName = cellText(row.companyName);
  const cnpjRaw = cellText(row.cnpj);
  const normalizedCnpj = cnpjRaw ? normalizeCnpj(cnpjRaw) : "";
  const cnpj = normalizedCnpj && validateCnpj(normalizedCnpj) ? normalizedCnpj : null;
  const billingMethod = parseBillingMethod(row.billingMethod);
  const additionalInstallment = parseAdditionalInstallment(row.additionalInstallment);
  const monthlyFee = parseMonthlyFee(row.monthlyFee);
  const issues: OfficeFeeImportIssue[] = [];

  if (!companyName) {
    issues.push({ field: "companyName", raw: null, message: "A linha não informa o nome da empresa." });
  }
  if (cnpjRaw && !cnpj) {
    issues.push({ field: "cnpj", raw: cnpjRaw, message: "CNPJ inválido; ele não será usado para conciliar." });
  }
  if (!billingMethod.value) {
    issues.push({ field: "billingMethod", raw: billingMethod.raw, message: "Informe a forma de cobrança." });
  }
  if (additionalInstallment.value === null) {
    issues.push({ field: "additionalInstallment", raw: additionalInstallment.raw, message: "Informe SIM ou NÃO para a parcela adicional." });
  }
  if (!monthlyFee.value) {
    issues.push({ field: "monthlyFee", raw: monthlyFee.raw, message: "Informe um valor mensal válido." });
  }

  return {
    companyName,
    normalizedCompanyName: normalizeCompanyName(companyName ?? ""),
    cnpj,
    billingMethod: billingMethod.value,
    chargesAdditionalInstallment: additionalInstallment.value,
    monthlyFee: monthlyFee.value,
    observations: multilineText(row.observations),
    issues,
  };
}

const FIELDS = [
  "companyName",
  "cnpj",
  "billingMethod",
  "additionalInstallment",
  "monthlyFee",
  "observations",
] as const;

type OfficeFeeSpreadsheetField = (typeof FIELDS)[number];
type ColumnMap = Partial<Record<OfficeFeeSpreadsheetField, number>>;

const HEADER_ALIASES: Readonly<Record<OfficeFeeSpreadsheetField, readonly string[]>> = {
  companyName: ["cliente", "clientes", "empresa", "empresas", "razao social"],
  cnpj: ["cnpj", "cpf cnpj", "documento"],
  billingMethod: ["cobranca", "forma de cobranca", "meio de cobranca"],
  additionalInstallment: [
    "cobra parcela adicional2",
    "cobra parcela adicional",
    "parcela adicional2",
    "parcela adicional",
  ],
  monthlyFee: [
    "honorario 2025 atualizado",
    "honorario atualizado",
    "honorario mensal",
    "honorario",
    "valor mensal",
  ],
  observations: ["observacoes", "observacao", "obs"],
};

const headerByName = new Map<string, OfficeFeeSpreadsheetField>(
  FIELDS.flatMap((field) => HEADER_ALIASES[field].map((name) => [fold(name), field] as const)),
);

function mapHeader(row: readonly unknown[]): ColumnMap {
  const columns: ColumnMap = {};
  row.forEach((cell, index) => {
    const field = headerByName.get(fold(cellText(cell) ?? ""));
    if (field && columns[field] === undefined) columns[field] = index;
  });
  return columns;
}

function hasData(row: readonly unknown[]): boolean {
  return row.some((cell) => cellText(cell) !== null);
}

function readCell(row: readonly unknown[], columns: ColumnMap, field: OfficeFeeSpreadsheetField): unknown {
  const index = columns[field];
  return index === undefined ? null : row[index] ?? null;
}

export interface OfficeFeeSpreadsheetRow {
  rowNumber: number;
  rawData: readonly unknown[];
  parsed: ParsedOfficeFeeImportRow;
}

export interface OfficeFeeSpreadsheetParseResult {
  rows: readonly OfficeFeeSpreadsheetRow[];
  rejectedRows: readonly { rowNumber: number; message: string }[];
  skippedRows: readonly { rowNumber: number; reason: "blank" | "before_header" | "header" | "summary" }[];
  missingColumns: readonly OfficeFeeSpreadsheetField[];
  errors: readonly string[];
}

/** Lê a grade tal como ela está no Excel, inclusive títulos antes do cabeçalho. */
export function parseOfficeFeeSpreadsheetRows(
  sheet: readonly (readonly unknown[])[],
): OfficeFeeSpreadsheetParseResult {
  let headerIndex = -1;
  let columns: ColumnMap = {};
  for (let index = 0; index < Math.min(sheet.length, 40); index += 1) {
    const next = mapHeader(sheet[index] ?? []);
    if (
      next.companyName !== undefined &&
      next.billingMethod !== undefined &&
      next.additionalInstallment !== undefined &&
      next.monthlyFee !== undefined
    ) {
      headerIndex = index;
      columns = next;
      break;
    }
  }
  if (headerIndex === -1) {
    return {
      rows: [],
      rejectedRows: [],
      skippedRows: [],
      missingColumns: FIELDS,
      errors: ["Não encontrei o cabeçalho de Clientes, Cobrança, Parcela adicional e Honorário."],
    };
  }

  const missingColumns = FIELDS.filter((field) => columns[field] === undefined);
  const rows: OfficeFeeSpreadsheetRow[] = [];
  const rejectedRows: { rowNumber: number; message: string }[] = [];
  const skippedRows: { rowNumber: number; reason: "blank" | "before_header" | "header" | "summary" }[] = [];
  for (let index = 0; index < sheet.length; index += 1) {
    const source = sheet[index] ?? [];
    const rowNumber = index + 1;
    if (index < headerIndex) {
      if (hasData(source)) skippedRows.push({ rowNumber, reason: "before_header" });
      continue;
    }
    if (index === headerIndex) {
      skippedRows.push({ rowNumber, reason: "header" });
      continue;
    }
    if (!hasData(source)) {
      skippedRows.push({ rowNumber, reason: "blank" });
      continue;
    }
    const repeatedColumns = mapHeader(source);
    if (
      repeatedColumns.companyName !== undefined &&
      repeatedColumns.billingMethod !== undefined &&
      repeatedColumns.additionalInstallment !== undefined &&
      repeatedColumns.monthlyFee !== undefined
    ) {
      skippedRows.push({ rowNumber, reason: "header" });
      continue;
    }
    const parsed = parseOfficeFeeImportRow({
      companyName: readCell(source, columns, "companyName"),
      cnpj: readCell(source, columns, "cnpj"),
      billingMethod: readCell(source, columns, "billingMethod"),
      additionalInstallment: readCell(source, columns, "additionalInstallment"),
      monthlyFee: readCell(source, columns, "monthlyFee"),
      observations: readCell(source, columns, "observations"),
    });
    if (!parsed.companyName) {
      skippedRows.push({ rowNumber, reason: "summary" });
      continue;
    }
    const blocking = parsed.issues.filter((issue) => issue.field !== "cnpj");
    if (blocking.length > 0) {
      rejectedRows.push({
        rowNumber,
        message: blocking.map((issue) => issue.message).join(" "),
      });
      continue;
    }
    rows.push({ rowNumber, rawData: source, parsed });
  }

  return { rows, rejectedRows, skippedRows, missingColumns, errors: [] };
}
