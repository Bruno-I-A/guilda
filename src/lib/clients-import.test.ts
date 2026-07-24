import { describe, expect, it } from "vitest";

import { parseClientImportRows } from "./clients-import";

describe("parseClientImportRows", () => {
  it("lê planilha com cabeçalho nome/cnpj e aplica o regime escolhido", () => {
    const result = parseClientImportRows(
      [
        ["Nome", "CNPJ"],
        ["Padaria Estrela", "11.222.333/0001-81"],
      ],
      "simples",
    );

    expect(result.rows).toEqual([
      {
        name: "Padaria Estrela",
        cnpj: "11222333000181",
        taxRegime: "simples",
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("aceita primeira coluna como nome quando não existe cabeçalho", () => {
    const result = parseClientImportRows(
      [
        ["Oficina Central", ""],
        ["Comércio Real", undefined],
      ],
      "real",
    );

    expect(result.rows).toEqual([
      { name: "Oficina Central", cnpj: undefined, taxRegime: "real" },
      { name: "Comércio Real", cnpj: undefined, taxRegime: "real" },
    ]);
  });

  it("rejeita CNPJ inválido e mantém as demais linhas", () => {
    const result = parseClientImportRows(
      [
        ["Empresa", "CNPJ"],
        ["Cliente Bom", ""],
        ["Cliente Ruim", "11.222.333/0001-80"],
      ],
      "presumido",
    );

    expect(result.rows).toEqual([
      { name: "Cliente Bom", cnpj: undefined, taxRegime: "presumido" },
    ]);
    expect(result.rejected).toEqual([
      { rowNumber: 3, error: 'CNPJ inválido "11.222.333/0001-80"' },
    ]);
  });

  it("reconhece cabeçalho razão social", () => {
    const result = parseClientImportRows(
      [
        ["Razão Social"],
        ["Instituto Bairro"],
      ],
      "association",
    );

    expect(result.rows).toEqual([
      { name: "Instituto Bairro", cnpj: undefined, taxRegime: "association" },
    ]);
  });
});
