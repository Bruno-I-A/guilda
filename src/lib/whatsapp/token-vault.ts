import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type WhatsAppTokenEnvelope = Readonly<{
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: 1;
}>;

export type WhatsAppTokenContext = Readonly<{
  orgId: string;
  channelId: string;
}>;

function additionalData(context: WhatsAppTokenContext): Buffer {
  return Buffer.from(
    `guilda:whatsapp:channel-token:v1:${context.orgId}:${context.channelId}`,
    "utf8",
  );
}

export function decodeWhatsAppTokenKey(value: string | undefined): Buffer | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const key = /^[A-Fa-f0-9]{64}$/.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64");
  return key.length === 32 ? key : null;
}

export function encryptWhatsAppTokenWithKey(
  token: string,
  key: Buffer,
  context: WhatsAppTokenContext,
): WhatsAppTokenEnvelope {
  if (!token) throw new Error("Token do WhatsApp vazio.");
  if (key.length !== 32) throw new Error("Chave do cofre do WhatsApp inválida.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(additionalData(context));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function decryptWhatsAppTokenWithKey(
  envelope: WhatsAppTokenEnvelope,
  key: Buffer,
  context: WhatsAppTokenContext,
): string {
  if (key.length !== 32) throw new Error("Chave do cofre do WhatsApp inválida.");
  if (envelope.keyVersion !== 1) throw new Error("Versão do cofre do WhatsApp inválida.");
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Envelope do cofre do WhatsApp inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAAD(additionalData(context));
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptWhatsAppToken(
  token: string,
  context: WhatsAppTokenContext,
): WhatsAppTokenEnvelope | null {
  const key = decodeWhatsAppTokenKey(process.env.WHATSAPP_TOKEN_KEY);
  return key ? encryptWhatsAppTokenWithKey(token, key, context) : null;
}

export function decryptWhatsAppToken(
  envelope: WhatsAppTokenEnvelope,
  context: WhatsAppTokenContext,
): string | null {
  const key = decodeWhatsAppTokenKey(process.env.WHATSAPP_TOKEN_KEY);
  return key ? decryptWhatsAppTokenWithKey(envelope, key, context) : null;
}

export function isWhatsAppTokenVaultConfigured(): boolean {
  return decodeWhatsAppTokenKey(process.env.WHATSAPP_TOKEN_KEY) !== null;
}
