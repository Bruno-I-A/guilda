/**
 * Transcrição dos áudios recebidos contra um Postgres de verdade (PGlite), como
 * guilda_app, com a Meta e a OpenAI de mentira: o áudio vira texto uma vez, a
 * conversa mostra o texto, a leitura da IA espera por ele e o usa no turno.
 */
import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

import type { Classifier } from "./triage/shadow";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "org-audio";
const CHANNEL = "00000000-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-11-23T12:00:00Z");
const env = { ...process.env };
const admin = { userId: "admin", role: "admin" as const, clanIds: [] };
let seq = 0;

async function tx<T>(run: Parameters<typeof import("@/db/org-tx").withOrgTx<T>>[1]) {
  const { withOrgTx } = await import("@/db/org-tx");
  return withOrgTx(ORG, run);
}

/** Áudio do cliente pelo caminho real do webhook. */
async function customerSendsAudio(whatsappId: string, mediaId: string, mimeType: string, minutesAgo: number): Promise<{ messageId: string; conversationId: string }> {
  seq += 1;
  const { runSupportInboundCycle } = await import("@/lib/whatsapp/inbound-worker");
  await tx((t) =>
    t.insert(schema.supportInboundEvents).values({
      orgId: ORG,
      channelId: CHANNEL,
      fingerprint: String(seq).padStart(64, "0"),
      webhookField: "messages",
      payload: {
        contacts: [{ wa_id: whatsappId, profile: { name: "Cliente" } }],
        messages: [{ id: `wamid.audio${seq}`, from: whatsappId, type: "audio", timestamp: String(Math.floor((NOW.getTime() - minutesAgo * 60_000) / 1000)), audio: { id: mediaId, mime_type: mimeType, voice: true } }],
      },
    }),
  );
  expect((await runSupportInboundCycle()).failed).toBe(0);
  const [row] = await tx((t) =>
    t
      .select({ messageId: schema.supportMessages.id, conversationId: schema.supportMessages.conversationId })
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.externalMessageId, `wamid.audio${seq}`)),
  );
  return row;
}

const openAiRequests: FormData[] = [];
/** Meta: 777 e 888 são OGG, 999 é AMR. OpenAI: responde o texto, ou erro com "falha" no arquivo. */
const fakeFetch = (async (url: URL | string, init?: RequestInit) => {
  const href = String(url);
  const media = /graph\.facebook\.com\/v[\d.]+\/(\d+)\?/.exec(href)?.[1];
  if (media) {
    const mimeType = media === "999" ? "audio/amr" : "audio/ogg; codecs=opus";
    return new Response(JSON.stringify({ url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${media}`, mime_type: mimeType, file_size: 4 }), { status: 200 });
  }
  if (href.startsWith("https://lookaside.fbsbx.com/")) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-length": "4" } });
  if (href === "https://api.openai.com/v1/audio/transcriptions") {
    const form = init?.body as FormData;
    openAiRequests.push(form);
    if (openAiRequests.length === 99) return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
    return new Response(JSON.stringify({ text: "Preciso da guia do DAS de outubro, vence amanhã" }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

async function transcribe() {
  const { runSupportTranscriptionCycle } = await import("./transcription");
  return runSupportTranscriptionCycle({ now: NOW, fetchImpl: fakeFetch });
}

async function transcriptionOf(messageId: string) {
  const [row] = await tx((t) =>
    t
      .select({ status: schema.supportMessageTranscriptions.status, text: schema.supportMessageTranscriptions.text, attempts: schema.supportMessageTranscriptions.attempts })
      .from(schema.supportMessageTranscriptions)
      .where(eq(schema.supportMessageTranscriptions.messageId, messageId)),
  );
  return row;
}

beforeAll(async () => {
  process.env.WHATSAPP_TOKEN_KEY = randomBytes(32).toString("base64");
  process.env.OPENAI_API_KEY = "sk-teste";
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'audio', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('admin', 'Bruno', 'admin@x', true, now(), now());
  `);
  await client.exec("SET ROLE guilda_app;");
  const { encryptWhatsAppToken } = await import("@/lib/whatsapp/token-vault");
  const envelope = encryptWhatsAppToken("token-de-teste", { orgId: ORG, channelId: CHANNEL });
  await tx((t) =>
    t.insert(schema.supportWhatsAppChannels).values({
      id: CHANNEL,
      orgId: ORG,
      name: "WhatsApp",
      status: "active",
      wabaId: "111",
      phoneNumberId: "222",
      accessTokenCiphertext: envelope!.ciphertext,
      accessTokenIv: envelope!.iv,
      accessTokenAuthTag: envelope!.authTag,
      accessTokenKeyVersion: envelope!.keyVersion,
    }),
  );
  await Promise.all([import("@/lib/whatsapp/inbound-worker"), import("./transcription"), import("./triage/shadow"), import("./inbox")]);
}, 120_000);

afterEach(() => {
  openAiRequests.length = 0;
});

afterAll(async () => {
  process.env = env;
  await client.close();
});

test("o áudio vira texto uma vez, com o vocabulário contábil, e aparece na conversa", async () => {
  const { messageId, conversationId } = await customerSendsAudio("5554900000001", "777", "audio/ogg; codecs=opus", 2);
  expect(await transcribe()).toEqual({ transcribed: 1 });
  expect(await transcriptionOf(messageId)).toEqual({ status: "done", text: "Preciso da guia do DAS de outubro, vence amanhã", attempts: 1 });
  const [request] = openAiRequests;
  expect(request.get("model")).toBe("gpt-4o-mini-transcribe");
  expect(request.get("language")).toBe("pt");
  expect(String(request.get("prompt"))).toContain("pró-labore");
  expect((request.get("file") as File).name).toBe("audio.ogg");

  // Já transcrito: o ciclo seguinte não chama a OpenAI de novo.
  expect(await transcribe()).toEqual({ transcribed: 0 });
  expect(openAiRequests).toHaveLength(1);

  const { loadSupportConversation } = await import("./inbox");
  const view = await tx((t) => loadSupportConversation(t, { orgId: ORG, viewer: admin, conversationId, now: NOW }));
  expect(view?.timeline.find((item) => item.kind === "message" && item.id === messageId)).toMatchObject({
    audio: { src: `/api/atendimento/media/${messageId}`, transcript: "Preciso da guia do DAS de outubro, vence amanhã", status: "done" },
  });
});

test("áudio em AMR, que a transcrição não lê, fica indisponível sem chamar a OpenAI", async () => {
  const { messageId } = await customerSendsAudio("5554900000002", "999", "audio/amr", 2);
  await transcribe();
  expect(await transcriptionOf(messageId)).toMatchObject({ status: "unavailable" });
  expect(openAiRequests).toEqual([]);
});

test("a leitura da IA espera a transcrição e lê o texto do áudio", async () => {
  process.env.SUPPORT_AI_MODE = "shadow";
  process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS = "0";
  const seen: string[] = [];
  const classify: Classifier = async (current) => {
    seen.push(current);
    return {
      classificacao: { setor_sugerido: "fiscal", urgencia: "alta", confianca: 0.9, resumo: "Cliente pede a guia do DAS" },
      perguntaEsclarecimento: null,
      respostaDireta: null,
      fontesConhecimento: [],
      modelo: "teste",
      tokensEntrada: 1,
      tokensSaida: 1,
    };
  };
  const { runSupportTriageCycle } = await import("./triage/shadow");
  const { messageId, conversationId } = await customerSendsAudio("5554900000003", "888", "audio/ogg; codecs=opus", 2);
  const runsOf = () => tx((t) => t.select({ id: schema.supportAiRuns.id }).from(schema.supportAiRuns).where(eq(schema.supportAiRuns.conversationId, conversationId)));

  // Áudio de 2 minutos atrás ainda sem texto: a leitura desta conversa espera.
  await runSupportTriageCycle({ classify, now: NOW });
  expect(await runsOf()).toEqual([]);

  await transcribe();
  expect(await transcriptionOf(messageId)).toMatchObject({ status: "done" });
  seen.length = 0;
  await runSupportTriageCycle({ classify, now: NOW });
  expect(await runsOf()).toHaveLength(1);
  expect(seen).toContain("Áudio (transcrição): Preciso da guia do DAS de outubro, vence amanhã");
});

test("sem a chave da OpenAI, nada sai e o áudio só se ouve", async () => {
  delete process.env.OPENAI_API_KEY;
  try {
    const { messageId } = await customerSendsAudio("5554900000004", "777", "audio/ogg; codecs=opus", 2);
    expect(await transcribe()).toEqual({ transcribed: 0 });
    expect(await transcriptionOf(messageId)).toBeUndefined();
  } finally {
    process.env.OPENAI_API_KEY = "sk-teste";
  }
});

test("a transcrição não se apaga pelo app", async () => {
  await expect(tx((t) => t.delete(schema.supportMessageTranscriptions))).rejects.toThrow();
});
