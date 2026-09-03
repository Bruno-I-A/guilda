import { describe, expect, test } from "vitest";

import {
  accountantChangeMissionPresets,
  companyFlowMissionPresets,
  DIRECT_CLOSURE_MISSION_PRESETS,
} from "./mission-presets";

describe("presets dos informativos estruturados", () => {
  test("mantém as sete missões padrão da baixa direta", () => {
    expect(
      DIRECT_CLOSURE_MISSION_PRESETS.flatMap((preset) => preset.descriptions),
    ).toHaveLength(7);
  });

  test("preenche data e competência nas missões de desligamento", () => {
    const presets = accountantChangeMissionPresets("2026-09-30");
    const descriptions = presets.flatMap((preset) => preset.descriptions);

    expect(descriptions[0]).toContain("30/09/2026");
    expect(descriptions[1]).toContain("09/2026");
  });

  test("não repete a missão do RH quando a baixa do Fluxo já foi verificada", () => {
    const presets = companyFlowMissionPresets({
      kind: "closure",
      amendmentRequiresExternalRegistration: false,
      rhVerificationConfirmed: true,
      billingAmount: null,
      billingDescription: null,
    });

    expect(presets.some((preset) => preset.clanSlug === "rh")).toBe(false);
    expect(presets.flatMap((preset) => preset.descriptions)).toHaveLength(6);
  });

  test("inclui a cobrança estruturada do Fluxo no Financeiro", () => {
    const presets = companyFlowMissionPresets({
      kind: "amendment",
      amendmentRequiresExternalRegistration: false,
      rhVerificationConfirmed: false,
      billingAmount: "150.00",
      billingDescription: "Alteração contratual",
    });

    expect(presets).toEqual([
      expect.objectContaining({
        clanSlug: "financeiro",
        descriptions: [expect.stringContaining("R$ 150,00")],
      }),
    ]);
  });
});
