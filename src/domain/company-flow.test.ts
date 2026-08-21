import { describe, expect, test } from "vitest";

import {
  companyFlowActionsText,
  companyFlowInformativeText,
} from "./company-flow";

describe("Fluxo Societário", () => {
  test("leva os dados aprovados ao informativo sem vazar credencial", () => {
    const text = companyFlowInformativeText({
      kind: "opening",
      existingClientName: null,
      requestedLegalName: "NOME PRETENDIDO LTDA",
      requestedActivities: [{ description: "Comércio" }],
      socialCapital: "30000.00",
      roomSize: "45 m²",
      address: "Rua Exemplo, 100, Porto Alegre/RS",
      clientResponsible: "Maria",
      qsa: [{ name: "Maria", qualification: "Sócia", participation: "100%" }],
      contactName: "Maria",
      contactPhone: "51999999999",
      contactEmail: "maria@example.com",
      requestDetails: "Abrir empresa para comércio.",
      resultCnpj: "12345678000199",
      approvedLegalName: "NOME APROVADO LTDA",
      approvedActivities: [{ description: "Comércio varejista" }],
      processingNotes: "Deferido pela Junta.",
    });

    expect(text).toContain("INFORMATIVO — ABERTURA");
    expect(text).toContain("NOME APROVADO LTDA");
    expect(text).toContain("CNPJ: 12345678000199");
    expect(text).toContain("Atividades aprovadas: Comércio varejista");
    expect(text).toContain("Capital social: R$");
    expect(text).toContain("Tamanho da sala: 45 m²");
    expect(text).toContain("Endereço: Rua Exemplo, 100, Porto Alegre/RS");
    expect(text).not.toContain("Gov.br");
    expect(text).toContain("Fiscal - ...");
  });

  test("envia à IA somente o bloco de ações do Fluxo", () => {
    const actions = companyFlowActionsText(
      "Empresa: Dado cadastral\nCNPJ: 00.000.000/0000-00\n\nAÇÕES\nFiscal - Camila - parametrizar\nRH - Bruno - cadastrar",
    );

    expect(actions).toBe("Fiscal - Camila - parametrizar\nRH - Bruno - cadastrar");
    expect(companyFlowActionsText("ACOES:\nFiscal - fazer algo")).toBe("Fiscal - fazer algo");
    expect(companyFlowActionsText("Empresa: sem marcador")).toBeNull();
  });
});
