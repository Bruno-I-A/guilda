import { describe, expect, test } from "vitest";

import {
  canAppointClanLeader,
  canDistributeClanTasks,
  canQuickCompleteUnassignedInformativeTask,
  canEmphasizeNotice,
  canHandleInformatives,
  canManageClanCommitments,
  canManageClanMembership,
  canManageFiscalPortfolio,
  canManageFiscalOperations,
  canSeeNoticeAcknowledgements,
  canReturnCompanyFlow,
  canUpdateFiscalControl,
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
      expect(canManageClanMembership({ role })).toBe(true);
    },
  );

  // Revoga a Decisão 7 (2026-08-18): entrar/sair de clã define o que a pessoa
  // vê, então nem o líder do próprio clã mexe nisso.
  test("líder do próprio clã NÃO gerencia mais a composição", () => {
    expect(
      canManageClanMembership({ role: "member" }),
    ).toBe(false);
  });

  test("member comum não gerencia composição", () => {
    expect(
      canManageClanMembership({ role: "member" }),
    ).toBe(false);
  });

  test("nomear líder continua exclusivo de admin/owner", () => {
    expect(canAppointClanLeader({ role: "member" })).toBe(
      false,
    );
    expect(canAppointClanLeader({ role: "admin" })).toBe(
      true,
    );
  });

  test("qualquer integrante ativo distribui missões do próprio clã", () => {
    expect(
      canDistributeClanTasks({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
      }),
    ).toBe(true);
    expect(
      canDistributeClanTasks({
        role: "owner",
        leadsThisClan: false,
        isActiveClanMember: false,
      }),
    ).toBe(true);
    expect(
      canDistributeClanTasks({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: false,
      }),
    ).toBe(false);
  });

  test("qualquer integrante ativo gerencia as rotinas da Contabilidade", () => {
    expect(
      canManageClanCommitments({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
      }),
    ).toBe(true);
  });

  test("qualquer integrante ativo do Societário devolve um Fluxo", () => {
    expect(
      canReturnCompanyFlow({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
        isActiveCorporateMember: true,
        isAssignedToFlow: false,
      }),
    ).toBe(true);
  });
});

describe("carteira fiscal — quem remaneja empresa", () => {
  test("integrante ativo remaneja a carteira do próprio clã", () => {
    expect(
      canManageFiscalPortfolio({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
      }),
    ).toBe(true);
  });

  test.each(["admin", "owner"] as const)("%s remaneja qualquer carteira", (role) => {
    expect(
      canManageFiscalPortfolio({
        role,
        leadsThisClan: false,
        isActiveClanMember: false,
      }),
    ).toBe(true);
  });

  test("member fora do clã não remaneja", () => {
    expect(
      canManageFiscalPortfolio({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: false,
      }),
    ).toBe(false);
  });
});

describe("operação fiscal — ficha, importação e competência", () => {
  test("qualquer integrante ativo gerencia ficha e importação", () => {
    expect(
      canManageFiscalOperations({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
      }),
    ).toBe(true);
    expect(
      canManageFiscalOperations({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: false,
      }),
    ).toBe(false);
  });

  test("integrante atualiza a empresa do snapshot sob sua responsabilidade", () => {
    expect(
      canUpdateFiscalControl({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
      }),
    ).toBe(true);
  });

  test("integrante ativo atualiza snapshot alheio", () => {
    expect(
      canUpdateFiscalControl({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
      }),
    ).toBe(true);
  });

  test("integrante não atualiza controles depois de sair do clã", () => {
    expect(
      canUpdateFiscalControl({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: false,
      }),
    ).toBe(false);
  });

  test("admin e qualquer integrante ativo corrigem qualquer controle", () => {
    expect(
      canUpdateFiscalControl({
        role: "admin",
        leadsThisClan: false,
        isActiveClanMember: false,
      }),
    ).toBe(true);
    expect(
      canUpdateFiscalControl({
        role: "member",
        leadsThisClan: true,
        isActiveClanMember: true,
      }),
    ).toBe(true);
  });

  test("conclusão rápida exige poder de distribuição e vínculo com o clã", () => {
    expect(
      canQuickCompleteUnassignedInformativeTask({
        role: "member",
        leadsThisClan: true,
        isActiveClanMember: true,
        isCustomerSuccessClan: true,
      }),
    ).toBe(true);
    expect(
      canQuickCompleteUnassignedInformativeTask({
        role: "owner",
        leadsThisClan: false,
        isActiveClanMember: false,
        isCustomerSuccessClan: true,
      }),
    ).toBe(false);
    expect(
      canQuickCompleteUnassignedInformativeTask({
        role: "member",
        leadsThisClan: false,
        isActiveClanMember: true,
        isCustomerSuccessClan: true,
      }),
    ).toBe(true);
    expect(
      canQuickCompleteUnassignedInformativeTask({
        role: "member",
        leadsThisClan: true,
        isActiveClanMember: true,
        isCustomerSuccessClan: false,
      }),
    ).toBe(false);
  });
});
