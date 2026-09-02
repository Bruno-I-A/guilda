import { describe, expect, test } from "vitest";

import { inferTaxRegimeFromCnpj } from "./client-tax-regime";

const base = {
  isMeiOptant: false,
  isSimplesOptant: false,
  legalNature: "Sociedade Empresária Limitada",
  taxRegimes: [] as { year: number | null; form: string }[],
};

describe("inferTaxRegimeFromCnpj", () => {
  test("classifica MEI antes de Simples quando ambos vêm marcados", () => {
    expect(inferTaxRegimeFromCnpj({
      ...base,
      isMeiOptant: true,
      isSimplesOptant: true,
    })).toBe("mei");
  });

  test("mantém optante do Simples que não é MEI como Simples Nacional", () => {
    expect(inferTaxRegimeFromCnpj({
      ...base,
      isSimplesOptant: true,
    })).toBe("simples");
  });

  test("usa o histórico mais recente para lucro presumido ou real", () => {
    expect(inferTaxRegimeFromCnpj({
      ...base,
      taxRegimes: [
        { year: 2024, form: "LUCRO REAL" },
        { year: 2025, form: "LUCRO PRESUMIDO" },
      ],
    })).toBe("presumido");
  });
});
