import { describe, expect, test } from "vitest";

import {
  canViewClan,
  filterVisibleClans,
  resolveClanEntry,
} from "./clan-access";

const CLANS = [{ id: "fiscal" }, { id: "contabil" }, { id: "rh" }];

describe("visibilidade de clã", () => {
  test("member vê apenas os clãs em que tem vínculo", () => {
    const viewer = { role: "member", memberClanIds: ["fiscal"] } as const;
    expect(canViewClan(viewer, "fiscal")).toBe(true);
    expect(canViewClan(viewer, "rh")).toBe(false);
    expect(filterVisibleClans(viewer, CLANS)).toEqual([{ id: "fiscal" }]);
  });

  test.each(["admin", "owner"] as const)("%s vê a Guilda inteira", (role) => {
    const viewer = { role, memberClanIds: [] } as const;
    expect(canViewClan(viewer, "rh")).toBe(true);
    expect(filterVisibleClans(viewer, CLANS)).toHaveLength(3);
  });

  test("member sem vínculo não vê clã algum", () => {
    const viewer = { role: "member", memberClanIds: [] } as const;
    expect(canViewClan(viewer, "fiscal")).toBe(false);
    expect(filterVisibleClans(viewer, CLANS)).toEqual([]);
  });
});

describe("entrada da aba Clãs", () => {
  test("um clã só abre direto, sem listagem de um item", () => {
    expect(
      resolveClanEntry({ role: "member", memberClanIds: ["fiscal"] }),
    ).toEqual({ outcome: "clan", clanId: "fiscal" });
  });

  test("vínculo repetido não conta como dois clãs", () => {
    expect(
      resolveClanEntry({ role: "member", memberClanIds: ["fiscal", "fiscal"] }),
    ).toEqual({ outcome: "clan", clanId: "fiscal" });
  });

  test("mais de um clã mostra a listagem", () => {
    expect(
      resolveClanEntry({ role: "member", memberClanIds: ["fiscal", "rh"] }),
    ).toEqual({ outcome: "list" });
  });

  test("sem vínculo devolve none — a página explica em vez de quebrar", () => {
    expect(resolveClanEntry({ role: "member", memberClanIds: [] })).toEqual({
      outcome: "none",
    });
  });

  test.each(["admin", "owner"] as const)(
    "%s cai na listagem mesmo com um vínculo só",
    (role) => {
      expect(resolveClanEntry({ role, memberClanIds: ["fiscal"] })).toEqual({
        outcome: "list",
      });
    },
  );
});
