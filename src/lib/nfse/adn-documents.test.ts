import { describe, expect, test } from "vitest";

import { readAdnDocument } from "./adn-documents";
import { testEventXml } from "./testing/adn";
import { TEST_ACCESS_KEY, testNfseXml } from "./testing/nfse-xml";

// Na fixture, o prestador é 11222333000181 e o tomador 33000167000101.
describe("documentos da distribuição do ADN", () => {
  test("NFS-e que a empresa emitiu entra, com número, emissão e competência", () => {
    expect(readAdnDocument(testNfseXml(), "11222333000181")).toEqual({
      kind: "issued",
      accessKey: TEST_ACCESS_KEY,
      nfseNumber: "107",
      issuedAt: new Date("2026-10-15T11:02:31-03:00"),
      competence: "2026-10-15",
    });
  });

  test("NFS-e em que a empresa é tomadora fica de fora", () => {
    expect(readAdnDocument(testNfseXml(), "33000167000101")).toEqual({ kind: "ignored" });
  });

  test("NFS-e com chave fora do padrão fica de fora", () => {
    const xml = testNfseXml().replace(`Id="NFS${TEST_ACCESS_KEY}"`, `Id="NFS${TEST_ACCESS_KEY.slice(1)}"`);
    expect(xml).not.toBe(testNfseXml());
    expect(readAdnDocument(xml, "11222333000181")).toEqual({ kind: "ignored" });
  });

  test("NFS-e sem número entra com nfseNumber nulo", () => {
    const xml = testNfseXml().replace("<nNFSe>107</nNFSe>", "");
    expect(xml).not.toContain("<nNFSe>");
    expect(readAdnDocument(xml, "11222333000181")).toMatchObject({ kind: "issued", nfseNumber: null });
  });

  test("competência fora do formato AAAA-MM-DD vira nula, para não quebrar a coluna date", () => {
    const xml = testNfseXml().replace("<dCompet>2026-10-15</dCompet>", "<dCompet>15/10/2026</dCompet>");
    expect(xml).toContain("15/10/2026");
    expect(readAdnDocument(xml, "11222333000181")).toMatchObject({ kind: "issued", competence: null });
  });

  test("cancelamento, por substituição, deferido e de ofício contam; indeferido não", () => {
    for (const code of ["e101101", "e105102", "e105104", "e305101"]) {
      expect(readAdnDocument(testEventXml(TEST_ACCESS_KEY, code), "11222333000181")).toEqual({
        kind: "cancellation",
        accessKey: TEST_ACCESS_KEY,
        cancelledAt: new Date("2026-10-20T10:00:00-03:00"),
      });
    }
    expect(readAdnDocument(testEventXml(TEST_ACCESS_KEY, "e105105"), "11222333000181")).toEqual({ kind: "ignored" });
  });

  test("evento sem chave da nota fica de fora", () => {
    const xml = testEventXml(TEST_ACCESS_KEY).replace(`<chNFSe>${TEST_ACCESS_KEY}</chNFSe>`, "");
    expect(xml).not.toContain("chNFSe");
    expect(readAdnDocument(xml, "11222333000181")).toEqual({ kind: "ignored" });
  });

  test("XML estranho fica de fora", () => {
    expect(readAdnDocument("não é xml", "11222333000181")).toEqual({ kind: "ignored" });
  });
});
