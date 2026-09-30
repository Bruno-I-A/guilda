import { describe, expect, test } from "vitest";

import {
  analyzeClosingHealth,
  buildClosingBoard,
  closingStage,
  latestCompletedClosing,
  monthShortLabel,
  type OverviewClosing,
  type OverviewCompany,
} from "./closing-overview";

function periodo(overrides: Partial<OverviewClosing> = {}): OverviewClosing {
  return {
    status: "completed",
    periodMonth: 7,
    dueDate: "2026-07-31",
    cashBalance: null,
    periodResult: null,
    shareholderLoan: null,
    ...overrides,
  };
}

function empresa(
  name: string,
  closings: OverviewClosing[] = [],
  yearClosedAt: string | null = null,
): OverviewCompany {
  return { id: name, name, yearClosedAt, closings };
}

describe("etapa da empresa no ano", () => {
  test("ano encerrado vence, mesmo sem período lançado", () => {
    expect(closingStage(empresa("A", [], "2026-12-31T00:00:00Z"))).toBe("closed");
  });

  test("período só pendente NÃO conta como fechamento", () => {
    // Lançado não é fechado: o caso da Marieli antes da correção.
    expect(closingStage(empresa("A", [periodo({ status: "pending" })]))).toBe("none");
  });

  test("um período fechado já coloca a empresa em andamento", () => {
    expect(closingStage(empresa("A", [periodo()]))).toBe("partial");
  });

  test("sem nada lançado, nenhum período fechado", () => {
    expect(closingStage(empresa("A"))).toBe("none");
  });
});

describe("período mais recente", () => {
  test("vence o mês mais alto", () => {
    const julho = periodo({ periodMonth: 7 });
    const agosto = periodo({ periodMonth: 8, dueDate: "2026-08-31" });
    expect(latestCompletedClosing([agosto, julho])).toBe(agosto);
    expect(latestCompletedClosing([julho, agosto])).toBe(agosto);
  });

  test("ignora período pendente, mesmo que seja o mais recente", () => {
    const julho = periodo({ periodMonth: 7 });
    const setembroPendente = periodo({ periodMonth: 9, status: "pending" });
    expect(latestCompletedClosing([julho, setembroPendente])).toBe(julho);
  });

  test("período sem mês fica atrás de qualquer mês conhecido", () => {
    const semMes = periodo({ periodMonth: null, dueDate: "2026-12-31" });
    const marco = periodo({ periodMonth: 3, dueDate: "2026-03-31" });
    expect(latestCompletedClosing([semMes, marco])).toBe(marco);
  });

  test("mesmo mês desempata pelo vencimento", () => {
    const cedo = periodo({ periodMonth: 8, dueDate: "2026-08-15" });
    const tarde = periodo({ periodMonth: 8, dueDate: "2026-08-31" });
    expect(latestCompletedClosing([tarde, cedo])).toBe(tarde);
  });

  test("sem período fechado, não há foto", () => {
    expect(latestCompletedClosing([periodo({ status: "pending" })])).toBeNull();
  });
});

describe("quadro do ano", () => {
  test("cada empresa cai em uma coluna só", () => {
    const board = buildClosingBoard([
      empresa("Sem nada"),
      empresa("Andando", [periodo()]),
      empresa("Encerrada", [periodo()], "2026-12-31T00:00:00Z"),
    ]);
    expect(board.none.map((c) => c.name)).toEqual(["Sem nada"]);
    expect(board.partial.map((e) => e.company.name)).toEqual(["Andando"]);
    expect(board.closed.map((c) => c.name)).toEqual(["Encerrada"]);
  });

  test("em andamento vem da mais atrasada para a mais adiantada", () => {
    const board = buildClosingBoard([
      empresa("Agosto", [periodo({ periodMonth: 8 })]),
      empresa("Março", [periodo({ periodMonth: 3 })]),
      empresa("Sem mês", [periodo({ periodMonth: null })]),
      empresa("Junho", [periodo({ periodMonth: 6 })]),
    ]);
    expect(board.partial.map((e) => e.company.name)).toEqual([
      "Março",
      "Junho",
      "Agosto",
      "Sem mês",
    ]);
    expect(board.partial.map((e) => e.latestMonth)).toEqual([3, 6, 8, null]);
  });

  test("sem fechamento em ordem alfabética", () => {
    const board = buildClosingBoard([empresa("Zeta"), empresa("Alfa"), empresa("Ômega")]);
    expect(board.none.map((c) => c.name)).toEqual(["Alfa", "Ômega", "Zeta"]);
  });
});

describe("analista: saúde pelo período mais recente", () => {
  test("encontra prejuízo, caixa baixo e empréstimo", () => {
    const health = analyzeClosingHealth([
      empresa("Prejuízo", [periodo({ periodResult: "-5000.00", cashBalance: "50000.00" })]),
      empresa("Caixa baixo", [periodo({ cashBalance: "3000.00", periodResult: "100.00" })]),
      empresa("Empréstimo", [periodo({ shareholderLoan: "20000.00", cashBalance: "90000.00" })]),
      empresa("Saudável", [periodo({ cashBalance: "90000.00", periodResult: "8000.00" })]),
    ]);
    expect(health.loss.map((e) => e.company.name)).toEqual(["Prejuízo"]);
    expect(health.cash.map((e) => e.company.name)).toEqual(["Caixa baixo"]);
    expect(health.loan.map((e) => e.company.name)).toEqual(["Empréstimo"]);
    expect(health.analyzed).toBe(4);
  });

  test("caixa negativo vem antes do caixa só baixo", () => {
    const health = analyzeClosingHealth([
      empresa("Baixo", [periodo({ cashBalance: "4000.00" })]),
      empresa("Negativo", [periodo({ cashBalance: "-1200.50" })]),
    ]);
    expect(health.cash.map((e) => e.company.name)).toEqual(["Negativo", "Baixo"]);
    expect(health.cash[0].value).toBe(-1200.5);
  });

  test("prejuízo antigo que já virou lucro não é alerta", () => {
    // O que importa é a foto de agora, não o pior momento do ano.
    const health = analyzeClosingHealth([
      empresa("Recuperou", [
        periodo({ periodMonth: 3, dueDate: "2026-03-31", periodResult: "-9000.00" }),
        periodo({ periodMonth: 8, dueDate: "2026-08-31", periodResult: "4000.00" }),
      ]),
    ]);
    expect(health.loss).toEqual([]);
  });

  test("o valor sai do período fechado, nunca do pendente", () => {
    const health = analyzeClosingHealth([
      empresa("A", [
        periodo({ periodMonth: 7, cashBalance: "50000.00" }),
        periodo({ periodMonth: 8, status: "pending", cashBalance: "-100.00" }),
      ]),
    ]);
    expect(health.cash).toEqual([]);
  });

  test("empresa sem período fechado não entra na análise", () => {
    const health = analyzeClosingHealth([empresa("Sem nada")]);
    expect(health.analyzed).toBe(0);
  });

  test("campo vazio não vira zero — zero de caixa seria alerta falso", () => {
    const health = analyzeClosingHealth([empresa("Vazio", [periodo({ cashBalance: null })])]);
    expect(health.cash).toEqual([]);
  });

  test("o limite de caixa baixo é ajustável", () => {
    const empresas = [empresa("A", [periodo({ cashBalance: "15000.00" })])];
    expect(analyzeClosingHealth(empresas).cash).toEqual([]);
    expect(
      analyzeClosingHealth(empresas, { lowCashThreshold: 20_000 }).cash.map((e) => e.company.name),
    ).toEqual(["A"]);
  });

  test("piores primeiro: maior prejuízo e maior empréstimo no topo", () => {
    const health = analyzeClosingHealth([
      empresa("Pouco", [periodo({ periodResult: "-100.00", shareholderLoan: "1000.00" })]),
      empresa("Muito", [periodo({ periodResult: "-9000.00", shareholderLoan: "50000.00" })]),
    ]);
    expect(health.loss.map((e) => e.company.name)).toEqual(["Muito", "Pouco"]);
    expect(health.loan.map((e) => e.company.name)).toEqual(["Muito", "Pouco"]);
  });
});

describe("rótulo curto do mês", () => {
  test("abrevia e marca o que não tem mês", () => {
    expect(monthShortLabel(8)).toBe("Ago");
    expect(monthShortLabel(3)).toBe("Mar");
    expect(monthShortLabel(null)).toBe("sem mês");
  });
});
