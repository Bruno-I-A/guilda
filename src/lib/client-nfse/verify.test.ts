import { describe, expect, test } from "vitest";

import { dpsConflictMessage, nfseXmlMatchesRequest, nfseXmlMismatch } from "./verify";

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

describe("mensagem do conflito de DPS", () => {
  test("mostra o número da outra nota e só o que difere", () => {
    const xml = XML.replace("<infNFSe>", "<infNFSe><nNFSe>310</nNFSe>");
    const request = { providerCnpj: "33000167000101", takerDocument: "07412545000154", amountCents: 192000 };
    const found = nfseXmlMismatch(xml, request);
    expect(found).toEqual({ nfseNumber: "310", providerCnpj: "33000167000101", takerDocument: "40503119091", amountCents: 15000 });
    const message = dpsConflictMessage({ dpsSeries: "900", dpsNumber: 2, request, found: found! });
    expect(message).toContain("DPS 900/2");
    expect(message).toContain("NFS-e nº 310");
    expect(message).toContain("tomador 40503119091 (este pedido: 07412545000154)");
    expect(message).toMatch(/valor R\$\s150,00 \(este pedido: R\$\s1\.920,00\)/);
    expect(message).not.toContain("prestador");
  });
});
