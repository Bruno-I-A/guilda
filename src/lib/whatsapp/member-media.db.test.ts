import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("@/db", () => ({ db }));
vi.mock("./config", () => ({ getWhatsAppConfig: () => ({ graphApiVersion: "v24.0" }) }));
vi.mock("./channel-repository", () => ({
  loadWhatsAppChannelAccess: async () => ({ channel: { phoneNumberId: "222222", wabaId: "111111" }, accessToken: "EA-token" }),
}));

const ORG = "org-midia";
const previousKey = process.env.OPENAI_API_KEY;

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'midia', now());
    SET ROLE guilda_app;
    SELECT set_config('app.org_id', '${ORG}', false);
    INSERT INTO support_whatsapp_channels (org_id, name, status, waba_id, phone_number_id, display_phone_number)
      VALUES ('${ORG}', 'Escritório', 'active', '111111', '222222', '+5554999999999');
  `);
  await import("./member-media");
}, 120_000);

afterEach(() => {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
});

afterAll(async () => {
  await client.close();
});

/** Meta: metadados da mídia, depois o arquivo; OpenAI: a transcrição. */
function fakeFetch(mimeType: string, bytes: Uint8Array, transcript = "Ana, conferir a folha até sexta") {
  const calls: string[] = [];
  const impl = (async (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("graph.facebook.com")) {
      return Response.json({ url: "https://lookaside.fbsbx.com/whatsapp/media/1", mime_type: mimeType, file_size: bytes.byteLength });
    }
    if (url.includes("lookaside.fbsbx.com")) return new Response(new Blob([new Uint8Array(bytes)]));
    if (url.includes("api.openai.com")) return Response.json({ text: transcript });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

test("áudio vira texto pela transcrição", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const { readMemberMedia } = await import("./member-media");
  const { impl, calls } = fakeFetch("audio/ogg; codecs=opus", new Uint8Array([1, 2, 3]));
  const reading = await readMemberMedia({ orgId: ORG, messageType: "audio", mediaId: "998877", mimeType: "audio/ogg; codecs=opus", caption: null }, { fetchImpl: impl });
  expect(reading).toEqual({ ok: true, kind: "audio", text: "Ana, conferir a folha até sexta" });
  expect(calls.some((url) => url.includes("api.openai.com/v1/audio/transcriptions"))).toBe(true);
});

test("sem a chave da OpenAI o áudio é recusado antes de baixar", async () => {
  delete process.env.OPENAI_API_KEY;
  const { readMemberMedia } = await import("./member-media");
  const { impl, calls } = fakeFetch("audio/ogg", new Uint8Array([1]));
  const reading = await readMemberMedia({ orgId: ORG, messageType: "audio", mediaId: "1", mimeType: "audio/ogg", caption: null }, { fetchImpl: impl });
  expect(reading).toMatchObject({ ok: false, message: expect.stringContaining("Escreva o pedido") });
  expect(calls).toHaveLength(0);
});

test("foto vai à leitura da IA com a legenda", async () => {
  const { readMemberMedia } = await import("./member-media");
  const { impl } = fakeFetch("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff]));
  const readAttachment = vi.fn(async () => "Conferir a nota da ACME até sexta");
  const reading = await readMemberMedia({ orgId: ORG, messageType: "image", mediaId: "123", mimeType: "image/jpeg", caption: "Rui, ver isso" }, { fetchImpl: impl, readAttachment });
  expect(reading).toEqual({ ok: true, kind: "image", text: "Conferir a nota da ACME até sexta" });
  expect(readAttachment).toHaveBeenCalledWith({ attachment: { kind: "image", data: Buffer.from([0xff, 0xd8, 0xff]).toString("base64"), mimeType: "image/jpeg" }, caption: "Rui, ver isso" });
});

test("documento que não é PDF e foto em formato recusado respondem o motivo", async () => {
  const { readMemberMedia } = await import("./member-media");
  const word = await readMemberMedia({ orgId: ORG, messageType: "document", mediaId: "1", mimeType: "application/msword", caption: null });
  expect(word).toMatchObject({ ok: false, message: expect.stringContaining("texto, áudio, foto e PDF") });
  const { impl } = fakeFetch("image/heic", new Uint8Array([1]));
  const heic = await readMemberMedia({ orgId: ORG, messageType: "image", mediaId: "2", mimeType: "image/heic", caption: null }, { fetchImpl: impl, readAttachment: vi.fn() });
  expect(heic).toMatchObject({ ok: false, message: expect.stringContaining("Não consegui ler") });
});
