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

  test("empresa-cliente não optante: outro CNPJ e tributos por esfera passam no XSD", async () => {
    const presumido: NfseTemplate = {
      ...TEST_TEMPLATE,
      taxRegime: { opSimpNac: "1", regEspTrib: "0" },
      totalTaxes: { kind: "percent", federal: "13.45", state: "0", municipal: "3.00" },
    };
    const { id, xml } = buildDpsXml(input({ template: presumido, providerCnpj: "33000167000101", series: "3", number: 1 }));
    expect(id).toBe("DPS431490223300016700010100003000000000000001");
    expect(xml).toContain("<pTotTrib><pTotTribFed>13.45</pTotTribFed><pTotTribEst>0</pTotTribEst><pTotTribMun>3.00</pTotTribMun></pTotTrib>");
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("retenções: ISS retido pelo tomador e federais (PIS/COFINS/CSLL, IR, INSS) passam no XSD", async () => {
    const template: NfseTemplate = {
      ...TEST_TEMPLATE,
      issqn: { taxation: "1", withholding: "2", rate: "2.00" },
      federal: {
        cpCents: 11000,
        irrfCents: 1500,
        csllCents: 1000,
        pisCofins: { cst: "01", baseCents: 100000, pisPercent: "0.65", cofinsPercent: "3.00", pisCents: 650, cofinsCents: 3000, retention: "3" },
      },
    };
    const { xml } = buildDpsXml(input({ template, amountCents: 100000 }));
    expect(xml).toContain("<tpRetISSQN>2</tpRetISSQN><pAliq>2.00</pAliq>");
    expect(xml).toContain("<tribFed><piscofins><CST>01</CST><vBCPisCofins>1000.00</vBCPisCofins>");
    expect(xml).toContain("<vRetCP>110.00</vRetCP><vRetIRRF>15.00</vRetIRRF><vRetCSLL>10.00</vRetCSLL></tribFed>");
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("E0903: o tipo de operação vai no grupo IBS/CBS, na ordem do XSD", async () => {
    const template: NfseTemplate = { ...TEST_TEMPLATE, service: { nationalTaxCode: "171201" }, ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052", operationType: "5" } };
    const { xml } = buildDpsXml(input({ template, taker: { cnpj: "33000167000101", name: "Tomador", address: { cityCode: "4308904", zipCode: "99900000", street: "Rua A", number: "1", complement: null, district: "Centro" } } }));
    expect(xml).toContain("<cIndOp>100301</cIndOp><tpOper>5</tpOper><indDest>0</indDest>");
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("E0904: serviço fora da lista não leva o tipo de operação, mesmo com ele na empresa", async () => {
    const template: NfseTemplate = { ...TEST_TEMPLATE, service: { nationalTaxCode: "171901" }, ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052", operationType: "5" } };
    const { xml } = buildDpsXml(input({ template, taker: { cnpj: "33000167000101", name: "Tomador", address: { cityCode: "4308904", zipCode: "99900000", street: "Rua A", number: "1", complement: null, district: "Centro" } } }));
    expect(xml).not.toContain("<tpOper>");
    expect(xml).toContain("<cIndOp>100301</cIndOp><indDest>0</indDest>");
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("alíquota do ISS: só o Simples com retenção leva (E0625 sem retenção, E0617 não optante)", () => {
    const withRate = (overrides: Partial<NfseTemplate>) => buildDpsXml(input({ template: { ...TEST_TEMPLATE, issqn: { taxation: "1", withholding: "1", rate: "2.00" }, ...overrides } })).xml;
    expect(withRate({})).not.toContain("<pAliq>");
    expect(withRate({ issqn: { taxation: "1", withholding: "2", rate: "2.00" } })).toContain("<pAliq>2.00</pAliq>");
    expect(withRate({ taxRegime: { opSimpNac: "1", regEspTrib: "0" } })).not.toContain("<pAliq>");
    expect(withRate({ taxRegime: { opSimpNac: "1", regEspTrib: "0" }, issqn: { taxation: "1", withholding: "2", rate: "2.00" } })).not.toContain("<pAliq>");
  });

  test("tomador pessoa física (produtor rural) vai com CPF e passa no XSD", async () => {
    const { xml } = buildDpsXml(input({ taker: { cnpj: "40503119091", name: "Pedro Rodighiero" } }));
    expect(xml).toContain("<toma><CPF>40503119091</CPF><xNome>Pedro Rodighiero</xNome></toma>");
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

  test("é válido com os códigos da nota real do escritório (municipal, NBS e IBS/CBS)", async () => {
    // Códigos da nota 104 de 08/10/2026, emitida no Portal: 17.19.01 / 001,
    // NBS 1.1302.21.00, IBS/CBS com indicador 100301, CST 200 e cClassTrib 200052.
    const officeModel: NfseTemplate = {
      ...TEST_TEMPLATE,
      service: { nationalTaxCode: "171901", municipalTaxCode: "001", nbsCode: "113022100" },
      totalTaxes: { kind: "none" },
      ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052" },
    };
    const { xml } = buildDpsXml(
      input({
        template: officeModel,
        taker: {
          cnpj: "33000167000101",
          name: "Padaria",
          address: { cityCode: "4308904", zipCode: "99900000", street: "RUA EDITH KURTZ", number: "871", complement: null, district: "SANTO ANDRE" },
        },
      }),
    );
    expect(xml).toContain(
      "<toma><CNPJ>33000167000101</CNPJ><xNome>Padaria</xNome><end><endNac><cMun>4308904</cMun><CEP>99900000</CEP></endNac><xLgr>RUA EDITH KURTZ</xLgr><nro>871</nro><xBairro>SANTO ANDRE</xBairro></end></toma>",
    );
    expect(xml).toContain("<cTribMun>001</cTribMun>");
    expect(xml).toContain("<cNBS>113022100</cNBS>");
    expect(xml).toContain(
      "<IBSCBS><finNFSe>0</finNFSe><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>200</CST><cClassTrib>200052</cClassTrib></gIBSCBS></trib></valores></IBSCBS></infDPS>",
    );
    expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("normaliza o nome do tomador e escapa o texto", () => {
    const { xml } = buildDpsXml(input());
    expect(xml).toContain("<xNome>Padaria Pão &amp; Cia</xNome>");
    expect(xml).toContain("<vServ>850.50</vServ>");
    expect(xml).toContain("<tpEmit>1</tpEmit>");
  });
});
