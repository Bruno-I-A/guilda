import { SignedXml } from "xml-crypto";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

export interface NfseSigningKey {
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Assinatura do padrão nacional: XMLDSIG envelopada no elemento que tem o
 * Id (infDPS ou infPedReg), RSA-SHA256, digest SHA-256, transforms
 * enveloped + C14N. O Signature entra logo depois do elemento assinado.
 */
export function signNfseXml(
  xml: string,
  elementName: "infDPS" | "infPedReg",
  key: NfseSigningKey,
): string {
  const xpath = `//*[local-name(.)='${elementName}']`;
  const signer = new SignedXml({
    privateKey: key.privateKeyPem,
    publicCert: key.certificatePem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: C14N,
  });
  signer.addReference({ xpath, digestAlgorithm: SHA256, transforms: [ENVELOPED, C14N] });
  signer.computeSignature(xml, { location: { reference: xpath, action: "after" } });
  return signer.getSignedXml();
}
