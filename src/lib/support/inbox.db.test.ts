/**
 * Caixa de entrada contra um Postgres de verdade (PGlite), como guilda_app:
 * visibilidade, assumir, responder, 24 horas, notas, vínculo e o envio à Meta.
 */
import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import type { SupportViewer } from "@/domain/support-inbox";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "org-inbox";
const OTHER = "org-outra";
const FISCAL = "00000000-0000-4000-8000-0000000000f1";
const RH = "00000000-0000-4000-8000-0000000000f2";
const COMPANY = "00000000-0000-4000-8000-0000000000c1";
const OTHER_COMPANY = "00000000-0000-4000-8000-0000000000c2";
const NOW = new Date("2026-11-06T15:00:00Z");
const admin: SupportViewer = { userId: "admin", role: "admin", clanIds: [] };
const fiscal: SupportViewer = { userId: "ana", role: "member", clanIds: [FISCAL] };
const rh: SupportViewer = { userId: "rui", role: "member", clanIds: [RH] };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = { ...process.env };

let channelId = "";
let seq = 0;

async function tx<T>(run: Parameters<typeof import("@/db/org-tx").withOrgTx<T>>[1], org = ORG) {
  const { withOrgTx } = await import("@/db/org-tx");
  return withOrgTx(org, run);
}

/** Passa uma mensagem do cliente pelo caminho real do webhook: evento na fila e worker. */
async function customerSays(whatsappId: string, text: string, at = new Date(NOW.getTime() - 60_000), name = "Maria") {
  seq += 1;
  const { runSupportInboundCycle } = await import("@/lib/whatsapp/inbound-worker");
  await tx((t) =>
    t.insert(schema.supportInboundEvents).values({
      orgId: ORG,
      channelId,
      fingerprint: String(seq).padStart(64, "0"),
      webhookField: "messages",
      payload: {
        contacts: [{ wa_id: whatsappId, profile: { name } }],
        messages: [{ id: `wamid.in${seq}`, from: whatsappId, type: "text", timestamp: String(Math.floor(at.getTime() / 1000)), text: { body: text } }],
      },
    }),
  );
  const result = await runSupportInboundCycle();
  expect(result.failed).toBe(0);
  const [row] = await tx((t) =>
    t
      .select({ id: schema.supportConversations.id, status: schema.supportConversations.status })
      .from(schema.supportConversations)
      .innerJoin(schema.supportContacts, eq(schema.supportContacts.id, schema.supportConversations.contactId))
      .where(eq(schema.supportContacts.whatsappId, whatsappId)),
  );
  return row;
}

const setClan = (id: string, clanId: string) => tx((t) => t.update(schema.supportConversations).set({ assignedClanId: clanId }).where(eq(schema.supportConversations.id, id)));

beforeAll(async () => {
  process.env.WHATSAPP_TOKEN_KEY = randomBytes(32).toString("base64");
  process.env.WHATSAPP_APP_ID = "123456";
  process.env.WHATSAPP_APP_SECRET = "segredo-de-teste";
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'inbox', now()), ('${OTHER}', 'Outro', 'outra', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
      ('admin', 'Bruno', 'admin@x', true, now(), now()), ('ana', 'Ana', 'ana@x', true, now(), now()), ('rui', 'Rui', 'rui@x', true, now(), now());
    INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m1', '${ORG}', 'admin', 'admin', now()), ('m2', '${ORG}', 'ana', 'member', now());
    INSERT INTO clans (id, org_id, name, slug) VALUES ('${FISCAL}', '${ORG}', 'Fiscal', 'fiscal'), ('${RH}', '${ORG}', 'RH', 'rh');
    INSERT INTO clan_memberships (org_id, clan_id, user_id) VALUES ('${ORG}', '${FISCAL}', 'ana'), ('${ORG}', '${RH}', 'rui');
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES ('${COMPANY}', '${ORG}', 'Academia', 'simples', '33000167000101'), ('${OTHER_COMPANY}', '${OTHER}', 'Alheia', 'simples', '07412545000154');
  `);
  await client.exec("SET ROLE guilda_app;");
  const { encryptWhatsAppToken } = await import("@/lib/whatsapp/token-vault");
  channelId = "00000000-0000-4000-8000-0000000000a1";
  const envelope = encryptWhatsAppToken("token-de-teste-1234", { orgId: ORG, channelId });
  await tx((t) =>
    t.insert(schema.supportWhatsAppChannels).values({
      id: channelId,
      orgId: ORG,
      name: "WhatsApp",
      status: "active",
      wabaId: "111",
      phoneNumberId: "222",
      displayPhoneNumber: "+5554999999999",
      accessTokenCiphertext: envelope!.ciphertext,
      accessTokenIv: envelope!.iv,
      accessTokenAuthTag: envelope!.authTag,
      accessTokenKeyVersion: envelope!.keyVersion,
      createdBy: "admin",
    }),
  );
}, 120_000);

afterAll(async () => {
  process.env = env;
  await client.close();
});

test("conversa nova precisa de pessoa, porque ainda não há IA", async () => {
  const conversation = await customerSays("5554911110001", "Preciso da guia");
  expect(conversation.status).toBe("needs_human");
});

test("membro só vê o clã dele; sem setor, só admin; outra organização não vê nada", async () => {
  const { loadSupportQueue, loadSupportConversation } = await import("./inbox");
  const { id } = await customerSays("5554911110002", "Oi");
  const see = (viewer: SupportViewer) => tx((t) => loadSupportQueue(t, { orgId: ORG, viewer, filter: "open" }));
  const open = (viewer: SupportViewer) => tx((t) => loadSupportConversation(t, { orgId: ORG, viewer, conversationId: id, now: NOW }));

  expect((await see(admin)).rows.map((row) => row.id)).toContain(id);
  expect((await see(fiscal)).rows.map((row) => row.id)).not.toContain(id);
  expect(await open(fiscal)).toBeNull();

  await setClan(id, FISCAL);
  expect((await see(fiscal)).rows.map((row) => row.id)).toContain(id);
  expect((await see(rh)).rows.map((row) => row.id)).not.toContain(id);
  expect(await open(rh)).toBeNull();
  expect((await open(fiscal))?.timeline.findLast((item) => item.kind === "message")).toMatchObject({ kind: "message", text: "Oi", direction: "inbound" });

  const other = await tx((t) => loadSupportQueue(t, { orgId: OTHER, viewer: admin, filter: "open" }), OTHER);
  expect(other.rows).toEqual([]);
}, 30_000);

test("os comandos respeitam a mesma visibilidade", async () => {
  const { takeSupportConversation, addSupportNote, resolveSupportConversation } = await import("./inbox");
  const { id } = await customerSays("5554911110003", "Oi");
  await setClan(id, FISCAL);
  const base = { orgId: ORG, conversationId: id, now: NOW };
  expect((await tx((t) => takeSupportConversation(t, { ...base, viewer: rh }))).ok).toBe(false);
  expect((await tx((t) => addSupportNote(t, { ...base, viewer: rh, text: "x" }))).ok).toBe(false);
  expect((await tx((t) => resolveSupportConversation(t, { ...base, viewer: rh }))).ok).toBe(false);
});

test("só quem assumiu responde; a resposta vai para a fila uma vez, mesmo com clique duplo", async () => {
  const { takeSupportConversation, sendSupportReply, loadSupportConversation } = await import("./inbox");
  const { id } = await customerSays("5554911110004", "Qual o prazo?");
  await setClan(id, FISCAL);
  const base = { orgId: ORG, conversationId: id, now: NOW };
  const reply = (requestId: string, viewer = fiscal) => tx((t) => sendSupportReply(t, { ...base, viewer, text: "Até sexta", requestId }));

  const before = await reply(uuid(1));
  expect(before).toEqual({ ok: false, error: expect.stringContaining("Assuma") });
  expect((await tx((t) => takeSupportConversation(t, { ...base, viewer: fiscal }))).ok).toBe(true);
  const [taken] = await tx((t) => t.select().from(schema.supportConversations).where(eq(schema.supportConversations.id, id)));
  expect(taken).toMatchObject({ status: "human_active", assignedUserId: "ana", aiPauseReason: "attendant_took_over" });

  expect((await reply(uuid(2))).ok).toBe(true);
  expect((await reply(uuid(2))).ok).toBe(true);
  const sent = await tx((t) => t.select().from(schema.supportMessages).where(and(eq(schema.supportMessages.conversationId, id), eq(schema.supportMessages.direction, "outbound"))));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ actor: "attendant", source: "guilda_attendant", text: "Até sexta", sentByUserId: "ana" });
  const outbox = await tx((t) => t.select().from(schema.supportOutbox).where(eq(schema.supportOutbox.messageId, sent[0].id)));
  // O destino vem do cadastro do contato: o navegador não escolhe telefone.
  expect(outbox[0].payload).toEqual({ to: "5554911110004", text: "Até sexta" });

  const view = await tx((t) => loadSupportConversation(t, { ...base, viewer: fiscal }));
  expect(view?.timeline.findLast((item) => item.kind === "message")).toMatchObject({ kind: "message", author: "Ana", delivery: "sending" });
  // Outra pessoa do clã continua sem poder responder por cima.
  const colleague: SupportViewer = { userId: "admin", role: "admin", clanIds: [] };
  expect((await reply(uuid(3), colleague)).ok).toBe(false);
});

test("passadas 24 horas, a Guilda não tenta responder", async () => {
  const { takeSupportConversation, sendSupportReply, loadSupportConversation } = await import("./inbox");
  const old = new Date(NOW.getTime() - 25 * 3_600_000);
  const { id } = await customerSays("5554911110005", "Oi", old);
  const base = { orgId: ORG, viewer: admin, conversationId: id, now: NOW };
  await tx((t) => takeSupportConversation(t, base));
  expect(await tx((t) => sendSupportReply(t, { ...base, text: "x", requestId: uuid(4) }))).toEqual({ ok: false, error: expect.stringContaining("24 horas") });
  expect((await tx((t) => loadSupportConversation(t, base)))?.replyBlocked).toMatch(/24 horas/);
});

test("aguardar, voltar quando o cliente escreve, resolver e reabrir", async () => {
  const { takeSupportConversation, markSupportWaiting, resolveSupportConversation, reopenSupportConversation } = await import("./inbox");
  const phone = "5554911110006";
  const { id } = await customerSays(phone, "Oi");
  const base = { orgId: ORG, viewer: admin, conversationId: id, now: NOW };
  await tx((t) => takeSupportConversation(t, base));
  expect((await tx((t) => markSupportWaiting(t, base))).ok).toBe(true);
  expect((await customerSays(phone, "Voltei")).status).toBe("human_active");

  expect((await tx((t) => resolveSupportConversation(t, base))).ok).toBe(true);
  expect((await tx((t) => reopenSupportConversation(t, base))).ok).toBe(true);
  expect((await tx((t) => resolveSupportConversation(t, base))).ok).toBe(true);

  // Depois de resolvida, mensagem nova abre outra conversa, e a antiga não reabre por cima dela.
  const fresh = await tx(async (t) => {
    const before = await t.select({ id: schema.supportConversations.id }).from(schema.supportConversations);
    return before.length;
  });
  await customerSays(phone, "Mais uma coisa").catch(() => undefined);
  const all = await tx((t) => t.select({ id: schema.supportConversations.id }).from(schema.supportConversations));
  expect(all.length).toBe(fresh + 1);
  expect(await tx((t) => reopenSupportConversation(t, base))).toEqual({ ok: false, error: expect.stringContaining("outra conversa") });
});

test("transferir confere clã e pessoa na organização e leva a conversa para a fila certa", async () => {
  const { transferSupportConversation, loadSupportQueue } = await import("./inbox");
  const { id } = await customerSays("5554911110007", "Oi");
  const base = { orgId: ORG, viewer: admin, conversationId: id, now: NOW };
  expect((await tx((t) => transferSupportConversation(t, { ...base, clanId: uuid(99), userId: null }))).ok).toBe(false);
  expect((await tx((t) => transferSupportConversation(t, { ...base, clanId: null, userId: "rui" }))).ok).toBe(false); // rui não é membro desta org no teste
  expect((await tx((t) => transferSupportConversation(t, { ...base, clanId: FISCAL, userId: null }))).ok).toBe(true);
  const queue = await tx((t) => loadSupportQueue(t, { orgId: ORG, viewer: fiscal, filter: "needs_human" }));
  expect(queue.rows.find((row) => row.id === id)).toMatchObject({ clanName: "Fiscal", status: "needs_human" });
  expect((await tx((t) => transferSupportConversation(t, { ...base, clanId: null, userId: "ana" }))).ok).toBe(true);
  const mine = await tx((t) => loadSupportQueue(t, { orgId: ORG, viewer: fiscal, filter: "mine" }));
  expect(mine.rows.find((row) => row.id === id)).toMatchObject({ assignedToMe: true, status: "human_active" });
});

test("vínculo com a empresa traz as missões abertas; empresa de outra organização é recusada", async () => {
  const { linkSupportContact, loadSupportConversation } = await import("./inbox");
  const { id } = await customerSays("5554911110008", "Oi");
  const base = { orgId: ORG, viewer: admin, conversationId: id, now: NOW };
  expect((await tx((t) => linkSupportContact(t, { ...base, clientId: OTHER_COMPANY }))).ok).toBe(false);
  expect((await tx((t) => linkSupportContact(t, { ...base, clientId: COMPANY }))).ok).toBe(true);
  const task = (title: string, status: "pending" | "completed") =>
    t_insert(title, status);
  async function t_insert(title: string, status: "pending" | "completed") {
    await tx((t) => t.insert(schema.tasks).values({ orgId: ORG, creatorId: "admin", assigneeId: "ana", clientId: COMPANY, title, xpValue: 40, status }));
  }
  await task("Enviar guia", "pending");
  await task("Já feita", "completed");
  const view = await tx((t) => loadSupportConversation(t, base));
  expect(view?.client).toMatchObject({ name: "Academia" });
  expect(view?.openTasks.map((row) => row.title)).toEqual(["Enviar guia"]);
  expect((await tx((t) => linkSupportContact(t, { ...base, clientId: null }))).ok).toBe(true);
  expect((await tx((t) => loadSupportConversation(t, base)))?.client).toBeNull();
});

test("nota interna aparece só na tela, não vira mensagem nem saída, e não se apaga", async () => {
  const { addSupportNote, loadSupportConversation } = await import("./inbox");
  const { id } = await customerSays("5554911110009", "Oi");
  const base = { orgId: ORG, viewer: admin, conversationId: id, now: NOW };
  expect((await tx((t) => addSupportNote(t, { ...base, text: "Cliente difícil" }))).ok).toBe(true);
  const view = await tx((t) => loadSupportConversation(t, base));
  expect(view?.timeline.filter((item) => item.kind === "note")).toMatchObject([{ author: "Bruno", text: "Cliente difícil" }]);
  const outbound = await tx((t) => t.select().from(schema.supportMessages).where(and(eq(schema.supportMessages.conversationId, id), eq(schema.supportMessages.direction, "outbound"))));
  expect(outbound).toEqual([]);
  await expect(tx((t) => t.delete(schema.supportConversationNotes).where(eq(schema.supportConversationNotes.conversationId, id)))).rejects.toThrow();
});

test("foto recebida aparece no histórico e só pode ser aberta por quem vê a conversa", async () => {
  seq += 1;
  const { runSupportInboundCycle } = await import("@/lib/whatsapp/inbound-worker");
  await tx((t) =>
    t.insert(schema.supportInboundEvents).values({
      orgId: ORG,
      channelId,
      fingerprint: String(seq).padStart(64, "0"),
      webhookField: "messages",
      payload: {
        contacts: [{ wa_id: "5554911110099", profile: { name: "Carla" } }],
        messages: [{
          id: `wamid.in${seq}`,
          from: "5554911110099",
          type: "image",
          timestamp: String(Math.floor(NOW.getTime() / 1000)),
          image: { id: "987654321", mime_type: "image/jpeg", caption: "Comprovante" },
        }],
      },
    }),
  );
  expect((await runSupportInboundCycle()).failed).toBe(0);

  const [message] = await tx((t) =>
    t
      .select({ id: schema.supportMessages.id, conversationId: schema.supportMessages.conversationId })
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.externalMessageId, `wamid.in${seq}`)),
  );
  const { loadSupportConversation, loadSupportMediaReference } = await import("./inbox");
  const view = await tx((t) => loadSupportConversation(t, { orgId: ORG, viewer: admin, conversationId: message.conversationId, now: NOW }));
  expect(view?.timeline.find((item) => item.kind === "message" && item.id === message.id)).toMatchObject({
    image: { src: `/api/atendimento/media/${message.id}`, caption: "Comprovante" },
  });
  expect(await tx((t) => loadSupportMediaReference(t, { orgId: ORG, viewer: fiscal, messageId: message.id }))).toBeNull();
  await setClan(message.conversationId, FISCAL);
  expect(await tx((t) => loadSupportMediaReference(t, { orgId: ORG, viewer: fiscal, messageId: message.id }))).toEqual({
    channelId,
    mediaId: "987654321",
  });
  expect(await tx((t) => loadSupportMediaReference(t, { orgId: ORG, viewer: rh, messageId: message.id }))).toBeNull();
});

test("o envio chega à Meta com o token do canal, e o recibo acha a mensagem pelo id da Meta", async () => {
  const { takeSupportConversation, sendSupportReply, loadSupportConversation } = await import("./inbox");
  const { runSupportOutboxCycle } = await import("@/lib/whatsapp/outbound-worker");
  const { runSupportInboundCycle } = await import("@/lib/whatsapp/inbound-worker");
  const { id } = await customerSays("5554911110010", "Oi");
  const base = { orgId: ORG, viewer: admin, conversationId: id, now: NOW };
  await tx((t) => takeSupportConversation(t, base));
  await tx((t) => sendSupportReply(t, { ...base, text: "Olá!", requestId: uuid(10) }));

  const calls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  const fetchOk = (async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init.headers).get("authorization") ?? "", body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.saida${calls.length}` }] }), { status: 200 });
  }) as unknown as typeof fetch;
  // A fila pode ter respostas de testes anteriores: todas saem aqui.
  await runSupportOutboxCycle(50, fetchOk);
  const position = calls.findIndex((row) => row.body.to === "5554911110010");
  const call = calls[position];
  expect(call?.url).toContain("/222/messages");
  expect(call?.auth).toBe("Bearer token-de-teste-1234");
  expect(call?.body).toMatchObject({ messaging_product: "whatsapp", type: "text", text: { body: "Olá!" } });

  const delivery = async () => (await tx((t) => loadSupportConversation(t, base)))?.timeline.findLast((item) => item.kind === "message");
  expect(await delivery()).toMatchObject({ delivery: "sent" });

  await tx((t) =>
    t.insert(schema.supportInboundEvents).values({
      orgId: ORG,
      channelId,
      fingerprint: "f".repeat(64),
      webhookField: "messages",
      payload: { statuses: [{ id: `wamid.saida${position + 1}`, status: "read", timestamp: String(Math.floor(NOW.getTime() / 1000) + 60) }] },
    }),
  );
  await runSupportInboundCycle();
  expect(await delivery()).toMatchObject({ delivery: "read" });
});

test("recusa definitiva da Meta aparece na hora, sem novas tentativas; falha passageira tenta de novo", async () => {
  const { takeSupportConversation, sendSupportReply, loadSupportConversation } = await import("./inbox");
  const { runSupportOutboxCycle } = await import("@/lib/whatsapp/outbound-worker");
  const { id } = await customerSays("5554911110011", "Oi");
  const base = { orgId: ORG, viewer: admin, conversationId: id, now: NOW };
  await tx((t) => takeSupportConversation(t, base));

  await tx((t) => sendSupportReply(t, { ...base, text: "Passageira", requestId: uuid(20) }));
  const flaky = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
  await runSupportOutboxCycle(50, flaky);
  let last = (await tx((t) => loadSupportConversation(t, base)))?.timeline.findLast((item) => item.kind === "message");
  expect(last).toMatchObject({ delivery: "sending", failure: null });
  const pending = await tx((t) => t.select().from(schema.supportOutbox).where(eq(schema.supportOutbox.status, "pending")));
  expect(pending.length).toBe(1);

  await tx((t) => t.update(schema.supportOutbox).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(schema.supportOutbox.status, "pending")));
  const refused = (async () => new Response(JSON.stringify({ error: { code: 131047, type: "OAuthException" } }), { status: 400 })) as unknown as typeof fetch;
  await runSupportOutboxCycle(50, refused);
  last = (await tx((t) => loadSupportConversation(t, base)))?.timeline.findLast((item) => item.kind === "message");
  expect(last).toMatchObject({ delivery: "failed", failure: expect.stringContaining("24 horas") });
  expect(await tx((t) => t.select().from(schema.supportOutbox).where(eq(schema.supportOutbox.status, "pending")))).toEqual([]);
  const failed = await tx((t) => t.select().from(schema.supportOutbox).where(eq(schema.supportOutbox.status, "failed")));
  expect(failed).toHaveLength(1);
});
