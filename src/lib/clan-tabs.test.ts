import { describe, expect, test } from "vitest";

import {
  clanHasClosings,
  clanHasPortfolio,
  clanTabsFor,
  parseClanTab,
} from "./clan-tabs";

const keys = (slug: string) => clanTabsFor(slug).map((tab) => tab.key);

describe("abas comuns a todo clã", () => {
  test.each(["fiscal", "contabilidade", "rh", "societario", "financeiro"])(
    "%s tem missões, integrantes, campanhas e compromissos",
    (slug) => {
      expect(keys(slug)).toEqual(
        expect.arrayContaining(["missions", "members", "campaigns", "commitments"]),
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

  test("Fechamentos só existe na Contabilidade", () => {
    expect(clanHasClosings("contabilidade")).toBe(true);
    expect(keys("contabilidade")).toContain("closings");
    expect(keys("fiscal")).not.toContain("closings");
    expect(keys("financeiro")).not.toContain("closings");
  });

  test("nenhum clã recebe as duas abas especiais", () => {
    for (const slug of ["fiscal", "contabilidade", "rh"]) {
      const special = keys(slug).filter(
        (key) => key === "portfolio" || key === "closings",
      );
      expect(special.length).toBeLessThanOrEqual(1);
    }
  });

  test("clã desconhecido fica só com as abas comuns", () => {
    expect(keys("marketing")).toEqual([
      "missions",
      "members",
      "campaigns",
      "commitments",
    ]);
  });
});

describe("aba pedida na URL", () => {
  test("aba válida do clã é respeitada", () => {
    expect(parseClanTab("closings", "contabilidade")).toBe("closings");
    expect(parseClanTab("portfolio", "fiscal")).toBe("portfolio");
    expect(parseClanTab("members", "rh")).toBe("members");
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
