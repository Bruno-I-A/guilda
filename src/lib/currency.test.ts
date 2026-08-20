import { describe, expect, test } from "vitest";

import { formatBRLCurrency, parseBRLCurrencyInput } from "./currency";

describe("formatBRLCurrency", () => {
  test("exibe milhares e centavos no padrão brasileiro", () => {
    expect(formatBRLCurrency("30000.00")).toBe("R$ 30.000,00");
  });

  test("mantém campo vazio sem inventar zero", () => {
    expect(formatBRLCurrency("")).toBe("");
  });
});

describe("parseBRLCurrencyInput", () => {
  test("interpreta dígitos colados como reais inteiros", () => {
    expect(parseBRLCurrencyInput("30000")).toBe("30000.00");
  });

  test("remove símbolo e separadores de milhar", () => {
    expect(parseBRLCurrencyInput("R$ 30.000,45")).toBe("30000.45");
  });

  test("preserva negativos apenas quando permitido", () => {
    expect(parseBRLCurrencyInput("-R$ 2.500,00", { allowNegative: true })).toBe(
      "-2500.00",
    );
    expect(parseBRLCurrencyInput("-R$ 2.500,00")).toBe("2500.00");
  });
});
