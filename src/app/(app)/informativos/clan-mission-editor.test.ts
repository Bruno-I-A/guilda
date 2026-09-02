import { describe, expect, test } from "vitest";

import {
  clanMissionGroupsAreValid,
  flattenClanMissionGroups,
  type ClanMissionGroupDraft,
} from "./clan-mission-editor";

const groups: ClanMissionGroupDraft[] = [
  {
    id: "fiscal",
    clanId: "clan-fiscal",
    missions: [
      { id: "fiscal-1", description: "Parametrizar a empresa" },
      { id: "fiscal-2", description: "Revisar as notas" },
    ],
  },
  {
    id: "rh",
    clanId: "clan-rh",
    missions: [{ id: "rh-1", description: "Cadastrar o pró-labore" }],
  },
];

describe("editor de missões por clã", () => {
  test("escolhe o clã uma vez e expande todas as missões para o servidor", () => {
    expect(flattenClanMissionGroups(groups)).toEqual([
      { clanId: "clan-fiscal", description: "Parametrizar a empresa" },
      { clanId: "clan-fiscal", description: "Revisar as notas" },
      { clanId: "clan-rh", description: "Cadastrar o pró-labore" },
    ]);
  });

  test("exige clã e descrição em todas as linhas", () => {
    expect(clanMissionGroupsAreValid(groups)).toBe(true);
    expect(
      clanMissionGroupsAreValid([
        ...groups,
        {
          id: "sem-cla",
          clanId: "",
          missions: [{ id: "sem-cla-1", description: "Missão válida" }],
        },
      ]),
    ).toBe(false);
  });
});
