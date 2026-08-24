import { describe, expect, test } from "vitest";

import { parseInstallmentSpreadsheetRows } from "./installment-import";

describe("importação da planilha de parcelamentos", () => {
  test("identifica as cinco colunas e mantém empresas repetidas", () => {
    const result = parseInstallmentSpreadsheetRows([
      ["Empresa", "Tipo de Parcelamento", "Caminho/obs", "Entregar para:", "Nº de Parcelas"],
      ["O DAS da parcela do mês corrente só pode ser emitido a partir do dia 10."],
      ["ARREMATTO", "INSS/DEB. AUTOMÁTICO", "Usar certificado", "WHATS", "2/13"],
      ["ARREMATTO", "SIMPLES", "Usar certificado", "ATS GE PAVINA", "2/33"],
    ]);

    expect(result.headerRowNumber).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.parsed.companyName)).toEqual([
      "ARREMATTO",
      "ARREMATTO",
    ]);
    expect(result.rows[0]?.parsed).toMatchObject({
      installmentType: "INSS/DEB. AUTOMÁTICO",
      notes: "Usar certificado",
      deliveryMethod: "WHATS",
      installmentNumber: "2/13",
    });
    expect(result.skippedRows).toBe(2);
    expect(result.errors).toEqual([]);
  });

  test("aceita os nomes simplificados usados no cadastro novo", () => {
    const result = parseInstallmentSpreadsheetRows([
      ["Razão social", "Parcelamento", "OBS", "Forma de entrega", "Número de parcelas"],
      ["Empresa Teste", "Regularize", null, "E-mail", 80],
    ]);

    expect(result.rows[0]?.parsed).toMatchObject({
      companyName: "Empresa Teste",
      installmentType: "Regularize",
      deliveryMethod: "E-mail",
      installmentNumber: "80",
    });
  });

  test("rejeita linha incompleta e explica o problema", () => {
    const result = parseInstallmentSpreadsheetRows([
      ["Empresa", "Tipo de Parcelamento", "OBS", "Entrega", "Parcelas"],
      [null, "SIMPLES", "Pendente", "Whats", "3/12"],
    ]);
    expect(result.rows).toEqual([]);
    expect(result.rejectedRows).toEqual([
      { rowNumber: 2, message: "Empresa não informada." },
    ]);
  });
});
