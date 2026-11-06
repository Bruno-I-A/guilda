import { randomBytes } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decodeWhatsAppTokenKey,
  decryptWhatsAppTokenWithKey,
  encryptWhatsAppTokenWithKey,
} from "./token-vault";

describe("cofre dos tokens do WhatsApp", () => {
  test("cifra e abre o token somente no mesmo tenant e canal", () => {
    const key = randomBytes(32);
    const context = { orgId: "org-a", channelId: "canal-a" };
    const envelope = encryptWhatsAppTokenWithKey("EA-token-super-secreto", key, context);

    expect(envelope.ciphertext).not.toContain("EA-token-super-secreto");
    expect(decryptWhatsAppTokenWithKey(envelope, key, context)).toBe(
      "EA-token-super-secreto",
    );
    expect(() =>
      decryptWhatsAppTokenWithKey(envelope, key, {
        orgId: "org-b",
        channelId: "canal-a",
      }),
    ).toThrow();
    expect(() =>
      decryptWhatsAppTokenWithKey(envelope, key, {
        orgId: "org-a",
        channelId: "canal-b",
      }),
    ).toThrow();
  });

  test("aceita chave base64 ou hex de 32 bytes e recusa tamanho errado", () => {
    const key = randomBytes(32);
    expect(decodeWhatsAppTokenKey(key.toString("base64"))).toEqual(key);
    expect(decodeWhatsAppTokenKey(key.toString("hex"))).toEqual(key);
    expect(decodeWhatsAppTokenKey("curta")).toBeNull();
  });
});
