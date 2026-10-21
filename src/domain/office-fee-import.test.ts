import { describe, expect, it } from "vitest";

import { parseOfficeFeeSpreadsheetRows } from "./office-fee-import";

describe("importação da planilha de honorários", () => {
  it("lê o cabeçalho real e ignora a linha de total", () => {
    const result = parseOfficeFeeSpreadsheetRows([
      ["CLIENTES", "CNPJ", "Cobrança", "COBRA PARCELA ADICIONAL2", "HONORÁRIO 2025 (ATUALIZADO)", "observações"],
      ["Empresa Exemplo Ltda", "07.412.545/0001-54", "Asaas", "SIM", 4560, "uma nota"],
      [null, null, null, null, 4560, null],
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.parsed).toMatchObject({
      companyName: "Empresa Exemplo Ltda",
      cnpj: "07412545000154",
      chargesAdditionalInstallment: true,
      monthlyFee: "4560.00",
      observations: "uma nota",
    });
    expect(result.skippedRows.some((row) => row.reason === "summary")).toBe(true);
  });

  it("lê a planilha sem coluna de cobrança, como a do escritório", () => {
    const result = parseOfficeFeeSpreadsheetRows([
      ["CLIENTES", "CNPJ", "PARCELA ADICIONA", "HONORÁRIO "],
      ["Vitamassas", "45.323.064/0001-61", "SIM", 250],
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.parsed).toMatchObject({ cnpj: "45323064000161", chargesAdditionalInstallment: true, monthlyFee: "250.00" });
  });

  it("rejeita campos operacionais faltantes sem perder a identificação do CNPJ inválido", () => {
    const result = parseOfficeFeeSpreadsheetRows([
      ["Clientes", "CNPJ", "Cobra parcela adicional", "Honorário", "Obs"],
      ["Empresa", "11.111.111/1111-11", "talvez", "sem valor", ""],
    ]);

    expect(result.rejectedRows).toHaveLength(1);
    expect(result.rejectedRows[0]?.message).toMatch(/Informe/);
  });
});
