import { describe, expect, test } from "vitest";

import { buildRoutingRoster, chooseRecipient, PORTFOLIO_ROSTER_ID } from "./support-routing";

const maria = { userId: "maria", name: "Maria Souza", isLeader: false };
const joao = { userId: "joao", name: "João Lima", isLeader: true };
const ana = { userId: "ana", name: "Ana Costa", isLeader: false };

describe("quem recebe a conversa encaminhada", () => {
  test("pessoa indicada pela IA, se ainda é do clã", () => {
    expect(chooseRecipient({ suggested: "maria", members: [maria, joao], portfolioOwnerId: null })).toEqual({
      assigneeUserId: "maria",
      notifyUserIds: ["maria"],
      label: "Maria Souza",
    });
    // Indicação de quem não é do clã cai no líder.
    expect(chooseRecipient({ suggested: "fulano", members: [maria, joao], portfolioOwnerId: null })).toEqual({
      assigneeUserId: "joao",
      notifyUserIds: ["joao"],
      label: "João Lima",
    });
  });

  test("Carteira vai ao responsável da empresa; sem ele, ao líder", () => {
    expect(chooseRecipient({ suggested: PORTFOLIO_ROSTER_ID, members: [maria, joao, ana], portfolioOwnerId: "ana" }).assigneeUserId).toBe("ana");
    expect(chooseRecipient({ suggested: PORTFOLIO_ROSTER_ID, members: [maria, joao], portfolioOwnerId: null }).assigneeUserId).toBe("joao");
    // Responsável que saiu do clã não recebe.
    expect(chooseRecipient({ suggested: PORTFOLIO_ROSTER_ID, members: [maria, joao], portfolioOwnerId: "ana" }).assigneeUserId).toBe("joao");
  });

  test("sem pessoa: líder único recebe; vários líderes são avisados; sem líder, o clã inteiro", () => {
    expect(chooseRecipient({ suggested: null, members: [maria, joao], portfolioOwnerId: null }).assigneeUserId).toBe("joao");
    const twoLeaders = [maria, joao, { ...ana, isLeader: true }];
    expect(chooseRecipient({ suggested: null, members: twoLeaders, portfolioOwnerId: null })).toEqual({
      assigneeUserId: null,
      notifyUserIds: ["joao", "ana"],
      label: null,
    });
    expect(chooseRecipient({ suggested: null, members: [maria, ana], portfolioOwnerId: null })).toEqual({
      assigneeUserId: null,
      notifyUserIds: ["maria", "ana"],
      label: null,
    });
  });
});

describe("lista enviada à IA", () => {
  test("pessoas com assunto escrito e a Carteira, com o setor do clã e o primeiro nome", () => {
    expect(
      buildRoutingRoster([
        {
          sector: "fiscal",
          members: [maria, joao],
          rules: [
            { userId: "maria", topics: "parcelamento" },
            { userId: null, topics: "guias de imposto" },
            { userId: "saiu", topics: "x" },
          ],
        },
        { sector: null, members: [ana], rules: [{ userId: "ana", topics: "folha" }] },
      ]),
    ).toEqual([
      { id: "maria", primeiroNome: "Maria", setores: ["fiscal"], atribuicoes: "parcelamento" },
      { id: PORTFOLIO_ROSTER_ID, primeiroNome: "Responsável da empresa (carteira)", setores: ["fiscal"], atribuicoes: "guias de imposto" },
    ]);
  });
});
