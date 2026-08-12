import { describe, expect, it } from "vitest";

import { resolveMemberName } from "./member-resolution";

const members = [
  { userId: "1", name: "Bruno Moravski" },
  { userId: "2", name: "Camila Schütz" },
  { userId: "3", name: "Carolina Silva" },
];

describe("resolveMemberName", () => {
  it("resolve nome completo sem depender de acentos ou caixa", () => {
    expect(resolveMemberName("camila schutz", members)).toEqual(members[1]);
  });

  it("resolve primeiro nome quando ele é único", () => {
    expect(resolveMemberName("Bruno", members)).toEqual(members[0]);
  });

  it("bloqueia abreviações ambíguas e nomes inexistentes", () => {
    const ambiguous = [...members, { userId: "4", name: "Bruno Oliveira" }];
    expect(resolveMemberName("Bruno", ambiguous)).toBeNull();
    expect(resolveMemberName("Fabi", members)).toBeNull();
  });
});
