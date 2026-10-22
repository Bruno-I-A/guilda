import { describe, expect, test } from "vitest";

import { nfseXmlMatchesRequest } from "./verify";

const XML = `<NFSe><infNFSe><DPS><infDPS><prest><CNPJ>33000167000101</CNPJ></prest><toma><CPF>40503119091</CPF><xNome>João</xNome></toma><valores><vServPrest><vServ>150.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;

describe("nota achada pela DPS", () => {
  test("é a nossa quando prestador, tomador e valor batem", () => {
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "33000167000101", takerDocument: "40503119091", amountCents: 15000 })).toBe(true);
  });

  test("é de outro sistema quando qualquer um difere", () => {
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "33000167000101", takerDocument: "40503119091", amountCents: 15001 })).toBe(false);
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "33000167000101", takerDocument: "33000167000101", amountCents: 15000 })).toBe(false);
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "07412545000154", takerDocument: "40503119091", amountCents: 15000 })).toBe(false);
  });
});
