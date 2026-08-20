/**
 * Planejamento de distribuição de lucros por empresa (funções puras).
 *
 * Um planejamento é a REGRA ("o Banrisul faz distribuição de lucros,
 * trimestralmente"); as ocorrências são as linhas de controle geradas a
 * partir dela, uma por período. Estas funções só traduzem cadência em
 * períodos — nada aqui toca banco nem aceita valor da interface.
 */

export const COMMITMENT_CADENCES = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;

export type CommitmentCadence = (typeof COMMITMENT_CADENCES)[number];

/** Quantas ocorrências a cadência produz por ano. */
const PERIODS_PER_YEAR: Record<CommitmentCadence, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

/** Quantos meses cada ocorrência cobre. */
const MONTHS_PER_PERIOD: Record<CommitmentCadence, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export function periodsPerYear(cadence: CommitmentCadence): number {
  return PERIODS_PER_YEAR[cadence];
}

export interface CommitmentPeriod {
  /** 1-based: 1–12 no mensal, 1–4 no trimestral, 1–2 no semestral, 1 no anual. */
  index: number;
  /** "YYYY-MM-DD" — último dia do período. */
  dueDate: string;
}

export interface CommitmentPeriodCoordinate {
  year: number;
  index: number;
}

export interface PlannedCommitmentPeriod extends CommitmentPeriod {
  year: number;
}

/**
 * Último dia do mês, sem depender de fuso: `Date.UTC(ano, mês, 0)` devolve o
 * último dia do mês ANTERIOR ao informado, então passar `month` 1-based já dá
 * o fim daquele mês — e o próprio Date resolve fevereiro em ano bissexto.
 */
function lastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

/**
 * As ocorrências de um ano, na ordem. O prazo padrão é o último dia do
 * período — data que sempre existe e não exige combinar nada. Cada ocorrência
 * pode ter o prazo editado depois, porque prazo real varia (a distribuição do
 * 1º tri pode vencer em 30/04, não em 31/03).
 */
export function periodsForCadence(
  cadence: CommitmentCadence,
  year: number,
): CommitmentPeriod[] {
  const total = PERIODS_PER_YEAR[cadence];
  const span = MONTHS_PER_PERIOD[cadence];
  return Array.from({ length: total }, (_, position) => {
    const index = position + 1;
    return { index, dueDate: lastDayOfMonth(year, index * span) };
  });
}

/**
 * Gera somente o intervalo escolhido, inclusive nas duas pontas. Essa é a
 * diferença entre "planejar" e criar o ano inteiro às cegas: uma empresa que
 * começa em agosto não ganha sete pendências retroativas.
 */
export function periodsForCadenceRange(
  cadence: CommitmentCadence,
  start: CommitmentPeriodCoordinate,
  end: CommitmentPeriodCoordinate,
): PlannedCommitmentPeriod[] {
  const total = periodsPerYear(cadence);
  if (
    start.year < 2000 ||
    end.year > 2100 ||
    start.index < 1 ||
    start.index > total ||
    end.index < 1 ||
    end.index > total
  ) {
    return [];
  }

  const startOrdinal = start.year * total + start.index - 1;
  const endOrdinal = end.year * total + end.index - 1;
  if (startOrdinal > endOrdinal) return [];

  const result: PlannedCommitmentPeriod[] = [];
  for (let year = start.year; year <= end.year; year += 1) {
    for (const period of periodsForCadence(cadence, year)) {
      const ordinal = year * total + period.index - 1;
      if (ordinal < startOrdinal || ordinal > endOrdinal) continue;
      result.push({ year, ...period });
    }
  }
  return result;
}

/** Primeiro período cujo encerramento ainda não passou. */
export function firstOpenPeriod(
  cadence: CommitmentCadence,
  today: string,
): CommitmentPeriodCoordinate {
  const year = Number(today.slice(0, 4));
  const current = periodsForCadence(cadence, year).find(
    (period) => period.dueDate >= today,
  );
  return current ? { year, index: current.index } : { year: year + 1, index: 1 };
}

/** Próximo período cronológico depois do informado. */
export function nextCommitmentPeriod(
  cadence: CommitmentCadence,
  period: CommitmentPeriodCoordinate,
): CommitmentPeriodCoordinate {
  const total = periodsPerYear(cadence);
  return period.index < total
    ? { year: period.year, index: period.index + 1 }
    : { year: period.year + 1, index: 1 };
}

const MONTH_ABBREVIATIONS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

/** Rótulo curto da ocorrência: "1º tri/2026", "mar/2026", "2026". */
export function commitmentPeriodLabel(
  cadence: CommitmentCadence,
  year: number,
  index: number,
): string {
  switch (cadence) {
    case "monthly":
      return `${MONTH_ABBREVIATIONS[index - 1] ?? index}/${year}`;
    case "quarterly":
      return `${index}º tri/${year}`;
    case "semiannual":
      return `${index}º sem/${year}`;
    case "annual":
      return String(year);
  }
}

export const CADENCE_LABELS: Record<CommitmentCadence, string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

/**
 * A ocorrência está vencida? Compara só as datas em "YYYY-MM-DD" — comparação
 * lexicográfica funciona nesse formato e evita a virada de dia por fuso.
 */
export function isPeriodOverdue(
  period: { dueDate: string; completedAt: Date | null },
  today: string,
): boolean {
  return !period.completedAt && period.dueDate < today;
}
