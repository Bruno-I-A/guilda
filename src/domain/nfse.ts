import { validateCnpj } from "./cnpj";

/**
 * Regras puras das notas de honorário (NFS-e nacional). Desenho em
 * docs/superpowers/specs/2026-10-10-notas-de-honorario-design.md.
 */

export const NFSE_INVOICE_KINDS = ["monthly", "additional_installment"] as const;
export type NfseInvoiceKind = (typeof NFSE_INVOICE_KINDS)[number];

export const NFSE_INVOICE_STATUSES = [
  "queued",
  "issued",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;
export type NfseInvoiceStatus = (typeof NFSE_INVOICE_STATUSES)[number];

export const NFSE_CANCEL_REASON_CODES = [1, 2, 9] as const;
export type NfseCancelReasonCode = (typeof NFSE_CANCEL_REASON_CODES)[number];
export const NFSE_CANCEL_REASON_LABELS: Record<NfseCancelReasonCode, string> = {
  1: "Erro na emissão",
  2: "Serviço não prestado",
  9: "Outros",
};
/** O Sistema Nacional exige justificativa de 15 a 255 caracteres (TSMotivo). */
export const NFSE_CANCEL_TEXT_MIN = 15;
export const NFSE_CANCEL_TEXT_MAX = 255;

/** Dias de antecedência do aviso de certificado vencendo. */
export const NFSE_CERTIFICATE_WARNING_DAYS = 30;
/** Sem batimento há mais que isso, o serviço fiscal é dado como parado. */
export const NFSE_SERVICE_STALE_MS = 5 * 60_000;

function requireDigits(value: string, length: number, label: string): string {
  if (!new RegExp(`^\\d{${length}}$`).test(value)) {
    throw new Error(`${label} deve ter ${length} dígitos.`);
  }
  return value;
}

/** Série de aplicativo próprio: 1 a 49999 (70000–79999 é do Emissor Web). */
export function normalizeDpsSeries(series: string): string {
  const value = Number(series);
  if (!/^\d{1,5}$/.test(series) || value < 1 || value > 49_999) {
    throw new Error("A série da DPS deve estar entre 1 e 49999 (faixa de aplicativo próprio).");
  }
  return String(value);
}

/**
 * Identificador da DPS (45 posições): "DPS" + município (7) + tipo de
 * inscrição (2 = CNPJ) + CNPJ (14) + série (5) + número (15).
 */
export function buildDpsId(input: {
  cityCode: string;
  cnpj: string;
  series: string;
  number: number;
}): string {
  const city = requireDigits(input.cityCode, 7, "O código do município");
  const cnpj = requireDigits(input.cnpj, 14, "O CNPJ do prestador");
  const series = normalizeDpsSeries(input.series).padStart(5, "0");
  if (!Number.isSafeInteger(input.number) || input.number < 1 || input.number > 999_999_999_999_999) {
    throw new Error("Número da DPS inválido.");
  }
  return `DPS${city}2${cnpj}${series}${String(input.number).padStart(15, "0")}`;
}

/** Identificador do pedido de cancelamento: "PRE" + chave (50) + "101101". */
export function buildCancelRequestId(accessKey: string): string {
  return `PRE${requireDigits(accessKey, 50, "A chave de acesso")}101101`;
}

/** Decimal canônico do banco ("850", "850.5", "850.50") em centavos. */
export function amountToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Valor inválido: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Centavos no formato do leiaute (TSDec15V2): sempre duas casas. */
export function centsToNfseAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("O valor da nota deve ser positivo.");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Troca {competencia} por MM/AAAA e {ano} por AAAA no texto do modelo. */
export function renderNfseDescription(
  template: string,
  period: { year: number; month: number },
): string {
  return template
    .replaceAll("{competencia}", `${twoDigits(period.month)}/${period.year}`)
    .replaceAll("{ano}", String(period.year))
    .trim();
}

/**
 * Data de competência: último dia do mês de referência, ou hoje se o mês
 * ainda corre — o leiaute recusa competência posterior à emissão.
 * `today` é a data de emissão no fuso da Guilda (AAAA-MM-DD).
 */
export function nfseCompetenceDate(
  period: { year: number; month: number },
  today: string,
): string {
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const endOfMonth = `${period.year}-${twoDigits(period.month)}-${twoDigits(lastDay)}`;
  return endOfMonth < today ? endOfMonth : today;
}

export function isFutureNfsePeriod(
  period: { year: number; month: number },
  today: string,
): boolean {
  return `${period.year}-${twoDigits(period.month)}-01` > today;
}

export interface NfseCandidate {
  controlPeriodId: string;
  clientId: string;
  clientName: string;
  cnpj: string | null;
  monthlyFee: string;
  chargesAdditionalInstallment: boolean;
}

export type NfseExclusionReason =
  | "missing_cnpj"
  | "invalid_cnpj"
  | "zero_amount"
  | "already_active";

export const NFSE_EXCLUSION_LABELS: Record<NfseExclusionReason, string> = {
  missing_cnpj: "Sem CNPJ cadastrado",
  invalid_cnpj: "CNPJ inválido",
  zero_amount: "Honorário zerado",
  already_active: "Nota já emitida ou na fila",
};

export interface NfseBatchItem {
  controlPeriodId: string;
  clientId: string;
  clientName: string;
  cnpj: string;
  kind: NfseInvoiceKind;
  amountCents: number;
}

export interface NfseBatchExclusion {
  controlPeriodId: string;
  clientName: string;
  kind: NfseInvoiceKind;
  reason: NfseExclusionReason;
}

export interface NfseBatch {
  items: NfseBatchItem[];
  excluded: NfseBatchExclusion[];
  totalCents: number;
}

export type NfseEmissionPreviewView = NfseBatch & { companiesWithoutFee: number };

/**
 * Quem entra no lote do mês. A mensal vale para toda empresa com honorário
 * no controle; a PA só quando marcada, para quem cobra PA e ainda não teve
 * uma PA ativa no ano. Problema de cadastro (CNPJ, valor) aparece uma vez.
 */
export function selectNfseBatch(input: {
  candidates: readonly NfseCandidate[];
  activeMonthlyClientIds: ReadonlySet<string>;
  activeAdditionalClientIds: ReadonlySet<string>;
  includeAdditional: boolean;
}): NfseBatch {
  const items: NfseBatchItem[] = [];
  const excluded: NfseBatchExclusion[] = [];
  for (const candidate of input.candidates) {
    const base = { controlPeriodId: candidate.controlPeriodId, clientName: candidate.clientName };
    const problem: NfseExclusionReason | null = !candidate.cnpj
      ? "missing_cnpj"
      : !validateCnpj(candidate.cnpj)
        ? "invalid_cnpj"
        : amountToCents(candidate.monthlyFee) === 0
          ? "zero_amount"
          : null;
    if (problem || !candidate.cnpj) {
      excluded.push({ ...base, kind: "monthly", reason: problem ?? "missing_cnpj" });
      continue;
    }
    const amountCents = amountToCents(candidate.monthlyFee);
    const item = { ...base, clientId: candidate.clientId, cnpj: candidate.cnpj, amountCents };
    if (input.activeMonthlyClientIds.has(candidate.clientId)) {
      excluded.push({ ...base, kind: "monthly", reason: "already_active" });
    } else {
      items.push({ ...item, kind: "monthly" });
    }
    if (!input.includeAdditional || !candidate.chargesAdditionalInstallment) continue;
    if (input.activeAdditionalClientIds.has(candidate.clientId)) {
      excluded.push({ ...base, kind: "additional_installment", reason: "already_active" });
    } else {
      items.push({ ...item, kind: "additional_installment" });
    }
  }
  return { items, excluded, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0) };
}

export type NfseServiceState = "unconfigured" | "offline" | "error" | "ready";

export function nfseServiceHealth(input: {
  configured: boolean;
  serviceSeenAt: Date | null;
  serviceError: string | null;
  certificateValidUntil: Date | null;
  now: Date;
}): { state: NfseServiceState; certificateDaysLeft: number | null } {
  const certificateDaysLeft = input.certificateValidUntil
    ? Math.floor((input.certificateValidUntil.getTime() - input.now.getTime()) / 86_400_000)
    : null;
  if (!input.configured) return { state: "unconfigured", certificateDaysLeft };
  if (!input.serviceSeenAt || input.now.getTime() - input.serviceSeenAt.getTime() > NFSE_SERVICE_STALE_MS) {
    return { state: "offline", certificateDaysLeft };
  }
  if (input.serviceError) return { state: "error", certificateDaysLeft };
  return { state: "ready", certificateDaysLeft };
}

/** Nome do PDF dentro do .zip: número da nota (ou da DPS) + tomador sem acento. */
export function danfseFileName(input: {
  nfseNumber: string | null;
  dpsNumber: number;
  takerName: string;
}): string {
  const slug = input.takerName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const prefix = input.nfseNumber ? input.nfseNumber.padStart(6, "0") : `dps-${input.dpsNumber}`;
  return slug ? `${prefix}-${slug}.pdf` : `${prefix}.pdf`;
}
