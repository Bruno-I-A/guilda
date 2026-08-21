import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export interface EncryptedFlowSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encryptionKeyFromEnvironment(): Buffer | null {
  const value = process.env.FLOW_SECRETS_KEY?.trim();
  if (!value) return null;
  const key = /^[A-Fa-f0-9]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export function encryptFlowSecretWithKey(
  value: string,
  key: Buffer,
): EncryptedFlowSecret {
  if (key.length !== 32) throw new Error("Chave do cofre inválida.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptFlowSecretWithKey(
  encrypted: EncryptedFlowSecret,
  key: Buffer,
): string {
  if (key.length !== 32) throw new Error("Chave do cofre inválida.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptFlowSecret(value: string): EncryptedFlowSecret | null {
  const key = encryptionKeyFromEnvironment();
  return key ? encryptFlowSecretWithKey(value, key) : null;
}

export function decryptFlowSecret(encrypted: EncryptedFlowSecret): string | null {
  const key = encryptionKeyFromEnvironment();
  return key ? decryptFlowSecretWithKey(encrypted, key) : null;
}
