import { describe, expect, test } from "vitest";

import { buildDpsXml, type DpsInput } from "./dps-xml";
import type { NfseTemplate } from "./template";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { nfseXsdErrors } from "./testing/xsd";

const template = TEST_TEMPLATE;

function input(overrides: Partial<DpsInput> = {}): DpsInput {
  return {
    environment: 2,
    issuedAt: "2026-10-05T09:15:00-03:00",
    competenceDate: "2026-09-30",
    series: "1",
    number: 37,
    providerCnpj: "11222333000181",
    template,
    taker: { cnpj: "33000167000101", name: "  Padaria   Pão & Cia  " },
    amountCents: 85050,
    description: "Honorários contábeis referentes à competência 09/2026.",
    ...overrides,
  };
}

describe("XML da DPS", () => {
  test("é válido contra o XSD oficial v1.01 (Simples, com %SN)", async () => {
    const { id, xml } = buildDpsXml(input());
    expect(id).toBe("DPS431490221122233300018100001000000000000037");
    expect(id).toHaveLength(45);
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("é válido sem total de tributos e sem campos opcionais", async () => {
    const minimal: NfseTemplate = {
      ...TEST_TEMPLATE,
      municipalRegistration: undefined,
      taxRegime: { opSimpNac: "1", regEspTrib: "0" },
      totalTaxes: { kind: "none" },
    };
    const { xml } = buildDpsXml(input({ template: minimal }));
    expect(xml).toContain("<indTotTrib>0</indTotTrib>");
    expect(xml).not.toContain("<IM>");
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("normaliza o nome do tomador e escapa o texto", () => {
    const { xml } = buildDpsXml(input());
    expect(xml).toContain("<xNome>Padaria Pão &amp; Cia</xNome>");
    expect(xml).toContain("<vServ>850.50</vServ>");
    expect(xml).toContain("<tpEmit>1</tpEmit>");
  });
});
