import { describe, expect, test } from "vitest";

import { normalizeDominioCode, parseDominioCodeSheet, planDominioCodes } from "./dominio-code";

describe("normalizeDominioCode", () => {
  test("só dígitos, sem zeros à esquerda", () => {
    expect(normalizeDominioCode(" 0012 ")).toBe("12");
    expect(normalizeDominioCode("0")).toBe("0");
    expect(normalizeDominioCode(345)).toBe("345");
  });

  test("vazio é sem código", () => {
    expect(normalizeDominioCode("")).toBeNull();
    expect(normalizeDominioCode("   ")).toBeNull();
    expect(normalizeDominioCode(null)).toBeNull();
  });

  test("letra, sinal ou número longo demais não é código", () => {
    expect(normalizeDominioCode("12a")).toBeUndefined();
    expect(normalizeDominioCode("-3")).toBeUndefined();
    expect(normalizeDominioCode("1.5")).toBeUndefined();
    expect(normalizeDominioCode("12345678901")).toBeUndefined();
  });
});

describe("parseDominioCodeSheet", () => {
  test("acha o cabeçalho abaixo do título e lê código e CNPJ", () => {
    const sheet = [
      ["Relação de empresas"],
      [],
      ["Código", "Razão social", "CNPJ"],
      [12, "Padaria", "33.000.167/0001-01"],
      ["0007", "Clínica", 1234567000189],
      ["", "", ""],
      ["abc", "Erro", "33000167000101"],
      [5, "Produtor", "123.456.789-09"],
    ];
    const parsed = parseDominioCodeSheet(sheet);
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([
      { rowNumber: 4, code: "12", cnpj: "33000167000101" },
      { rowNumber: 5, code: "7", cnpj: "01234567000189" },
    ]);
    expect(parsed.rejected).toEqual([
      { rowNumber: 7, message: "código vazio ou que não é número" },
      { rowNumber: 8, message: "CPF, não CNPJ" },
    ]);
  });

  test("sem as colunas, diz o que falta", () => {
    expect(parseDominioCodeSheet([["Nome", "Valor"]]).error).toMatch(/Código/);
  });
});

describe("planDominioCodes", () => {
  const client = (id: string, cnpj: string | null, dominioCode: string | null = null) => ({ id, name: id.toUpperCase(), cnpj, dominioCode });
  const row = (rowNumber: number, code: string, cnpj: string) => ({ rowNumber, code, cnpj });

  test("casa pelo CNPJ e separa o que muda, o que fica e o que não existe", () => {
    const plan = planDominioCodes(
      [client("a", "11111111000111"), client("b", "22222222000122", "5")],
      [row(2, "1", "11111111000111"), row(3, "5", "22222222000122"), row(4, "9", "99999999000199")],
    );
    expect(plan.updates).toEqual([{ clientId: "a", name: "A", from: null, to: "1" }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.notFound.map((r) => r.rowNumber)).toEqual([4]);
    expect(plan.conflicts).toEqual([]);
  });

  test("troca de códigos entre duas empresas passa", () => {
    const plan = planDominioCodes(
      [client("a", "11111111000111", "1"), client("b", "22222222000122", "2")],
      [row(2, "2", "11111111000111"), row(3, "1", "22222222000122")],
    );
    expect(plan.updates.map((u) => [u.clientId, u.to])).toEqual([["a", "2"], ["b", "1"]]);
    expect(plan.conflicts).toEqual([]);
  });

  test("código que outra empresa mantém, ou repetido na planilha, vira conflito", () => {
    const plan = planDominioCodes(
      [client("a", "11111111000111"), client("b", "22222222000122", "7"), client("c", "33333333000133"), client("d", "44444444000144")],
      [row(2, "7", "11111111000111"), row(3, "8", "33333333000133"), row(4, "8", "44444444000144")],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.conflicts.map((c) => [c.rowNumber, c.message])).toEqual([
      [2, "o código já é de B"],
      [3, "o mesmo código aparece para outra empresa na planilha"],
      [4, "o mesmo código aparece para outra empresa na planilha"],
    ]);
  });
});
