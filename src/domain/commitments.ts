/**
 * Compromissos recorrentes de uma empresa-cliente (funções puras).
 *
 * Um compromisso é a REGRA ("o Banrisul faz distribuição de lucros,
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
