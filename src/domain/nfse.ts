import { validateTaxDocument } from "./cnpj";

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
 * Mês a que a nota mensal se refere: o anterior ao do controle. O Fiscal
 * emite no mês M a nota dos serviços de M-1 (em outubro, "referente a
 * competência 09/2026"), e o controle do mês é o do trabalho de emitir.
 */
export function nfseReferencePeriod(period: { year: number; month: number }): { year: number; month: number } {
  return period.month === 1 ? { year: period.year - 1, month: 12 } : { year: period.year, month: period.month - 1 };
}

export function isFutureNfsePeriod(
  period: { year: number; month: number },
  today: string,
): boolean {
  return `${period.year}-${twoDigits(period.month)}-01` > today;
}

/** Endereço do tomador no formato do leiaute (TCEndereco com endNac). */
export interface NfseTakerAddress {
  cityCode: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
}

/** Endereço como a Guilda guarda em `clients.address` (vem da consulta de CNPJ). */
export interface NfseClientAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

/** Chave de busca de município: sem acento, só letras e números, minúsculas. */
export function normalizeCityKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanText(value: string | null, max: number): string | null {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text ? text.slice(0, max) : null;
}

/**
 * Converte o endereço do cadastro no endereço do tomador. O Sistema Nacional
 * exige o endereço quando a nota leva o grupo IBS/CBS (E0234). Sem número vira
 * "S/N", como na Receita; sem rua, bairro, CEP ou município conhecido, null.
 */
export function buildNfseTakerAddress(
  address: NfseClientAddress | null,
  resolveCityCode: (state: string, city: string) => string | null,
): NfseTakerAddress | null {
  if (!address) return null;
  const street = cleanText(address.street, 255);
  const district = cleanText(address.district, 60);
  const zipCode = (address.zipCode ?? "").replace(/\D/g, "");
  const cityCode = address.state && address.city ? resolveCityCode(address.state, address.city) : null;
  if (!street || !district || zipCode.length !== 8 || !cityCode) return null;
  return {
    cityCode,
    zipCode,
    street,
    number: cleanText(address.number, 60) ?? "S/N",
    complement: cleanText(address.complement, 156),
    district,
  };
}

/** Quem paga: empresa-cliente ou tomador avulso do Honorários (um dos dois). */
export interface NfsePayer {
  clientId: string | null;
  takerId: string | null;
}

/** Chave única de quem paga, para não emitir duas notas iguais. */
export function nfsePayerKey(payer: NfsePayer): string {
  return payer.clientId ? `client:${payer.clientId}` : `taker:${payer.takerId}`;
}

export interface NfseCandidate extends NfsePayer {
  controlPeriodId: string;
  clientName: string;
  cnpj: string | null;
  monthlyFee: string;
  chargesAdditionalInstallment: boolean;
  address: NfseTakerAddress | null;
}

export type NfseExclusionReason =
  | "missing_cnpj"
  | "invalid_cnpj"
  | "zero_amount"
  | "missing_address"
  | "already_active";

export const NFSE_EXCLUSION_LABELS: Record<NfseExclusionReason, string> = {
  missing_cnpj: "Sem CNPJ/CPF cadastrado",
  invalid_cnpj: "CNPJ/CPF inválido",
  zero_amount: "Honorário zerado",
  missing_address: "Endereço incompleto no cadastro (rua, bairro, CEP e cidade)",
  already_active: "Nota já emitida ou na fila",
};

export interface NfseBatchItem extends NfsePayer {
  controlPeriodId: string;
  clientName: string;
  cnpj: string;
  kind: NfseInvoiceKind;
  amountCents: number;
  address: NfseTakerAddress | null;
}

/** Chave estável de um item do lote (a mesma empresa pode ter mensal e PA). */
export function nfseBatchItemKey(item: { controlPeriodId: string; kind: NfseInvoiceKind }): string {
  return `${item.controlPeriodId}:${item.kind}`;
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

export type NfseEmissionPreviewView = NfseBatch & {
  companiesWithoutFee: number;
  /** Como a descrição vai sair, para conferir antes de emitir (null sem modelo). */
  descriptions: { monthly: string; additionalInstallment: string } | null;
};

/**
 * Quem entra no lote do mês. A mensal vale para toda empresa com honorário
 * no controle; a PA só quando marcada, para quem cobra PA e ainda não teve
 * uma PA ativa no ano. Problema de cadastro (CNPJ, valor) aparece uma vez.
 */
export function selectNfseBatch(input: {
  candidates: readonly NfseCandidate[];
  /** Chaves de `nfsePayerKey` com nota ativa. */
  activeMonthlyPayers: ReadonlySet<string>;
  activeAdditionalPayers: ReadonlySet<string>;
  includeAdditional: boolean;
  /** Nota com IBS/CBS exige o endereço do tomador (E0234). */
  requireAddress?: boolean;
}): NfseBatch {
  const items: NfseBatchItem[] = [];
  const excluded: NfseBatchExclusion[] = [];
  for (const candidate of input.candidates) {
    const base = { controlPeriodId: candidate.controlPeriodId, clientName: candidate.clientName };
    const problem: NfseExclusionReason | null = !candidate.cnpj
      ? "missing_cnpj"
      : !validateTaxDocument(candidate.cnpj)
        ? "invalid_cnpj"
        : amountToCents(candidate.monthlyFee) === 0
          ? "zero_amount"
          : input.requireAddress && !candidate.address
            ? "missing_address"
            : null;
    if (problem || !candidate.cnpj) {
      excluded.push({ ...base, kind: "monthly", reason: problem ?? "missing_cnpj" });
      continue;
    }
    const amountCents = amountToCents(candidate.monthlyFee);
    const item = { ...base, clientId: candidate.clientId, takerId: candidate.takerId, cnpj: candidate.cnpj, amountCents, address: candidate.address };
    const payer = nfsePayerKey(candidate);
    if (input.activeMonthlyPayers.has(payer)) {
      excluded.push({ ...base, kind: "monthly", reason: "already_active" });
    } else {
      items.push({ ...item, kind: "monthly" });
    }
    if (!input.includeAdditional || !candidate.chargesAdditionalInstallment) continue;
    if (input.activeAdditionalPayers.has(payer)) {
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
