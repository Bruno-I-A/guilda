/**
 * Regras puras do XML das NFS-e prestadas das empresas. Desenho em
 * docs/superpowers/specs/2026-10-19-xml-nfse-prestadas-design.md.
 */

export const XML_ROUTINE_FREQUENCIES = ["daily", "monthly"] as const;
export type XmlRoutineFrequency = (typeof XML_ROUTINE_FREQUENCIES)[number];

export interface XmlRoutineSchedule {
  enabled: boolean;
  frequency: XmlRoutineFrequency;
  /** 1 a 28, só no mensal (29–31 não existem em todo mês). */
  dayOfMonth: number | null;
  /** "HH:MM" em Brasília. */
  time: string;
}

export const XML_ROUTINE_DEFAULTS: XmlRoutineSchedule = {
  enabled: true,
  frequency: "daily",
  dayOfMonth: null,
  time: "06:00",
};

export const XML_ROUTINE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Brasília não tem horário de verão desde 2019: UTC-3 fixo, como em src/lib/nfse/time.ts. */
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;

function brasiliaDate(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() - BRASILIA_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Instante de um horário de Brasília. Date.UTC normaliza dia 0 e mês 0 (mês e ano anteriores). */
function brasiliaInstant(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) + BRASILIA_OFFSET_MS);
}

/** O último horário agendado que já chegou. */
export function lastScheduledRun(schedule: XmlRoutineSchedule, now: Date): Date {
  const [hours = 0, minutes = 0] = schedule.time.split(":").map(Number);
  const today = brasiliaDate(now);
  if (schedule.frequency === "daily") {
    const candidate = brasiliaInstant(today.year, today.month, today.day, hours, minutes);
    return candidate <= now ? candidate : brasiliaInstant(today.year, today.month, today.day - 1, hours, minutes);
  }
  const day = schedule.dayOfMonth ?? 1;
  const candidate = brasiliaInstant(today.year, today.month, day, hours, minutes);
  return candidate <= now ? candidate : brasiliaInstant(today.year, today.month - 1, day, hours, minutes);
}

/**
 * Rodada começada e não terminada há esse tempo foi interrompida (o serviço
 * fiscal reiniciou no meio). Menos que isso pode estar rodando: o serviço tem
 * uma trava em memória, e o prazo evita repetir a cada ciclo quando a rodada
 * quebra logo no começo.
 */
export const XML_ROUTINE_STALE_MS = 30 * 60 * 1000;

/**
 * Está na hora de rodar? "Rodar agora" pedido depois da última rodada vale
 * mesmo com a rotina desligada. Com a rotina ligada:
 * - rodada sem fim registrado foi interrompida se começou há
 *   XML_ROUTINE_STALE_MS ou mais, e roda de novo (a nova continua do NSU de
 *   cada empresa; sem isso, no mensal, só voltaria no mês seguinte); se
 *   começou há menos, pode estar rodando e a agenda não dispara outra;
 * - fora isso, roda quando a última rodada é anterior ao último horário
 *   agendado.
 */
export function isXmlRoutineDue(input: {
  schedule: XmlRoutineSchedule;
  lastRunStartedAt: Date | null;
  lastRunFinishedAt: Date | null;
  runRequestedAt: Date | null;
  now: Date;
}): boolean {
  const { schedule, lastRunStartedAt, lastRunFinishedAt, runRequestedAt, now } = input;
  if (runRequestedAt && (!lastRunStartedAt || runRequestedAt > lastRunStartedAt)) return true;
  if (!schedule.enabled) return false;
  if (!lastRunStartedAt) return true;
  if (!lastRunFinishedAt || lastRunFinishedAt < lastRunStartedAt) {
    return now.getTime() - lastRunStartedAt.getTime() >= XML_ROUTINE_STALE_MS;
  }
  return lastRunStartedAt < lastScheduledRun(schedule, now);
}

/** Notas emitidas no mês, em Brasília: [start, end). */
export function emissionMonthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: brasiliaInstant(year, month, 1), end: brasiliaInstant(year, month + 1, 1) };
}

/** "emitidas de 01/09 a 30/09". */
export function emissionRangeLabel(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return `emitidas de 01/${mm} a ${lastDay}/${mm}`;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    // O corte pode cair logo depois de um separador: sem hífen sobrando no fim.
    .replace(/-+$/, "");
}

/**
 * Pasta da empresa no .zip: nome sem acento + raiz do CNPJ (desempata nomes
 * iguais). Filial ganha também a ordem: matriz e filial têm a mesma raiz e
 * muitas vezes o mesmo nome, e as notas de uma sobrescreveriam as da outra.
 */
export function xmlCompanyFolder(name: string, cnpj: string | null): string {
  const base = slug(name) || "empresa";
  if (!cnpj || !/^\d{14}$/.test(cnpj)) return base;
  const root = cnpj.slice(0, 8);
  const branch = cnpj.slice(8, 12);
  return branch === "0001" ? `${base}-${root}` : `${base}-${root}-${branch}`;
}

/** Só número de verdade vira nome: "/" ou ".." viraria caminho dentro do .zip. */
export function xmlNoteFileName(nfseNumber: string | null, nsu: number): string {
  return nfseNumber && /^\d{1,20}$/.test(nfseNumber) ? `${nfseNumber.padStart(6, "0")}.xml` : `nsu-${nsu}.xml`;
}

export const CERTIFICATE_WARNING_DAYS = 30;
export type CertificateStatus = "pending" | "valid" | "invalid";
export type CertificateState = "missing" | "pending" | "invalid" | "expired" | "expiring" | "valid";

/** "Vencido" não é gravado: sai da validade na hora de mostrar. */
export function certificateState(input: {
  status: CertificateStatus | null;
  validUntil: Date | null;
  now: Date;
}): { state: CertificateState; daysLeft: number | null } {
  if (!input.status) return { state: "missing", daysLeft: null };
  if (input.status !== "valid" || !input.validUntil) {
    return { state: input.status === "valid" ? "invalid" : input.status, daysLeft: null };
  }
  const daysLeft = Math.floor((input.validUntil.getTime() - input.now.getTime()) / 86_400_000);
  if (input.validUntil <= input.now) return { state: "expired", daysLeft };
  return { state: daysLeft < CERTIFICATE_WARNING_DAYS ? "expiring" : "valid", daysLeft };
}

export interface CertificateSummary {
  total: number;
  /** Válido e com mais de 30 dias pela frente. */
  valid: number;
  expiring: number;
  pending: number;
  /** Com problema na conferência ou vencido: a rotina não lê essas empresas. */
  problem: number;
  missing: number;
}

/** O passo 1 da aba XML das notas: em que pé estão os certificados das empresas. */
export function summarizeCertificates(
  items: readonly { status: CertificateStatus | null; validUntil: Date | null }[],
  now: Date,
): CertificateSummary {
  const summary: CertificateSummary = { total: items.length, valid: 0, expiring: 0, pending: 0, problem: 0, missing: 0 };
  for (const item of items) {
    const { state } = certificateState({ ...item, now });
    if (state === "invalid" || state === "expired") summary.problem++;
    else summary[state]++;
  }
  return summary;
}

/** O mês que o Fiscal apura agora: o anterior ao de hoje, em Brasília (em outubro, setembro). */
export function previousEmissionMonth(now: Date): { year: number; month: number } {
  const today = brasiliaDate(now);
  return today.month === 1 ? { year: today.year - 1, month: 12 } : { year: today.year, month: today.month - 1 };
}

/** A API aceita certificado de mesma raiz (os 8 primeiros dígitos). */
export function cnpjRootMatches(a: string, b: string): boolean {
  return /^\d{14}$/.test(a) && /^\d{14}$/.test(b) && a.slice(0, 8) === b.slice(0, 8);
}
