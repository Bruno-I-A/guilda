import { describe, expect, test } from "vitest";

import {
  hasNfseRetentions,
  NO_NFSE_RETENTIONS,
  nfseRetentionGroups,
  pisCofinsRetentionCode,
  retentionBreakdown,
  retentionCents,
} from "./nfse-retentions";

describe("retenções da NFS-e", () => {
  test("valor retido é o percentual sobre o serviço, ao centavo", () => {
    expect(retentionCents(137_880, "1.50")).toBe(2068);
    expect(retentionCents(100_000, "4.65")).toBe(4650);
    expect(retentionCents(33, "1.00")).toBe(0);
  });

  test("tabela do tpRetPisCofins", () => {
    expect(pisCofinsRetentionCode(false, false, false)).toBe("0");
    expect(pisCofinsRetentionCode(true, true, true)).toBe("3");
    expect(pisCofinsRetentionCode(true, true, false)).toBe("4");
    expect(pisCofinsRetentionCode(false, false, true)).toBe("8");
  });

  test("sem retenção não gera grupo federal", () => {
    expect(hasNfseRetentions(NO_NFSE_RETENTIONS)).toBe(false);
    expect(nfseRetentionGroups(NO_NFSE_RETENTIONS, 100_000)).toEqual({ issWithheld: false, issRate: null, federal: null });
  });

  test("ISS retido e as federais dos 4,65% + IR", () => {
    const retentions = { ...NO_NFSE_RETENTIONS, issWithheld: true, issRate: "2", irrf: "1.5", pis: "0.65", cofins: "3", csll: "1" };
    expect(hasNfseRetentions(retentions)).toBe(true);
    expect(nfseRetentionGroups(retentions, 100_000)).toEqual({
      issWithheld: true,
      issRate: "2.00",
      federal: {
        irrfCents: 1500,
        csllCents: 1000,
        pisCofins: { cst: "01", baseCents: 100_000, pisPercent: "0.65", cofinsPercent: "3.00", pisCents: 650, cofinsCents: 3000, retention: "3" },
      },
    });
    expect(retentionBreakdown(retentions, 100_000).map((line) => [line.label, line.cents])).toEqual([
      ["ISS 2,00%", 2000],
      ["IR 1,50%", 1500],
      ["PIS 0,65%", 650],
      ["COFINS 3,00%", 3000],
      ["CSLL 1,00%", 1000],
    ]);
  });
});
