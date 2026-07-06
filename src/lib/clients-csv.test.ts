import { describe, expect, it } from "vitest";

import { parseClientCsvLine } from "./clients-csv";

describe("parseClientCsvLine", () => {
  it("aceita linha completa com máscara de CNPJ e rótulo de regime", () => {
    const result = parseClientCsvLine(
      "Padaria Estrela;11.222.333/0001-81;Lucro Presumido",
    );
    expect(result).toEqual({
      kind: "row",
      row: { name: "Padaria Estrela", cnpj: "11222333000181", taxRegime: "presumido" },
    });
  });

  it("aceita CNPJ ausente e regime pela chave do enum", () => {
    const result = parseClientCsvLine("Oficina do Zé;;real");
    expect(result).toEqual({
      kind: "row",
      row: { name: "Oficina do Zé", cnpj: undefined, taxRegime: "real" },
    });
  });

  it("aceita rótulo com acento e caixa mista", () => {
    const result = parseClientCsvLine("Mercadinho Central;;SIMPLES NACIONAL");
    expect(result.kind).toBe("row");
    if (result.kind === "row") expect(result.row.taxRegime).toBe("simples");
  });

  it("pula linhas vazias e o cabeçalho", () => {
    expect(parseClientCsvLine("")).toEqual({ kind: "skip" });
    expect(parseClientCsvLine("   ")).toEqual({ kind: "skip" });
    expect(parseClientCsvLine("nome;cnpj;regime")).toEqual({ kind: "skip" });
    expect(parseClientCsvLine("NOME;CNPJ;REGIME")).toEqual({ kind: "skip" });
  });

  it("rejeita regime desconhecido", () => {
    const result = parseClientCsvLine("Empresa X;;MEI");
    expect(result.kind).toBe("error");
  });

  it("rejeita CNPJ com dígito verificador errado", () => {
    const result = parseClientCsvLine("Empresa Y;11.222.333/0001-80;simples");
    expect(result.kind).toBe("error");
  });

  it("rejeita nome curto demais", () => {
    const result = parseClientCsvLine("A;;simples");
    expect(result.kind).toBe("error");
  });
});
