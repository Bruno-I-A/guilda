import { generateKeyPairSync } from "node:crypto";

import { describe, expect, test } from "vitest";

import { checkClientCertificate } from "./certificate-check";
import { createTestCertificate } from "./testing/certificate";
import { loadVaultKey } from "./vault";
import { sealCertificate } from "./vault-browser";

function testVaultKey() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return loadVaultKey(Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64"));
}

const vault = testVaultKey();

async function envelopeFor(pfxBase64: string, password: string, key = vault) {
  return sealCertificate({ publicKeySpki: key.publicKeySpki, keyId: key.keyId, pfx: Buffer.from(pfxBase64, "base64"), password });
}

describe("conferência do certificado da empresa", () => {
  const cert = createTestCertificate({ commonName: "PADARIA LTDA:33000167000101" });

  test("válido: CNPJ e validade", async () => {
    const result = checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, cert.password), clientCnpj: "33000167000282" });
    expect(result).toEqual({ status: "valid", cnpj: "33000167000101", validUntil: new Date("2027-01-01T00:00:00Z") });
  });

  test("senha errada, outro CNPJ e empresa sem CNPJ", async () => {
    expect(checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, "errada"), clientCnpj: "33000167000101" })).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("senha errada"),
    });
    expect(checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, cert.password), clientCnpj: "11222333000181" })).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("33.000.167/0001-01"),
    });
    expect(checkClientCertificate({ vault, envelope: await envelopeFor(cert.pfxBase64, cert.password), clientCnpj: null })).toMatchObject({
      status: "invalid",
    });
  });

  test("envelope cifrado para outra chave do cofre é recusado com a mensagem do cofre", async () => {
    const envelope = await envelopeFor(cert.pfxBase64, cert.password, testVaultKey());
    expect(checkClientCertificate({ vault, envelope, clientCnpj: "33000167000101" })).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("outra chave"),
    });
  });

  test("certificado já vencido continua válido na conferência: o vencimento sai da validade, não do status", async () => {
    // O "vencido" não é gravado: a conferência só diz que o arquivo abre e
    // bate com a empresa, e devolve a validade. Quem decide mostrar "vencido"
    // é o certificateState (src/domain/nfse-xml.ts), comparando com a data de hoje.
    const expired = createTestCertificate({ commonName: "PADARIA LTDA:33000167000101", notAfter: new Date("2026-01-02T00:00:00Z") });
    const result = checkClientCertificate({ vault, envelope: await envelopeFor(expired.pfxBase64, expired.password), clientCnpj: "33000167000101" });
    expect(result).toEqual({ status: "valid", cnpj: "33000167000101", validUntil: new Date("2026-01-02T00:00:00Z") });
  });
});
