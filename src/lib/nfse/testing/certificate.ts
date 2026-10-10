import forge from "node-forge";

export interface TestCertificate {
  pfxBase64: string;
  password: string;
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Certificado autoassinado no formato do e-CNPJ (CN termina em ":<CNPJ>"),
 * empacotado em PKCS#12 como um A1. Chave de 1024 bits só para o teste
 * rodar rápido.
 */
export function createTestCertificate(
  options: { commonName?: string; password?: string; notAfter?: Date } = {},
): TestCertificate {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = options.notAfter ?? new Date("2027-01-01T00:00:00Z");
  const attrs = [{ name: "commonName", value: options.commonName ?? "ESCRITORIO TESTE LTDA:11222333000181" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const password = options.password ?? "senha-de-teste";
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return {
    pfxBase64: forge.util.encode64(forge.asn1.toDer(p12).getBytes()),
    password,
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}
