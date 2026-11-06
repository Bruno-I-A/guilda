import { createHmac } from "node:crypto";

import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/whatsapp/config", () => ({
  getWhatsAppConfig: () => ({
    appSecret: "app-secret",
    webhookVerifyToken: "verify-token",
  }),
}));

vi.mock("@/lib/whatsapp/webhook-repository", () => ({
  lookupWhatsAppChannel: mocks.lookup,
  enqueueWhatsAppChange: mocks.enqueue,
}));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ orgId: "org-a", channelId: "channel-a" });
  mocks.enqueue.mockResolvedValue("queued");
});

test("GET devolve o challenge da Meta sem JSON", async () => {
  const response = await GET(
    new Request(
      "http://localhost/api/atendimento/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123",
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("abc123");
});

test("POST recusa corpo sem assinatura válida", async () => {
  const response = await POST(
    new Request("http://localhost/api/atendimento/meta/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=inválida" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(401);
  expect(mocks.lookup).not.toHaveBeenCalled();
});

test("POST autentica, roteia e enfileira o change", async () => {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "222222" },
              message_echoes: [
                { id: "wamid.1", to: "5554988888888", timestamp: "10", type: "text", text: { body: "Oi" } },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
  const response = await POST(
    new Request("http://localhost/api/atendimento/meta/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body,
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, queued: 1, duplicate: 0, unknownChannel: 0 });
  expect(mocks.lookup).toHaveBeenCalledWith("222222");
  expect(mocks.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      route: { orgId: "org-a", channelId: "channel-a" },
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      change: expect.objectContaining({ field: "smb_message_echoes" }),
    }),
  );
});
