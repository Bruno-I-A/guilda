import { describe, expect, test } from "vitest";

import {
  canAppointClanLeader,
  canDistributeClanTasks,
  canEmphasizeNotice,
  canHandleInformatives,
  canManageClanMembership,
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

describe("clã — decisão 7", () => {
  test("líder gerencia integrantes do próprio clã", () => {
    expect(
      canManageClanMembership({ role: "member", leadsThisClan: true }),
    ).toBe(true);
  });

  test("líder de outro clã não gerencia este", () => {
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
