import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  withOrgTx: vi.fn(),
  viewer: vi.fn(),
  permit: vi.fn(),
  save: vi.fn(),
  access: vi.fn(),
  upload: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/action-context", () => ({ requireMemberContext: mocks.member }));
vi.mock("@/db/org-tx", () => ({ withOrgTx: mocks.withOrgTx }));
vi.mock("@/lib/support/inbox", () => ({ loadSupportViewer: mocks.viewer, checkSupportMediaReply: mocks.permit, sendSupportMedia: mocks.save }));
vi.mock("@/lib/whatsapp/channel-repository", () => ({ loadWhatsAppChannelAccess: mocks.access }));
vi.mock("@/lib/whatsapp/config", () => ({ getWhatsAppConfig: () => ({ graphApiVersion: "v24.0" }) }));
vi.mock("@/lib/whatsapp/meta-client", () => ({ uploadWhatsAppMedia: mocks.upload, MetaGraphError: class extends Error {} }));

import { POST } from "./route";

const conversationId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const url = `https://guilda.example/api/atendimento/conversations/${conversationId}/media`;
const params = { params: Promise.resolve({ conversationId }) };

function uploadRequest(origin = "https://guilda.example"): Request {
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7"], "balanco.pdf", { type: "application/pdf" }));
  form.set("caption", "Segue o balanço");
  form.set("requestId", requestId);
  return new Request(url, { method: "POST", headers: { origin }, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue({ ok: true, orgId: "org-a", userId: "user-a", role: "member" });
  mocks.withOrgTx.mockImplementation(async (_org, run) => run({}));
  mocks.viewer.mockResolvedValue({ userId: "user-a", role: "member", clanIds: [] });
  mocks.permit.mockResolvedValue({ ok: true, data: { channelId: "channel-a", alreadyQueued: false } });
  mocks.save.mockResolvedValue({ ok: true });
  mocks.access.mockResolvedValue({ channel: { phoneNumberId: "222222", status: "active" }, accessToken: "EA-test" });
  mocks.upload.mockResolvedValue("123456789");
});

test("origem externa e conversa sem permissão não fazem upload", async () => {
  expect((await POST(uploadRequest("https://evil.example"), params)).status).toBe(403);
  mocks.permit.mockResolvedValue({ ok: false, error: "Assuma a conversa para responder." });
  expect((await POST(uploadRequest(), params)).status).toBe(409);
  expect(mocks.upload).not.toHaveBeenCalled();
});

test("envia o arquivo à Meta e só depois grava a mensagem no tenant", async () => {
  const response = await POST(uploadRequest(), params);
  expect(response.status).toBe(200);
  expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({
    phoneNumberId: "222222", accessToken: "EA-test", filename: "balanco.pdf", mimeType: "application/pdf",
  }), { graphApiVersion: "v24.0" });
  expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    orgId: "org-a", conversationId, requestId, mediaId: "123456789", kind: "document", caption: "Segue o balanço",
  }));
  expect(mocks.revalidate).toHaveBeenCalledWith("/atendimento");
});

test("repetição do mesmo pedido não recarrega nem reenvia a mídia", async () => {
  mocks.permit.mockResolvedValue({ ok: true, data: { channelId: "channel-a", alreadyQueued: true } });
  expect((await POST(uploadRequest(), params)).status).toBe(200);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

test("arquivo acima do limite é recusado antes da autorização e da Meta", async () => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(21 * 1024 * 1024)], "muito-grande.pdf", { type: "application/pdf" }));
  form.set("caption", "");
  form.set("requestId", requestId);
  const response = await POST(new Request(url, { method: "POST", headers: { origin: "https://guilda.example" }, body: form }), params);
  expect(response.status).toBe(413);
  expect(mocks.permit).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
