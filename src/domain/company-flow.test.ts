import { describe, expect, test } from "vitest";

import {
  amendmentClientRegistrationUpdate,
  companyFlowActionsText,
  companyFlowInformativeText,
} from "./company-flow";

describe("Fluxo Societário", () => {
  test("leva os dados aprovados ao informativo sem vazar credencial", () => {
    const text = companyFlowInformativeText({
      kind: "opening",
      existingClientName: null,
      existingClientCnpj: null,
      existingClientTaxRegime: null,
      requestedLegalName: "NOME PRETENDIDO LTDA",
      requestedActivities: [{ description: "Comércio" }],
      removedActivities: [],
      taxRegime: "simples",
      iptu: "123456",
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
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: "Deferido pela Junta.",
    });

    expect(text).toContain("INFORMATIVO — ABERTURA");
    expect(text).toContain("NOME APROVADO LTDA");
    expect(text).toContain("CNPJ: 12345678000199");
    expect(text).toContain("Atividades aprovadas: Comércio varejista");
    expect(text).toContain("Regime tributário: Simples Nacional");
    expect(text).toContain("IPTU: 123456");
    expect(text).toContain("Capital social: R$");
    expect(text).toContain("Tamanho da sala: 45 m²");
    expect(text).toContain("Endereço: Rua Exemplo, 100, Porto Alegre/RS");
    expect(text).not.toContain("Gov.br");
    expect(text).toContain("Fiscal - ...");
  });

  test("leva a solicitação completa de alteração ao informativo e cria ação para o Societário", () => {
    const text = companyFlowInformativeText({
      kind: "amendment",
      existingClientName: "EMPRESA ATUAL LTDA",
      existingClientCnpj: "12345678000195",
      existingClientTaxRegime: "simples",
      requestedLegalName: "EMPRESA RENOMEADA LTDA",
      requestedActivities: [{ description: "Comércio eletrônico" }],
      removedActivities: [{ description: "Comércio atacadista" }],
      taxRegime: "presumido",
      iptu: "123.456.789",
      socialCapital: "50000.00",
      roomSize: null,
      address: "Rua Nova, 200, São Paulo/SP",
      clientResponsible: null,
      qsa: [{ name: "Ana", changeType: "entered", qualification: "Sócia administradora", participation: "100%" }],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: "Alterar endereço e quadro societário.",
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: "Alteração deferida pela Junta.",
    });

    expect(text).toContain("Empresa: EMPRESA ATUAL LTDA");
    expect(text).toContain("Nova razão social: EMPRESA RENOMEADA LTDA");
    expect(text).toContain("Atividades a incluir: Comércio eletrônico");
    expect(text).toContain("Atividades a retirar: Comércio atacadista");
    expect(text).toContain("Novo regime tributário: Lucro Presumido");
    expect(text).toContain("Novo endereço: Rua Nova, 200, São Paulo/SP");
    expect(text).toContain("QSA: Entrada — Ana — Sócia administradora — 100%");
    expect(text).toContain("Societário - Atualizar alvará, Inscrição Estadual");
    expect(text).not.toContain("CNPJ:");
  });

  test("prepara a baixa no modelo operacional padrão", () => {
    const text = companyFlowInformativeText({
      kind: "closure",
      existingClientName: "MARA G BORSATTI & CIA LTDA",
      existingClientCnpj: "12543850000115",
      existingClientTaxRegime: "simples",
      requestedLegalName: null,
      requestedActivities: [],
      removedActivities: [],
      taxRegime: null,
      iptu: null,
      socialCapital: null,
      roomSize: null,
      address: null,
      clientResponsible: null,
      qsa: [],
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      requestDetails: "EMPRESA BAIXADA 30/06/2026\nCOBRANÇA – RECIBO",
      resultCnpj: null,
      approvedLegalName: null,
      approvedActivities: [],
      approvedTaxRegime: null,
      approvedAddress: null,
      approvedQsa: [],
      processingNotes: "Baixa concluída pelo Societário.",
    });

    expect(text).toContain("INFORMATIVO DE BAIXA DE CLIENTE");
    expect(text).toContain("BAIXA DE CLIENTE – código (487)");
    expect(text).toContain("CNPJ/CPF/CEI – 12.543.850/0001-15");
    expect(text).toContain("ENQUADRAMENTO – SIMPLES NACIONAL");
    expect(text).toContain("OBSERVAÇÕES:\nEMPRESA BAIXADA 30/06/2026");
    expect(text).toContain("SOCIETÁRIO – Baixar o Alvará.");
    expect(text).toContain("CONTABIL – Rafa/Bruno – Finalizar lançamentos até a data da baixa");
    expect(text).toContain("SUCESSO DO CLIENTE – Separar toda a documentação");
    expect(text).not.toContain("ATENDIMENTO – Jessica");
    expect(text).toContain("ONVIO – Fabi – Retirar cliente do ONVIO também.");
  });

  test("envia à IA somente o bloco de ações do Fluxo", () => {
    const actions = companyFlowActionsText(
      "Empresa: Dado cadastral\nCNPJ: 00.000.000/0000-00\n\nAÇÕES\nFiscal - Camila - parametrizar\nRH - Bruno - cadastrar",
    );

    expect(actions).toBe("Fiscal - Camila - parametrizar\nRH - Bruno - cadastrar");
    expect(companyFlowActionsText("ACOES:\nFiscal - fazer algo")).toBe("Fiscal - fazer algo");
    expect(companyFlowActionsText("Empresa: sem marcador")).toBeNull();
  });

  test("reflete razão social e regime no cadastro apenas após uma alteração", () => {
    expect(amendmentClientRegistrationUpdate({
      kind: "amendment",
      requestedLegalName: "  NOME NOVO LTDA  ",
      taxRegime: "presumido",
    })).toEqual({ name: "NOME NOVO LTDA", taxRegime: "presumido" });
    expect(amendmentClientRegistrationUpdate({
      kind: "opening",
      requestedLegalName: "EMPRESA NOVA LTDA",
      taxRegime: "simples",
    })).toBeNull();
  });
});
