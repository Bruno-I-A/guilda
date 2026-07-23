import { describe, expect, it } from "vitest";

import { periodsForCadence } from "./closings-ui";

describe("periodsForCadence", () => {
  it("expõe os quatro períodos para empresas trimestrais", () => {
    expect(periodsForCadence("quarterly")).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("expõe somente o fechamento anual para empresas anuais", () => {
    expect(periodsForCadence("annual")).toEqual(["annual"]);
  });
});
