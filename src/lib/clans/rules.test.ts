import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORGANIZATION_CLANS,
  DEFAULT_PRIMARY_CLAN_SLUG,
  buildDefaultLeaderMemberships,
  memberRemovalBlockReason,
  organizationRoleIncludesOwner,
} from "./rules";

describe("bootstrap padrão de clãs", () => {
  it("mantém os seis slugs estáveis e somente Contabilidade como principal", () => {
    expect(DEFAULT_ORGANIZATION_CLANS).toEqual([
      { name: "Fiscal", slug: "fiscal" },
      { name: "Contabilidade", slug: "contabilidade" },
      { name: "RH", slug: "rh" },
      { name: "Societário", slug: "societario" },
      { name: "Financeiro", slug: "financeiro" },
      { name: "Sucesso do Cliente", slug: "sucesso-do-cliente" },
    ]);
    expect(
      DEFAULT_ORGANIZATION_CLANS.filter(
        ({ slug }) => slug === DEFAULT_PRIMARY_CLAN_SLUG,
      ),
    ).toHaveLength(1);
  });

  it("vincula o criador como líder dos seis e marca um único principal", () => {
    const rows = buildDefaultLeaderMemberships(
      "org-1",
      "owner-1",
      DEFAULT_ORGANIZATION_CLANS.map(({ slug }, index) => ({
        id: `clan-${index + 1}`,
        slug,
      })),
    );

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.isLeader)).toBe(true);
    expect(rows.every((row) => row.orgId === "org-1")).toBe(true);
    expect(rows.every((row) => row.userId === "owner-1")).toBe(true);
    expect(rows.filter((row) => row.isPrimary)).toEqual([
      expect.objectContaining({ clanId: "clan-2" }),
    ]);
  });
});

describe("invariantes de remoção de membro", () => {
  it("permite remover quem não tem missões nem liderança exclusiva", () => {
    expect(
      memberRemovalBlockReason({
        activeAssignedTaskCount: 0,
        soleLeaderClanNames: [],
      }),
    ).toBeNull();
  });

  it("pede transferência das missões ativas", () => {
    expect(
      memberRemovalBlockReason({
        activeAssignedTaskCount: 2,
        soleLeaderClanNames: [],
      }),
    ).toContain("transfira 2 missões ativas");
  });

  it("lista os clãs ativos que ficariam sem líder", () => {
    const reason = memberRemovalBlockReason({
      activeAssignedTaskCount: 0,
      soleLeaderClanNames: ["Fiscal", "Contabilidade"],
    });

    expect(reason).toContain("defina outro líder");
    expect(reason).toContain("Contabilidade, Fiscal");
  });

  it("combina os dois impedimentos em uma mensagem acionável", () => {
    const reason = memberRemovalBlockReason({
      activeAssignedTaskCount: 1,
      soleLeaderClanNames: ["RH"],
    });

    expect(reason).toContain("transfira 1 missão ativa");
    expect(reason).toContain("defina outro líder para o clã RH");
  });
});

describe("reconciliação das organizações do owner", () => {
  it.each(["owner", "admin, owner", "owner,member"])(
    "reconhece owner em %s",
    (role) => expect(organizationRoleIncludesOwner(role)).toBe(true),
  );

  it.each(["member", "admin", "member,admin"])(
    "não promove %s durante a reconciliação",
    (role) => expect(organizationRoleIncludesOwner(role)).toBe(false),
  );
});
