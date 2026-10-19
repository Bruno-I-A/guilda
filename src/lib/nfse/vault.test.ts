import { generateKeyPairSync } from "node:crypto";

import { describe, expect, test } from "vitest";

import { loadVaultKey, VaultError, vaultEnvelopeSchema } from "./vault";
import { sealCertificate } from "./vault-browser";

function testVaultKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64");
}

describe("cofre de certificados", () => {
  test("o envelope cifrado pelo navegador (WebCrypto) abre no serviço", async () => {
    const vault = loadVaultKey(testVaultKey());
    const pfx = new Uint8Array([1, 2, 3, 250, 251]);
    const envelope = await sealCertificate({ publicKeySpki: vault.publicKeySpki, keyId: vault.keyId, pfx, password: "senha ç" });
    expect(vaultEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(vault.open(envelope)).toEqual({ pfx: Buffer.from(pfx).toString("base64"), password: "senha ç" });
  });

  test("outra chave e envelope adulterado são recusados", async () => {
    const vault = loadVaultKey(testVaultKey());
    const other = loadVaultKey(testVaultKey());
    const envelope = await sealCertificate({ publicKeySpki: vault.publicKeySpki, keyId: vault.keyId, pfx: new Uint8Array([7]), password: "x" });
    expect(() => other.open(envelope)).toThrow(VaultError);
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 1;
    expect(() => vault.open({ ...envelope, ciphertext: bytes.toString("base64") })).toThrow(VaultError);
  });

  test("envelope com o keyId certo mas a chave embrulhada de outra chave é recusado sem vazar a senha", async () => {
    const vault = loadVaultKey(testVaultKey());
    const other = loadVaultKey(testVaultKey());
    const password = "senha-super-secreta-123";
    // Cifrado com a pública de "other", mas com o keyId trocado para o de "vault".
    const forged = await sealCertificate({
      publicKeySpki: other.publicKeySpki,
      keyId: vault.keyId,
      pfx: new Uint8Array([9, 8, 7]),
      password,
    });
    let message = "";
    try {
      vault.open(forged);
    } catch (error) {
      expect(error).toBeInstanceOf(VaultError);
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(password);
  });

  test("loadVaultKey recusa chave que não é RSA", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecKey = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64");
    expect(() => loadVaultKey(ecKey)).toThrow("NFSE_VAULT_PRIVATE_KEY inválida.");
  });

  test("IV fora do tamanho do GCM e texto cifrado sem conteúdo além da tag são recusados", async () => {
    const vault = loadVaultKey(testVaultKey());
    // A chave embrulhada é válida: a recusa vem da conferência do formato.
    const envelope = await sealCertificate({ publicKeySpki: vault.publicKeySpki, keyId: vault.keyId, pfx: new Uint8Array([7]), password: "x" });
    expect(() => vault.open({ ...envelope, iv: Buffer.alloc(16, 1).toString("base64") })).toThrow(VaultError);
    expect(() => vault.open({ ...envelope, ciphertext: Buffer.alloc(16, 1).toString("base64") })).toThrow(VaultError);
    expect(() => vault.open({ ...envelope, ciphertext: Buffer.alloc(8, 1).toString("base64") })).toThrow(VaultError);
  });

  test("loadVaultKey recusa valor que não é chave, sem repetir o valor na mensagem", () => {
    const junk = "bm9wZQ==";
    let message = "";
    try {
      loadVaultKey(junk);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(junk);
    expect(message).not.toContain("nope");
  });
});
