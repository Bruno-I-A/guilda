import { describe, expect, test } from "vitest";

import { companyFlowInformativeText } from "./company-flow";

describe("Fluxo Societário", () => {
  test("leva os dados aprovados ao informativo sem vazar credencial", () => {
    const text = companyFlowInformativeText({
      kind: "opening",
      existingClientName: null,
      requestedLegalName: "NOME PRETENDIDO LTDA",
      requestedActivities: [{ description: "Comércio" }],
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
    expect(text).not.toContain("Gov.br");
    expect(text).toContain("Fiscal - ...");
  });
});
