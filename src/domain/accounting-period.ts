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

export interface AccountingClosingFilterFacts {
  yearClosed: boolean;
  observationCount: number;
  hasPendingObservation: boolean;
  closingMonths: readonly (number | null)[];
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
  if (filters.periods === "some" && facts.closingMonths.length === 0) {
    return false;
  }
  if (filters.periods === "none" && facts.closingMonths.length > 0) {
    return false;
  }
  if (
    filters.month === "unknown" &&
    !facts.closingMonths.includes(null)
  ) {
    return false;
  }
  if (
    typeof filters.month === "number" &&
    !facts.closingMonths.includes(filters.month)
  ) {
    return false;
  }
  return true;
}

export function accountingPeriodTitle(year: number, month: number): string {
  const monthName = ACCOUNTING_PERIOD_MONTHS[month - 1];
  if (!monthName) throw new RangeError("Mês de fechamento inválido.");
  return `${monthName} ${year}`;
}
