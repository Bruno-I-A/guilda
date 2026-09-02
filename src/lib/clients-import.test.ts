import { describe, expect, it } from "vitest";

import { parseClientImportRows, parseClientReplacementRows } from "./clients-import";

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

describe("parseClientReplacementRows", () => {
  it("lê a planilha real com títulos antes do cabeçalho e preserva contatos", () => {
    const result = parseClientReplacementRows([
      ["Cadastro de Clientes", null, null, null],
      ["Registros:", 1, null, null],
      [null, null, null, null],
      ["Nome", "Email", "Celular", "CPF ou CNPJ"],
      ["Padaria Estrela", "contato@estrela.com.br", "(54) 99999-9999", "11.222.333/0001-81"],
    ]);

    expect(result).toEqual({
      rows: [{
        rowNumber: 5,
        spreadsheetName: "Padaria Estrela",
        operationalEmail: "contato@estrela.com.br",
        operationalPhone: "54999999999",
        cnpj: "11222333000181",
      }],
      rejected: [],
    });
  });

  it("rejeita CNPJ repetido sem aceitar carga ambígua", () => {
    const result = parseClientReplacementRows([
      ["Razão Social", "CNPJ"],
      ["Empresa A", "11.222.333/0001-81"],
      ["Empresa A filial", "11.222.333/0001-81"],
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toEqual([{ rowNumber: 3, error: "CNPJ repetido na planilha" }]);
  });

  it("mantém CNPJ inválido no lote para ser desconsiderado sem bloquear a carga", () => {
    const result = parseClientReplacementRows([
      ["Razão Social", "E-mail", "Celular", "CNPJ"],
      ["Empresa válida", "valida@empresa.com.br", "54999999999", "11.222.333/0001-81"],
      ["Empresa ignorada", "ignorada@empresa.com.br", "54988888888", "11.222.333/0001-80"],
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        spreadsheetName: "Empresa válida",
        operationalEmail: "valida@empresa.com.br",
        operationalPhone: "54999999999",
        cnpj: "11222333000181",
      },
      {
        rowNumber: 3,
        spreadsheetName: "Empresa ignorada",
        operationalEmail: "ignorada@empresa.com.br",
        operationalPhone: "54988888888",
        cnpj: "11222333000180",
      },
    ]);
  });
});
