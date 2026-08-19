import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { newClientNoticeBody } from "./notices";

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
