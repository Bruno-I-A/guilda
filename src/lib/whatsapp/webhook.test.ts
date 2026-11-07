import { createHmac } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  parseWhatsAppWebhook,
  verifyMetaChallenge,
  verifyMetaSignature,
  webhookChangeFingerprint,
} from "./webhook";

describe("webhook oficial do WhatsApp", () => {
  test("valida a assinatura HMAC sobre os bytes exatos do corpo", () => {
    const body = '{"object":"whatsapp_business_account"}';
    const secret = "app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifyMetaSignature(body, signature, secret)).toBe(true);
    expect(verifyMetaSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=curta", secret)).toBe(false);
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
  });

  test("aceita o desafio somente com modo e token corretos", () => {
    expect(
      verifyMetaChallenge(
        new URLSearchParams({
          "hub.mode": "subscribe",
          "hub.verify_token": "token-secreto",
          "hub.challenge": "123456",
        }),
        "token-secreto",
      ),
    ).toBe("123456");
    expect(
      verifyMetaChallenge(
        new URLSearchParams({
          "hub.mode": "subscribe",
          "hub.verify_token": "errado",
          "hub.challenge": "123456",
        }),
        "token-secreto",
      ),
    ).toBeNull();
  });

  test("extrai mensagens e ecos do app, descartando blocos desconhecidos", () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-ignorado",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+555499999999", phone_number_id: "12345" },
                contacts: [{ wa_id: "555498888888", profile: { name: "Cliente" } }],
                messages: [
                  { from: "555498888888", id: "wamid.1", timestamp: "10", type: "text", text: { body: "Oi" } },
                ],
                token: "nunca deve persistir",
              },
            },
            {
              field: "smb_message_echoes",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+555499999999", phone_number_id: "12345" },
                message_echoes: [
                  { from: "555499999999", to: "555498888888", id: "wamid.2", timestamp: "11", type: "text", text: { body: "Resposta humana" } },
                ],
                access_token: "também não",
              },
            },
          ],
        },
      ],
    });

    const changes = parseWhatsAppWebhook(body);
    expect(changes).toHaveLength(2);
    expect(changes?.[0]).toMatchObject({ phoneNumberId: "12345", field: "messages" });
    expect(changes?.[1]).toMatchObject({ phoneNumberId: "12345", field: "smb_message_echoes" });
    expect(changes?.[0].payload).not.toHaveProperty("token");
    expect(changes?.[1].payload).not.toHaveProperty("access_token");
    expect(changes?.[1].payload.message_echoes).toEqual([
      expect.objectContaining({ id: "wamid.2", to: "555498888888" }),
    ]);
  });

  test("rejeita envelope alheio e gera dedupe estável por change", () => {
    expect(parseWhatsAppWebhook('{"object":"page","entry":[]}')).toBeNull();
    const first = webhookChangeFingerprint("corpo", 0);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(webhookChangeFingerprint("corpo", 0)).toBe(first);
    expect(webhookChangeFingerprint("corpo", 1)).not.toBe(first);
  });
});
