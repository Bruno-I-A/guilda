import { describe, expect, it } from "vitest";

import { formatCnpj, normalizeCnpj, validateCnpj } from "./cnpj";

describe("normalizeCnpj", () => {
  it("remove máscara e qualquer não-dígito", () => {
    expect(normalizeCnpj("12.345.678/0001-95")).toBe("12345678000195");
    expect(normalizeCnpj(" 12345678000195 ")).toBe("12345678000195");
    expect(normalizeCnpj("abc")).toBe("");
  });
});

describe("validateCnpj", () => {
  it("aceita CNPJs válidos conhecidos", () => {
    expect(validateCnpj("11222333000181")).toBe(true); // exemplo clássico
    expect(validateCnpj("11444777000161")).toBe(true);
  });

  it("rejeita DV errado", () => {
    expect(validateCnpj("11222333000180")).toBe(false);
    expect(validateCnpj("11222333000191")).toBe(false);
  });

  it("rejeita tamanho errado e não-dígitos", () => {
    expect(validateCnpj("1122233300018")).toBe(false); // 13
    expect(validateCnpj("112223330001811")).toBe(false); // 15
    expect(validateCnpj("11.222.333/0001-81")).toBe(false); // com máscara
    expect(validateCnpj("")).toBe(false);
  });

  it("rejeita todos os dígitos repetidos (passariam no DV)", () => {
    expect(validateCnpj("00000000000000")).toBe(false);
    expect(validateCnpj("11111111111111")).toBe(false);
  });
});

describe("formatCnpj", () => {
  it("formata 14 dígitos para exibição", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("devolve como veio quando não é CNPJ normalizado", () => {
    expect(formatCnpj("abc")).toBe("abc");
  });
});
