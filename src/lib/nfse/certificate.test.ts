import { describe, expect, test } from "vitest";

import { loadNfseCertificate, NfseCertificateError } from "./certificate";
import { createTestCertificate } from "./testing/certificate";

describe("certificado A1", () => {
  const sample = createTestCertificate();

  test("abre o pfx e extrai CNPJ, validade, chave e cadeia", () => {
    const loaded = loadNfseCertificate(sample.pfxBase64, sample.password);
    expect(loaded.cnpj).toBe("11222333000181");
    expect(loaded.validUntil.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(loaded.privateKeyPem).toContain("BEGIN RSA PRIVATE KEY");
    expect(loaded.certificatePem).toContain("BEGIN CERTIFICATE");
    expect(loaded.chainPem).toContain(loaded.certificatePem.trim());
  });

  test("senha errada vira mensagem legível", () => {
    expect(() => loadNfseCertificate(sample.pfxBase64, "errada")).toThrow(NfseCertificateError);
  });

  test("certificado sem CNPJ no CN é recusado", () => {
    const other = createTestCertificate({ commonName: "PESSOA FISICA:12345678909" });
    expect(() => loadNfseCertificate(other.pfxBase64, other.password)).toThrow(/CNPJ/);
  });
});
