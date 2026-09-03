import { describe, expect, test } from "vitest";

import {
  CLAN_TAB_DESCRIPTIONS,
  CLAN_TABS,
  clanHasClosings,
  clanHasPortfolio,
  clanTabsFor,
  isSharedClanTab,
  parseClanTab,
} from "./clan-tabs";

const keys = (slug: string) => clanTabsFor(slug).map((tab) => tab.key);

describe("abas comuns a todo clã", () => {
  test.each(["fiscal", "contabilidade", "rh", "societario", "financeiro"])(
    "%s tem missões, integrantes e campanhas",
    (slug) => {
      expect(keys(slug)).toEqual(
        expect.arrayContaining(["missions", "members", "campaigns"]),
      );
    },
  );
});

describe("abas específicas de cada clã", () => {
  test("Carteira só existe no Fiscal", () => {
    expect(clanHasPortfolio("fiscal")).toBe(true);
    expect(keys("fiscal")).toContain("portfolio");
    expect(keys("contabilidade")).not.toContain("portfolio");
    expect(keys("rh")).not.toContain("portfolio");
  });

  test("MEI, Parcelamentos e Honorários ficam no menu principal do Fiscal", () => {
    expect(keys("fiscal")).toEqual(
      expect.arrayContaining(["portfolio", "mei", "installments", "fees"]),
    );
    expect(keys("contabilidade")).not.toContain("mei");
    expect(keys("contabilidade")).not.toContain("installments");
    expect(keys("rh")).not.toContain("fees");
  });

  test("Fechamentos só existe na Contabilidade", () => {
    expect(clanHasClosings("contabilidade")).toBe(true);
    expect(keys("contabilidade")).toContain("closings");
    expect(keys("fiscal")).not.toContain("closings");
    expect(keys("financeiro")).not.toContain("closings");
  });

  test("Distribuição de lucros só existe na Contabilidade", () => {
    expect(keys("contabilidade")).toContain("commitments");
    expect(keys("fiscal")).not.toContain("commitments");
    expect(keys("rh")).not.toContain("commitments");
  });

  test("Dados da empresa e Fluxo só existem no Societário", () => {
    expect(keys("societario")).toEqual(
      expect.arrayContaining(["company-data", "flow"]),
    );
    expect(keys("fiscal")).not.toContain("company-data");
    expect(keys("contabilidade")).not.toContain("flow");
  });

  test("cada área recebe somente as ferramentas do seu trabalho", () => {
    expect(keys("fiscal")).toContain("portfolio");
    expect(keys("fiscal")).not.toContain("closings");
    expect(keys("contabilidade")).toEqual(
      expect.arrayContaining(["commitments", "closings"]),
    );
  });

  test("clã desconhecido fica só com as abas comuns", () => {
    expect(keys("marketing")).toEqual([
      "missions",
      "members",
      "campaigns",
    ]);
  });
});

describe("mesa do clã versus espaço da área", () => {
  test("missões, integrantes e campanhas são a mesa; o resto é da área", () => {
    expect(isSharedClanTab("missions")).toBe(true);
    expect(isSharedClanTab("members")).toBe(true);
    expect(isSharedClanTab("campaigns")).toBe(true);
    expect(isSharedClanTab("flow")).toBe(false);
    expect(isSharedClanTab("portfolio")).toBe(false);
    expect(isSharedClanTab("closings")).toBe(false);
  });

  test("toda aba tem uma descrição", () => {
    for (const tab of CLAN_TABS) {
      expect(CLAN_TAB_DESCRIPTIONS[tab.key].length).toBeGreaterThan(10);
    }
  });
});

describe("aba pedida na URL", () => {
  test("aba válida do clã é respeitada", () => {
    expect(parseClanTab("closings", "contabilidade")).toBe("closings");
    expect(parseClanTab("portfolio", "fiscal")).toBe("portfolio");
    expect(parseClanTab("mei", "fiscal")).toBe("mei");
    expect(parseClanTab("installments", "fiscal")).toBe("installments");
    expect(parseClanTab("fees", "fiscal")).toBe("fees");
    expect(parseClanTab("members", "rh")).toBe("members");
    expect(parseClanTab("company-data", "societario")).toBe("company-data");
  });

  // O que impede ?tab=closings de renderizar fechamento num clã que não é o
  // dono da seção.
  test("aba de outro clã cai em Missões", () => {
    expect(parseClanTab("closings", "fiscal")).toBe("missions");
    expect(parseClanTab("portfolio", "contabilidade")).toBe("missions");
  });

  test("valor desconhecido ou ausente cai em Missões", () => {
    expect(parseClanTab("qualquer-coisa", "fiscal")).toBe("missions");
    expect(parseClanTab(undefined, "fiscal")).toBe("missions");
  });
});
