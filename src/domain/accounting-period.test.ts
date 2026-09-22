import { describe, expect, test } from "vitest";

import {
  accountingPeriodTitle,
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
    closingMonths: [11],
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

  test("separa empresas sem períodos das antigas sem mês classificado", () => {
    expect(
      matchesAccountingClosingFilters(
        { ...facts, closingMonths: [] },
        { year: "all", observations: "all", periods: "none", month: "all" },
      ),
    ).toBe(true);
    expect(
      matchesAccountingClosingFilters(
        { ...facts, closingMonths: [null] },
        {
          year: "all",
          observations: "all",
          periods: "some",
          month: "unknown",
        },
      ),
    ).toBe(true);
  });
});
