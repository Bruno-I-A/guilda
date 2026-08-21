import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { companyFlowNoticeBody, newClientNoticeBody } from "./notices";

function baseInput() {
  return {
    legalName: "BANCO DO BRASIL SA",
    cnpj: "00.000.000/0001-91",
    taxRegime: "Lucro Real",
    city: null,
    contact: null,
    summary: null,
    cnaeDescription: null,
    secondaryCnaes: null,
    openedAt: null,
    fiscalPortfolioNote: null,
    observations: [],
    taskCount: 0,
  };
}

describe("newClientNoticeBody", () => {
  test("traz a atividade principal quando a consulta de CNPJ resolveu", () => {
    const body = newClientNoticeBody({
      ...baseInput(),
      cnaeDescription: "Bancos múltiplos, com carteira comercial",
    });
    expect(body).toContain(
      "Atividade principal: Bancos múltiplos, com carteira comercial",
    );
  });

  test("menciona a contagem de atividades secundárias, sem listar cada uma", () => {
    const body = newClientNoticeBody({
      ...baseInput(),
      cnaeDescription: "Bancos múltiplos, com carteira comercial",
      secondaryCnaes: [
        { code: "6432000", description: "Holdings" },
        { code: "6619302", description: "Correspondente bancário" },
      ],
    });
    expect(body).toContain("(e mais 2 atividades secundárias)");
  });

  test("uma única atividade secundária fica no singular", () => {
    const body = newClientNoticeBody({
      ...baseInput(),
      cnaeDescription: "Bancos múltiplos, com carteira comercial",
      secondaryCnaes: [{ code: "6432000", description: "Holdings" }],
    });
    expect(body).toContain("(e mais 1 atividade secundária)");
  });

  test("sem atividade principal, não menciona atividades nem no plural nem no singular", () => {
    const body = newClientNoticeBody(baseInput());
    expect(body).not.toContain("Atividade");
  });

  test("formata a data de abertura em pt-BR", () => {
    const body = newClientNoticeBody({ ...baseInput(), openedAt: "1966-08-01" });
    expect(body).toContain("Abertura: 01/08/1966");
  });

  test("o combinado do Fiscal aparece com seção própria, separado das observações gerais", () => {
    const body = newClientNoticeBody({
      ...baseInput(),
      fiscalPortfolioNote: "valores combinado: Fator R controlado.",
      observations: ["Camila acompanha o RH desta empresa."],
    });
    expect(body).toContain("Combinado do Fiscal\nvalores combinado: Fator R controlado.");
    expect(body).toContain("Observações e combinados\n• Camila acompanha o RH desta empresa.");
  });

  test("sem nada da consulta de CNPJ nem combinado, o corpo fica só com os dados cadastrais e a contagem", () => {
    const body = newClientNoticeBody(baseInput());
    expect(body).toBe(
      "Dados cadastrais\n" +
        "Razão social: BANCO DO BRASIL SA\n" +
        "CNPJ: 00.000.000/0001-91\n" +
        "Enquadramento: Lucro Real\n\n" +
        "0 missões foram criadas a partir deste informativo.",
    );
  });
});

describe("companyFlowNoticeBody", () => {
  test("publica no mural os dados oficiais do Fluxo, sem credencial", () => {
    const body = companyFlowNoticeBody({
      legalName: "SCHARRF & CIA LTDA",
      cnpj: "04502526000120",
      activities: [{ description: "Atividades de contabilidade" }],
      socialCapital: "10000.00",
      roomSize: "50 m²",
      address: "Rua Senador Salgado Filho, 551, Centro, GV",
      clientResponsible: "Bruno",
      qsa: [{ name: "Bruno Klain", document: "000.000.000-00", qualification: "Administrador", participation: "100%" }],
      contactName: "Bruno",
      contactPhone: "54984184808",
      contactEmail: "bruno@example.com",
      requestDetails: "Abertura da empresa.",
      processingNotes: "Deferida.",
      taskCount: 2,
    });

    expect(body).toContain("Capital social: R$");
    expect(body).toContain("Tamanho da sala: 50 m²");
    expect(body).toContain("CPF/CNPJ: 000.000.000-00");
    expect(body).toContain("Retorno do Societário\nDeferida.");
    expect(body).not.toContain("Gov.br");
  });
});
