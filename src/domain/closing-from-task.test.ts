import { describe, expect, test } from "vitest";

import {
  parseBrazilianAmount,
  taskClosesPeriod,
  parseClosingFigures,
  suggestedClosingTitle,
} from "./closing-from-task";

describe("valor em real", () => {
  test.each([
    ["182.498,91", "182498.91"],
    ["R$ 154.451,41", "154451.41"],
    ["1.234.567,89", "1234567.89"],
    ["1500", "1500"],
    ["1.500", "1500"],
    ["182,5", "182.5"],
    ["-3.200,10", "-3200.10"],
  ])("%s vira %s", (entrada, esperado) => {
    expect(parseBrazilianAmount(entrada)).toBe(esperado);
  });

  test.each([
    ["texto solto"],
    ["12,345"],
    ["1.2.3,45"],
    [""],
    ["R$"],
  ])("%s não vira número", (entrada) => {
    expect(parseBrazilianAmount(entrada)).toBeNull();
  });

  test("ponto só é milhar quando agrupa de três em três", () => {
    // "182.49" é decimal; "182.498" é milhar. A diferença muda o balanço por
    // um fator de dez, então tem que estar certa.
    expect(parseBrazilianAmount("182.49")).toBe("182.49");
    expect(parseBrazilianAmount("182.498")).toBe("182498");
  });
});

describe("números do retorno da missão", () => {
  test("lê o retorno real que motivou a integração", () => {
    expect(
      parseClosingFigures("Caixa - 182.498,91\nResultado - 154.451,41"),
    ).toEqual({
      cashBalance: "182498.91",
      periodResult: "154451.41",
      shareholderLoan: null,
    });
  });

  test("aceita dois pontos, sinal de igual e R$", () => {
    expect(
      parseClosingFigures("Caixa: R$ 1.000,00\nResultado = 2.000,50"),
    ).toEqual({
      cashBalance: "1000.00",
      periodResult: "2000.50",
      shareholderLoan: null,
    });
  });

  test("reconhece a conta do sócio pelos nomes que a equipe usa", () => {
    expect(parseClosingFigures("Empréstimo - 500,00").shareholderLoan).toBe("500.00");
    expect(parseClosingFigures("Mútuo - 500,00").shareholderLoan).toBe("500.00");
    expect(parseClosingFigures("Conta sócio - 500,00").shareholderLoan).toBe("500.00");
  });

  test("texto corrido NÃO vira valor", () => {
    // Num balanço, campo vazio que a pessoa preenche é melhor que número
    // adivinhado que ela não confere.
    expect(
      parseClosingFigures("Terminei o balanço, o caixa ficou alto esse mês"),
    ).toEqual({ cashBalance: null, periodResult: null, shareholderLoan: null });
  });

  test("rótulo desconhecido é ignorado", () => {
    expect(parseClosingFigures("Faturamento - 900,00")).toEqual({
      cashBalance: null,
      periodResult: null,
      shareholderLoan: null,
    });
  });

  test("a primeira ocorrência de cada rótulo manda", () => {
    expect(parseClosingFigures("Caixa - 100,00\nCaixa - 200,00").cashBalance).toBe(
      "100.00",
    );
  });

  test("retorno vazio ou ausente devolve tudo nulo", () => {
    expect(parseClosingFigures(null)).toEqual({
      cashBalance: null,
      periodResult: null,
      shareholderLoan: null,
    });
    expect(parseClosingFigures("")).toEqual({
      cashBalance: null,
      periodResult: null,
      shareholderLoan: null,
    });
  });
});

describe("título sugerido para o período", () => {
  test("tira o verbo e a empresa, que já é dona da linha", () => {
    expect(
      suggestedClosingTitle({
        taskTitle: "Fazer Balanço Marieli Calgarotto",
        clientName: "MARIELI CALGAROTTO SERVICOS",
      }),
    ).toBe("Balanço");
  });

  test("mantém o que sobra quando não há verbo nem empresa no título", () => {
    expect(
      suggestedClosingTitle({
        taskTitle: "Apuração do 3º trimestre",
        clientName: "Empresa X",
      }),
    ).toBe("Apuração do 3º trimestre");
  });

  test("não devolve vazio quando o título é só o nome da empresa", () => {
    expect(
      suggestedClosingTitle({ taskTitle: "Empresa X", clientName: "Empresa X" }),
    ).toBe("Empresa X");
  });

  test("respeita o limite da coluna", () => {
    const titulo = suggestedClosingTitle({
      taskTitle: `Fazer ${"a".repeat(300)}`,
      clientName: "Z",
      maxLength: 40,
    });
    expect(titulo.length).toBeLessThanOrEqual(40);
  });
});

describe("quando a missão fecha o período", () => {
  test("entregue aguardando aprovação já conta como trabalho feito", () => {
    // A entrega traz o balanço pronto; a aprovação é o aceite de quem pediu,
    // não a execução. Era isso que deixava o período pendente com os números
    // já dentro dele.
    expect(taskClosesPeriod("awaiting_approval")).toBe(true);
  });

  test("concluída fecha", () => {
    expect(taskClosesPeriod("completed")).toBe(true);
  });

  test.each(["pending", "in_progress", "rejected", "cancelled"] as const)(
    "%s não fecha — e sair para um desses reabre o período",
    (status) => {
      expect(taskClosesPeriod(status)).toBe(false);
    },
  );

  test("devolver para ajuste deixa de ser estado de trabalho feito", () => {
    // O caso que o Bruno reportou: entregue → devolvida mantinha o período
    // fechado, porque a régua antiga só olhava `completed`.
    expect(taskClosesPeriod("awaiting_approval")).toBe(true);
    expect(taskClosesPeriod("rejected")).toBe(false);
  });
});
