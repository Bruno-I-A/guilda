import { describe, expect, test } from "vitest";

import { dpsConflictMessage, issuedBeforeRequest, nfseXmlMatchesRequest, nfseXmlMismatch } from "./verify";

const REQUESTED = new Date("2026-11-04T12:00:00Z");
const XML = `<NFSe><infNFSe><DPS><infDPS><prest><CNPJ>33000167000101</CNPJ></prest><toma><CPF>40503119091</CPF><xNome>João</xNome></toma><valores><vServPrest><vServ>150.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;

describe("nota achada pela DPS", () => {
  test("é a nossa quando prestador, tomador e valor batem", () => {
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "33000167000101", takerDocument: "40503119091", amountCents: 15000, requestedAt: REQUESTED })).toBe(true);
  });

  test("é de outro sistema quando qualquer um difere", () => {
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "33000167000101", takerDocument: "40503119091", amountCents: 15001, requestedAt: REQUESTED })).toBe(false);
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "33000167000101", takerDocument: "33000167000101", amountCents: 15000, requestedAt: REQUESTED })).toBe(false);
    expect(nfseXmlMatchesRequest(XML, { providerCnpj: "07412545000154", takerDocument: "40503119091", amountCents: 15000, requestedAt: REQUESTED })).toBe(false);
  });
});

describe("mensagem do conflito de DPS", () => {
  test("mostra o número da outra nota e só o que difere", () => {
    const xml = XML.replace("<infNFSe>", "<infNFSe><nNFSe>310</nNFSe>");
    const request = { providerCnpj: "33000167000101", takerDocument: "07412545000154", amountCents: 192000, requestedAt: REQUESTED };
    const found = nfseXmlMismatch(xml, request);
    expect(found).toEqual({ nfseNumber: "310", providerCnpj: "33000167000101", takerDocument: "40503119091", amountCents: 15000, issuedAt: null });
    const message = dpsConflictMessage({ dpsSeries: "900", dpsNumber: 2, request, found: found! });
    expect(message).toContain("DPS 900/2");
    expect(message).toContain("NFS-e nº 310");
    expect(message).toContain("tomador 40503119091 (este pedido: 07412545000154)");
    expect(message).toMatch(/valor R\$\s150,00 \(este pedido: R\$\s1\.920,00\)/);
    expect(message).not.toContain("prestador");
  });
});

describe("nota recorrente com a DPS de uma nota antiga", () => {
  const OLD = XML.replace("<infDPS>", "<infDPS><dhEmi>2024-02-01T16:57:28-03:00</dhEmi>");
  const request = { providerCnpj: "33000167000101", takerDocument: "40503119091", amountCents: 15000, requestedAt: REQUESTED };

  test("tudo igual, mas emitida antes do pedido: não é a nossa", () => {
    const found = nfseXmlMismatch(OLD, request);
    expect(found?.issuedAt).toEqual(new Date("2024-02-01T19:57:28Z"));
    expect(dpsConflictMessage({ dpsSeries: "900", dpsNumber: 1, request, found: found! })).toContain("emitida em 01/02/2024, antes deste pedido");
  });

  test("emitida depois do pedido (a tentativa anterior caiu no envio): é a nossa", () => {
    const recovered = XML.replace("<infDPS>", "<infDPS><dhEmi>2026-11-04T09:30:00-03:00</dhEmi>");
    expect(nfseXmlMismatch(recovered, request)).toBeNull();
  });

  test("folga de relógio de uma hora", () => {
    expect(issuedBeforeRequest(new Date("2026-11-04T11:30:00Z"), REQUESTED)).toBe(false);
    expect(issuedBeforeRequest(new Date("2026-11-04T10:30:00Z"), REQUESTED)).toBe(true);
    expect(issuedBeforeRequest(null, REQUESTED)).toBe(false);
  });
});
