import { describe, expect, test } from "vitest";

import { buildDpsXml, nfseLayoutFor, NT009_PRODUCTION_START, type DpsInput, type NfseLayout } from "./dps-xml";
import type { NfseTemplate } from "./template";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { nfseXsdErrors, type XsdSet } from "./testing/xsd";

const template = TEST_TEMPLATE;
const address = { cityCode: "4308904", zipCode: "99900000", street: "Rua A", number: "1", complement: null, district: "Centro" };

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

/** Cada caso vale nos dois leiautes, validado contra o XSD oficial de cada um. */
const LAYOUTS: [NfseLayout, XsdSet][] = [
  ["nt004", "1.01"],
  ["nt009", "nt009"],
];

describe.each(LAYOUTS)("XML da DPS no leiaute %s (XSD %s)", (layout, xsd) => {
  const build = (overrides: Partial<DpsInput> = {}) => buildDpsXml(input({ layout, ...overrides }));
  const valid = async (xml: string) => expect(await nfseXsdErrors(xml, "DPS_v1.01.xsd", xsd)).toEqual([]);

  test("é válido contra o XSD oficial v1.01 (Simples, com %SN)", async () => {
    const { id, xml } = build();
    expect(id).toBe("DPS431490221122233300018100001000000000000037");
    expect(id).toHaveLength(45);
    await valid(xml);
  });

  test("empresa-cliente não optante: outro CNPJ e tributos por esfera passam no XSD", async () => {
    const presumido: NfseTemplate = {
      ...TEST_TEMPLATE,
      taxRegime: { opSimpNac: "1", regEspTrib: "0" },
      totalTaxes: { kind: "percent", federal: "13.45", state: "0", municipal: "3.00" },
    };
    const { id, xml } = build({ template: presumido, providerCnpj: "33000167000101", series: "3", number: 1 });
    expect(id).toBe("DPS431490223300016700010100003000000000000001");
    expect(xml).toContain("<pTotTrib><pTotTribFed>13.45</pTotTribFed><pTotTribEst>0</pTotTribEst><pTotTribMun>3.00</pTotTribMun></pTotTrib>");
    await valid(xml);
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
    const { xml } = build({ template, amountCents: 100000 });
    expect(xml).toContain("<tpRetISSQN>2</tpRetISSQN><pAliq>2.00</pAliq>");
    expect(xml).toContain("<tribFed><piscofins><CST>01</CST><vBCPisCofins>1000.00</vBCPisCofins>");
    expect(xml).toContain("<vRetCP>110.00</vRetCP><vRetIRRF>15.00</vRetIRRF><vRetCSLL>10.00</vRetCSLL></tribFed>");
    await valid(xml);
  });

  test("E0903: o tipo de operação vai no grupo IBS/CBS, na ordem do XSD", async () => {
    const template: NfseTemplate = { ...TEST_TEMPLATE, service: { nationalTaxCode: "171201" }, ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052", operationType: "5" } };
    const { xml } = build({ template, taker: { cnpj: "33000167000101", name: "Tomador", address: { cityCode: "4308904", zipCode: "99900000", street: "Rua A", number: "1", complement: null, district: "Centro" } } });
    expect(xml).toContain("<cIndOp>100301</cIndOp><tpOper>5</tpOper><indDest>0</indDest>");
    await valid(xml);
  });

  test("E0904: serviço fora da lista não leva o tipo de operação, mesmo com ele na empresa", async () => {
    const template: NfseTemplate = { ...TEST_TEMPLATE, service: { nationalTaxCode: "171901" }, ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052", operationType: "5" } };
    const { xml } = build({ template, taker: { cnpj: "33000167000101", name: "Tomador", address: { cityCode: "4308904", zipCode: "99900000", street: "Rua A", number: "1", complement: null, district: "Centro" } } });
    expect(xml).not.toContain("<tpOper>");
    expect(xml).toContain("<cIndOp>100301</cIndOp><indDest>0</indDest>");
    await valid(xml);
  });

  test("alíquota do ISS: só o Simples com retenção leva (E0625 sem retenção, E0617 não optante)", () => {
    const withRate = (overrides: Partial<NfseTemplate>) => build({ template: { ...TEST_TEMPLATE, issqn: { taxation: "1", withholding: "1", rate: "2.00" }, ...overrides } }).xml;
    expect(withRate({})).not.toContain("<pAliq>");
    expect(withRate({ issqn: { taxation: "1", withholding: "2", rate: "2.00" } })).toContain("<pAliq>2.00</pAliq>");
    expect(withRate({ taxRegime: { opSimpNac: "1", regEspTrib: "0" } })).not.toContain("<pAliq>");
    expect(withRate({ taxRegime: { opSimpNac: "1", regEspTrib: "0" }, issqn: { taxation: "1", withholding: "2", rate: "2.00" } })).not.toContain("<pAliq>");
  });

  test("tomador pessoa física (produtor rural) vai com CPF e passa no XSD", async () => {
    const { xml } = build({ taker: { cnpj: "40503119091", name: "Pedro Rodighiero" } });
    expect(xml).toContain("<toma><CPF>40503119091</CPF><xNome>Pedro Rodighiero</xNome></toma>");
    await valid(xml);
  });

  test("é válido sem total de tributos e sem campos opcionais", async () => {
    const minimal: NfseTemplate = {
      ...TEST_TEMPLATE,
      municipalRegistration: undefined,
      taxRegime: { opSimpNac: "1", regEspTrib: "0" },
      totalTaxes: { kind: "none" },
    };
    const { xml } = build({ template: minimal });
    expect(xml).toContain("<indTotTrib>0</indTotTrib>");
    expect(xml).not.toContain("<IM>");
    await valid(xml);
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
    const { xml } = build({
      template: officeModel,
      taker: {
        cnpj: "33000167000101",
        name: "Padaria",
        address: { cityCode: "4308904", zipCode: "99900000", street: "RUA EDITH KURTZ", number: "871", complement: null, district: "SANTO ANDRE" },
      },
    });
    expect(xml).toContain(
      "<toma><CNPJ>33000167000101</CNPJ><xNome>Padaria</xNome><end><endNac><cMun>4308904</cMun><CEP>99900000</CEP></endNac><xLgr>RUA EDITH KURTZ</xLgr><nro>871</nro><xBairro>SANTO ANDRE</xBairro></end></toma>",
    );
    expect(xml).toContain("<cTribMun>001</cTribMun>");
    expect(xml).toContain("<cNBS>113022100</cNBS>");
    await valid(xml);
  });

  test("normaliza o nome do tomador e escapa o texto", () => {
    const { xml } = build();
    expect(xml).toContain("<xNome>Padaria Pão &amp; Cia</xNome>");
    expect(xml).toContain("<vServ>850.50</vServ>");
    expect(xml).toContain("<tpEmit>1</tpEmit>");
  });
});

describe("diferenças da NT 009", () => {
  const officeModel: NfseTemplate = {
    ...TEST_TEMPLATE,
    service: { nationalTaxCode: "171901", municipalTaxCode: "001", nbsCode: "113022100" },
    ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052" },
  };
  const taker = { cnpj: "33000167000101", name: "Padaria", address };

  test("NT 004: finNFSe no IBSCBS, descrição antes do NBS, CST dentro do gIBSCBS", () => {
    const { xml } = buildDpsXml(input({ layout: "nt004", template: officeModel, taker }));
    expect(xml).toContain("<tpEmit>1</tpEmit><cLocEmi>");
    expect(xml).toContain("<cTribMun>001</cTribMun><xDescServ>");
    expect(xml).toContain("</xDescServ><cNBS>113022100</cNBS></cServ>");
    expect(xml).toContain(
      "<IBSCBS><finNFSe>0</finNFSe><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>200</CST><cClassTrib>200052</cClassTrib></gIBSCBS></trib></valores></IBSCBS></infDPS>",
    );
  });

  test("NT 009: finNFSe logo após tpEmit (o E1235 da produção restrita), NBS antes da descrição, CST direto no trib", () => {
    const { xml } = buildDpsXml(input({ layout: "nt009", template: officeModel, taker }));
    expect(xml).toContain("<tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>");
    expect(xml).toContain("<cTribMun>001</cTribMun><cNBS>113022100</cNBS><xDescServ>");
    expect(xml).toContain(
      "<IBSCBS><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><CST>200</CST><cClassTrib>200052</cClassTrib></trib></valores></IBSCBS></infDPS>",
    );
    expect(xml).not.toContain("<gIBSCBS>");
  });

  test("o XSD da NT 009 recusa a DPS antiga do jeito que a produção restrita recusou (cLocEmi no lugar de finNFSe)", async () => {
    const { xml } = buildDpsXml(input({ layout: "nt004" }));
    const errors = await nfseXsdErrors(xml, "DPS_v1.01.xsd", "nt009");
    expect(errors.join(" ")).toMatch(/cLocEmi/);
  });

  test("NT 009 sem IBS/CBS: finNFSe vai mesmo assim (é obrigatório no infDPS)", () => {
    const { xml } = buildDpsXml(input({ layout: "nt009" }));
    expect(xml).toContain("<tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>");
    expect(xml).not.toContain("<IBSCBS>");
  });
});

describe("qual leiaute usar", () => {
  const before = new Date("2026-11-30T23:59:00-03:00");
  test("produção restrita: NT 009 sempre", () => {
    expect(nfseLayoutFor(2, before, undefined)).toBe("nt009");
  });
  test("produção: NT 004 até 30/11/2026, NT 009 a partir de 01/12/2026 00h (Brasília)", () => {
    expect(nfseLayoutFor(1, before, undefined)).toBe("nt004");
    expect(nfseLayoutFor(1, NT009_PRODUCTION_START, undefined)).toBe("nt009");
    // 30/11 22h em Brasília já é 01/12 em UTC, e ainda é NT 004.
    expect(nfseLayoutFor(1, new Date("2026-12-01T01:00:00Z"), undefined)).toBe("nt004");
  });
  test("NFSE_LEIAUTE força o leiaute (governo adiou ou antecipou)", () => {
    expect(nfseLayoutFor(1, before, "nt009")).toBe("nt009");
    expect(nfseLayoutFor(2, before, "nt004")).toBe("nt004");
    expect(nfseLayoutFor(1, before, "outro")).toBe("nt004");
  });
  test("sem informar, a DPS da produção escolhe pela data de emissão", () => {
    const at = (issuedAt: string) => buildDpsXml(input({ environment: 1, issuedAt })).xml;
    expect(at("2026-11-30T10:00:00-03:00")).not.toContain("<finNFSe>");
    expect(at("2026-12-01T08:00:00-03:00")).toContain("<tpEmit>1</tpEmit><finNFSe>0</finNFSe>");
  });
});
