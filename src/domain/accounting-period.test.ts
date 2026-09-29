import { describe, expect, test } from "vitest";

import {
  accountingPeriodTitle,
  completedAccountingMonths,
  matchesAccountingClosingFilters,
} from "./accounting-period";

describe("accountingPeriodTitle", () => {
  test("gera identificação do mês em português sem texto livre", () => {
    expect(accountingPeriodTitle(2026, 11)).toBe("Novembro 2026");
    expect(accountingPeriodTitle(2026, 12)).toBe("Dezembro 2026");
  });

  test("rejeita mês fora do calendário", () => {
    expect(() => accountingPeriodTitle(2026, 0)).toThrow(RangeError);
    expect(() => accountingPeriodTitle(2026, 13)).toThrow(RangeError);
  });
});

describe("matchesAccountingClosingFilters", () => {
  const facts = {
    yearClosed: false,
    observationCount: 0,
    hasPendingObservation: false,
    completedMonths: [11],
  };

  test("combina ano, ausência de observação, períodos e mês com AND", () => {
    expect(
      matchesAccountingClosingFilters(facts, {
        year: "open",
        observations: "without",
        periods: "some",
        month: 11,
      }),
    ).toBe(true);
    expect(
      matchesAccountingClosingFilters(facts, {
        year: "open",
        observations: "without",
        periods: "some",
        month: 12,
      }),
    ).toBe(false);
  });

  test("separa empresas sem fechamento das antigas sem mês classificado", () => {
    expect(
      matchesAccountingClosingFilters(
        { ...facts, completedMonths: [] },
        { year: "all", observations: "all", periods: "none", month: "all" },
      ),
    ).toBe(true);
    expect(
      matchesAccountingClosingFilters(
        { ...facts, completedMonths: [null] },
        {
          year: "all",
          observations: "all",
          periods: "some",
          month: "unknown",
        },
      ),
    ).toBe(true);
  });

  test("mostra como pendente em setembro quem fechou março, mesmo após outros meses", () => {
    const closedInMarch = { ...facts, completedMonths: [3] };
    const filters = { year: "all", observations: "all", month: 9 } as const;

    expect(
      matchesAccountingClosingFilters(closedInMarch, { ...filters, periods: "none" }),
    ).toBe(true);
    expect(
      matchesAccountingClosingFilters(closedInMarch, { ...filters, periods: "some" }),
    ).toBe(false);
    expect(
      matchesAccountingClosingFilters(closedInMarch, { ...filters, periods: "all" }),
    ).toBe(true);
    expect(
      matchesAccountingClosingFilters(closedInMarch, {
        ...filters,
        month: 3,
        periods: "none",
      }),
    ).toBe(false);
    expect(
      matchesAccountingClosingFilters(
        { ...facts, completedMonths: [3, 9] },
        { ...filters, periods: "some" },
      ),
    ).toBe(true);
  });
});

test("registro pendente ou bloqueado não conclui o mês na fila de trabalho", () => {
  const completedMonths = completedAccountingMonths([
    { periodMonth: 3, status: "completed" },
    { periodMonth: 9, status: "pending" },
    { periodMonth: 10, status: "blocked" },
  ]);

  expect(completedMonths).toEqual([3]);
  expect(
    matchesAccountingClosingFilters(
      {
        yearClosed: false,
        observationCount: 0,
        hasPendingObservation: false,
        completedMonths,
      },
      { year: "all", observations: "all", periods: "none", month: 9 },
    ),
  ).toBe(true);
});
