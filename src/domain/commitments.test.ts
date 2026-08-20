import { describe, expect, test } from "vitest";

import {
  commitmentPeriodLabel,
  firstOpenPeriod,
  isPeriodOverdue,
  nextCommitmentPeriod,
  periodsForCadence,
  periodsForCadenceRange,
  periodsPerYear,
} from "./commitments";

describe("periodsForCadence", () => {
  test("trimestral gera 4 ocorrências fechando no último dia de cada trimestre", () => {
    expect(periodsForCadence("quarterly", 2026)).toEqual([
      { index: 1, dueDate: "2026-03-31" },
      { index: 2, dueDate: "2026-06-30" },
      { index: 3, dueDate: "2026-09-30" },
      { index: 4, dueDate: "2026-12-31" },
    ]);
  });

  test("semestral gera 2 ocorrências", () => {
    expect(periodsForCadence("semiannual", 2026)).toEqual([
      { index: 1, dueDate: "2026-06-30" },
      { index: 2, dueDate: "2026-12-31" },
    ]);
  });

  test("anual gera 1 ocorrência fechando no fim do ano", () => {
    expect(periodsForCadence("annual", 2026)).toEqual([
      { index: 1, dueDate: "2026-12-31" },
    ]);
  });

  test("mensal gera 12 ocorrências, cada uma no fim do seu mês", () => {
    const periods = periodsForCadence("monthly", 2026);
    expect(periods).toHaveLength(12);
    expect(periods[0]).toEqual({ index: 1, dueDate: "2026-01-31" });
    expect(periods[3]).toEqual({ index: 4, dueDate: "2026-04-30" });
    expect(periods[11]).toEqual({ index: 12, dueDate: "2026-12-31" });
  });

  // O último dia sai do próprio Date, então fevereiro não precisa de regra
  // especial — mas se alguém trocar por aritmética de dias, isto quebra.
  test("fevereiro respeita o ano bissexto", () => {
    expect(periodsForCadence("monthly", 2024)[1]).toEqual({
      index: 2,
      dueDate: "2024-02-29",
    });
    expect(periodsForCadence("monthly", 2026)[1]).toEqual({
      index: 2,
      dueDate: "2026-02-28",
    });
  });

  test("a contagem bate com periodsPerYear em todas as cadências", () => {
    for (const cadence of ["monthly", "quarterly", "semiannual", "annual"] as const) {
      expect(periodsForCadence(cadence, 2026)).toHaveLength(periodsPerYear(cadence));
    }
  });
});

describe("periodsForCadenceRange", () => {
  test("começar em agosto não cria pendências de janeiro a julho", () => {
    expect(
      periodsForCadenceRange(
        "monthly",
        { year: 2026, index: 8 },
        { year: 2026, index: 12 },
      ),
    ).toEqual([
      { year: 2026, index: 8, dueDate: "2026-08-31" },
      { year: 2026, index: 9, dueDate: "2026-09-30" },
      { year: 2026, index: 10, dueDate: "2026-10-31" },
      { year: 2026, index: 11, dueDate: "2026-11-30" },
      { year: 2026, index: 12, dueDate: "2026-12-31" },
    ]);
  });

  test("atravessa o ano mantendo as duas pontas", () => {
    expect(
      periodsForCadenceRange(
        "quarterly",
        { year: 2026, index: 4 },
        { year: 2027, index: 2 },
      ).map(({ year, index }) => ({ year, index })),
    ).toEqual([
      { year: 2026, index: 4 },
      { year: 2027, index: 1 },
      { year: 2027, index: 2 },
    ]);
  });

  test("intervalo invertido ou índice inválido não gera nada", () => {
    expect(
      periodsForCadenceRange(
        "monthly",
        { year: 2026, index: 9 },
        { year: 2026, index: 8 },
      ),
    ).toEqual([]);
    expect(
      periodsForCadenceRange(
        "quarterly",
        { year: 2026, index: 5 },
        { year: 2026, index: 5 },
      ),
    ).toEqual([]);
  });
});

describe("navegação dos períodos", () => {
  test("sugere o período corrente e avança pela virada do ano", () => {
    expect(firstOpenPeriod("monthly", "2026-08-20")).toEqual({
      year: 2026,
      index: 8,
    });
    expect(nextCommitmentPeriod("quarterly", { year: 2026, index: 4 })).toEqual({
      year: 2027,
      index: 1,
    });
  });
});

describe("commitmentPeriodLabel", () => {
  test("cada cadência tem seu formato", () => {
    expect(commitmentPeriodLabel("quarterly", 2026, 1)).toBe("1º tri/2026");
    expect(commitmentPeriodLabel("semiannual", 2026, 2)).toBe("2º sem/2026");
    expect(commitmentPeriodLabel("annual", 2026, 1)).toBe("2026");
    expect(commitmentPeriodLabel("monthly", 2026, 3)).toBe("mar/2026");
    expect(commitmentPeriodLabel("monthly", 2026, 12)).toBe("dez/2026");
  });
});

describe("isPeriodOverdue", () => {
  test("prazo passado e sem conclusão está vencido", () => {
    expect(
      isPeriodOverdue({ dueDate: "2026-03-31", completedAt: null }, "2026-04-01"),
    ).toBe(true);
  });

  test("concluída não fica vencida, mesmo com prazo passado", () => {
    expect(
      isPeriodOverdue({ dueDate: "2026-03-31", completedAt: new Date() }, "2026-04-01"),
    ).toBe(false);
  });

  test("no próprio dia do prazo ainda não está vencida", () => {
    expect(
      isPeriodOverdue({ dueDate: "2026-03-31", completedAt: null }, "2026-03-31"),
    ).toBe(false);
  });
});
