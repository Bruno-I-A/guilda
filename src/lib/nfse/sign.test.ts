import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { describe, expect, test } from "vitest";

import { buildDpsXml } from "./dps-xml";
import { signNfseXml } from "./sign";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { createTestCertificate } from "./testing/certificate";
import { nfseXsdErrors } from "./testing/xsd";

const DSIG = "http://www.w3.org/2000/09/xmldsig#";

function verify(signed: string, certificatePem: string): boolean {
  const doc = new DOMParser().parseFromString(signed, "text/xml");
  const node = doc.getElementsByTagNameNS(DSIG, "Signature")[0];
  const verifier = new SignedXml({ publicCert: certificatePem });
  verifier.loadSignature(node as unknown as Node);
  return verifier.checkSignature(signed);
}

describe("assinatura XMLDSIG", () => {
  const cert = createTestCertificate();
  const { xml } = buildDpsXml({
    environment: 2,
    issuedAt: "2026-10-05T09:15:00-03:00",
    competenceDate: "2026-09-30",
    series: "1",
    number: 1,
    providerCnpj: "11222333000181",
    template: TEST_TEMPLATE,
    taker: { cnpj: "33000167000101", name: "Padaria" },
    amountCents: 10000,
    description: "Honorários 09/2026.",
  });
  const key = { privateKeyPem: cert.privateKeyPem, certificatePem: cert.certificatePem };

  test("segue o padrão nacional e confere com o certificado", async () => {
    const signed = signNfseXml(xml, "infDPS", key);
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(signed).toMatch(/<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
    expect(signed).toContain("<X509Certificate>");
    expect(verify(signed, cert.certificatePem)).toBe(true);
    expect(await nfseXsdErrors(signed, "DPS_v1.01.xsd")).toEqual([]);
  });

  test("qualquer alteração depois de assinar invalida", () => {
    const tampered = signNfseXml(xml, "infDPS", key).replace("<vServ>100.00</vServ>", "<vServ>1.00</vServ>");
    expect(tampered).not.toBe(signNfseXml(xml, "infDPS", key));
    expect(verify(tampered, cert.certificatePem)).toBe(false);
  });
});
