import { describe, expect, test } from "vitest";

import {
  canAppointClanLeader,
  canDistributeClanTasks,
  canEmphasizeNotice,
  canHandleInformatives,
  canManageClanMembership,
  canManageFiscalPortfolio,
  canSeeNoticeAcknowledgements,
} from "./guild-permissions";

describe("informativos — decisão 9", () => {
  test.each(["owner", "admin"] as const)("%s confirma informativo", (role) => {
    expect(canHandleInformatives({ role, leadsAnyClan: false })).toBe(true);
  });

  test("líder de clã confirma informativo mesmo sendo member", () => {
    expect(canHandleInformatives({ role: "member", leadsAnyClan: true })).toBe(
      true,
    );
  });

  test("member sem liderança não confirma", () => {
    expect(canHandleInformatives({ role: "member", leadsAnyClan: false })).toBe(
      false,
    );
  });
});

describe("mural — quem pode obrigar a Guilda a dar ciência", () => {
  test("member comum não fixa nem exige confirmação", () => {
    expect(canEmphasizeNotice({ role: "member", leadsAnyClan: false })).toBe(
      false,
    );
  });

  test.each([
    ["member", true],
    ["admin", false],
    ["owner", false],
  ] as const)("%s com liderança=%s pode destacar", (role, leadsAnyClan) => {
    expect(canEmphasizeNotice({ role, leadsAnyClan })).toBe(true);
  });

  test("quem publicou vê as pendências do próprio aviso", () => {
    expect(
      canSeeNoticeAcknowledgements({
        role: "member",
        leadsAnyClan: false,
        isAuthor: true,
      }),
    ).toBe(true);
  });

  test("member comum não vê pendências de aviso alheio", () => {
    expect(
      canSeeNoticeAcknowledgements({
        role: "member",
        leadsAnyClan: false,
        isAuthor: false,
      }),
    ).toBe(false);
  });
});

describe("clã — composição é das Configurações", () => {
  test.each(["admin", "owner"] as const)(
    "%s gerencia a composição do clã",
    (role) => {
      expect(canManageClanMembership({ role, leadsThisClan: false })).toBe(true);
    },
  );

  // Revoga a Decisão 7 (2026-08-18): entrar/sair de clã define o que a pessoa
  // vê, então nem o líder do próprio clã mexe nisso.
  test("líder do próprio clã NÃO gerencia mais a composição", () => {
    expect(
      canManageClanMembership({ role: "member", leadsThisClan: true }),
    ).toBe(false);
  });

  test("member comum não gerencia composição", () => {
    expect(
      canManageClanMembership({ role: "member", leadsThisClan: false }),
    ).toBe(false);
  });

  test("nomear líder continua exclusivo de admin/owner", () => {
    expect(canAppointClanLeader({ role: "member", leadsThisClan: true })).toBe(
      false,
    );
    expect(canAppointClanLeader({ role: "admin", leadsThisClan: false })).toBe(
      true,
    );
  });

  test("a Mesa distribui para líder do clã e para admin", () => {
    expect(canDistributeClanTasks({ role: "member", leadsThisClan: true })).toBe(
      true,
    );
    expect(canDistributeClanTasks({ role: "owner", leadsThisClan: false })).toBe(
      true,
    );
    expect(
      canDistributeClanTasks({ role: "member", leadsThisClan: false }),
    ).toBe(false);
  });
});

describe("carteira fiscal — quem remaneja empresa", () => {
  test("líder do clã remaneja a carteira do próprio clã", () => {
    expect(
      canManageFiscalPortfolio({ role: "member", leadsThisClan: true }),
    ).toBe(true);
  });

  test.each(["admin", "owner"] as const)("%s remaneja qualquer carteira", (role) => {
    expect(canManageFiscalPortfolio({ role, leadsThisClan: false })).toBe(true);
  });

  test("member comum só enxerga, não remaneja", () => {
    expect(
      canManageFiscalPortfolio({ role: "member", leadsThisClan: false }),
    ).toBe(false);
  });
});
