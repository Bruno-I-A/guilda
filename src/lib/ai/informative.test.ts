import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveInformativeClan } from "./informative";

const clans = [
  { id: "fiscal", name: "Fiscal" },
  { id: "accounting", name: "Contabilidade" },
];

describe("resolveInformativeClan", () => {
  it("resolve somente nome completo ignorando acentos e caixa", () => {
    expect(resolveInformativeClan("CONTABILIDADE", clans)).toEqual(clans[1]);
  });

  it("recusa trecho parcial, nome inexistente e duplicidade normalizada", () => {
    expect(resolveInformativeClan("Contab", clans)).toBeNull();
    expect(resolveInformativeClan("RH", clans)).toBeNull();
    expect(
      resolveInformativeClan("Fiscal", [
        ...clans,
        { id: "fiscal-duplicate", name: "físcal" },
      ]),
    ).toBeNull();
  });
});
