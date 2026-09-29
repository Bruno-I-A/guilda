export const ACCOUNTING_PERIOD_MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export type AccountingYearFilter = "all" | "open" | "completed";
export type AccountingObservationFilter =
  | "all"
  | "with"
  | "without"
  | "pending";
export type AccountingPeriodStatusFilter = "all" | "some" | "none";
export type AccountingMonthFilter = number | "all" | "unknown";

export function completedAccountingMonths(
  closings: readonly { periodMonth: number | null; status: string }[],
): (number | null)[] {
  return closings
    .filter((closing) => closing.status === "completed")
    .map((closing) => closing.periodMonth);
}

export interface AccountingClosingFilterFacts {
  yearClosed: boolean;
  observationCount: number;
  hasPendingObservation: boolean;
  completedMonths: readonly (number | null)[];
}

export function matchesAccountingClosingFilters(
  facts: AccountingClosingFilterFacts,
  filters: {
    year: AccountingYearFilter;
    observations: AccountingObservationFilter;
    periods: AccountingPeriodStatusFilter;
    month: AccountingMonthFilter;
  },
): boolean {
  if (filters.year === "open" && facts.yearClosed) return false;
  if (filters.year === "completed" && !facts.yearClosed) return false;
  if (filters.observations === "with" && facts.observationCount === 0) {
    return false;
  }
  if (filters.observations === "without" && facts.observationCount > 0) {
    return false;
  }
  if (filters.observations === "pending" && !facts.hasPendingObservation) {
    return false;
  }
  const hasClosingInScope =
    filters.month === "all"
      ? facts.completedMonths.length > 0
      : facts.completedMonths.includes(
          filters.month === "unknown" ? null : filters.month,
        );
  if (filters.periods === "some" && !hasClosingInScope) return false;
  if (filters.periods === "none" && hasClosingInScope) return false;
  return true;
}

export function accountingPeriodTitle(year: number, month: number): string {
  const monthName = ACCOUNTING_PERIOD_MONTHS[month - 1];
  if (!monthName) throw new RangeError("Mês de fechamento inválido.");
  return `${monthName} ${year}`;
}
