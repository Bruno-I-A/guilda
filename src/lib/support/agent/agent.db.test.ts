/**
 * Teste do agente contra um Postgres de verdade (PGlite), como guilda_app: a
 * palavra-chave abre a rodada, o agente pergunta, responde e encaminha ao clã,
 * pessoa e mensagem nova vencem a IA, e o worker de saída só envia a fala da
 * rodada com o interruptor ligado. O relógio é falso (só Date) para a ordem das
 * mensagens e o cumprimento não dependerem da hora em que o teste roda.
 */
import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import type { SupportViewer } from "@/domain/support-inbox";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

import type { SetorValido } from "../triage/classificacao";
import type { Classifier } from "../triage/shadow";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "org-agente";
const FISCAL = "00000000-0000-4000-8000-0000000000f1";
const CHANNEL = "00000000-0000-4000-8000-0000000000a1";
const COMPANY = "00000000-0000-4000-8000-0000000000c1";
const T0 = new Date("2026-11-19T12:00:00Z").getTime(); // 09:00 em Brasília
const admin: SupportViewer = { userId: "admin", role: "admin", clanIds: [] };
const env = { ...process.env };
const ASK = "Para eu te ajudar da melhor forma, pode me contar em poucas palavras qual é o assunto?";
let seq = 0;

const at = (seconds: number) => new Date(T0 + seconds * 1000);
const setClock = (seconds: number) => vi.setSystemTime(at(seconds));

async function tx<T>(run: Parameters<typeof import("@/db/org-tx").withOrgTx<T>>[1]) {
  const { withOrgTx } = await import("@/db/org-tx");
  return withOrgTx(ORG, run);
}

/** Mensagem do cliente pelo caminho real do webhook: evento na fila e worker. */
async function customerSays(whatsappId: string, text: string, seconds: number): Promise<string> {
  seq += 1;
  const { runSupportInboundCycle } = await import("@/lib/whatsapp/inbound-worker");
  await tx((t) =>
    t.insert(schema.supportInboundEvents).values({
      orgId: ORG,
      channelId: CHANNEL,
      fingerprint: String(seq).padStart(64, "0"),
      webhookField: "messages",
      payload: {
        contacts: [{ wa_id: whatsappId, profile: { name: "Bruno" } }],
        messages: [{ id: `wamid.agente${seq}`, from: whatsappId, type: "text", timestamp: String(Math.floor(at(seconds).getTime() / 1000)), text: { body: text } }],
      },
    }),
  );
  expect((await runSupportInboundCycle()).failed).toBe(0);
  const [row] = await tx((t) =>
    t
      .select({ id: schema.supportConversations.id })
      .from(schema.supportConversations)
      .innerJoin(schema.supportContacts, eq(schema.supportContacts.id, schema.supportConversations.contactId))
      .where(and(eq(schema.supportContacts.whatsappId, whatsappId), eq(schema.supportConversations.orgId, ORG))),
  );
  return row.id;
}

type Reply = { setor?: SetorValido; pergunta?: string; resposta?: string; fallback?: string; atendente?: string };
const calls: { current: string; modo?: string; perguntasFeitas?: number }[] = [];
const rosters: string[][] = [];
let replies: Reply[] = [];
let during: (() => Promise<unknown>) | null = null;

const fake: Classifier = async (current, _history, options) => {
  calls.push({ current, modo: options.modo, perguntasFeitas: options.perguntasFeitas });
  rosters.push((options.roster ?? []).map((entry) => entry.id));
  if (during) {
    const run = during;
    during = null;
    await run();
  }
  const reply = replies.shift() ?? {};
  return {
    classificacao: {
      setor_sugerido: reply.setor ?? "fiscal",
      urgencia: "media",
      confianca: reply.fallback ? 0 : 0.9,
      resumo: "Cliente pede a guia do DAS",
      atendente_sugerido: reply.atendente ?? null,
      ...(reply.fallback ? { fallback: { motivo: reply.fallback } } : {}),
    },
    perguntaEsclarecimento: reply.pergunta ?? null,
    respostaDireta: reply.resposta ?? null,
    fontesConhecimento: [],
    modelo: "modelo-de-teste",
    tokensEntrada: 10,
    tokensSaida: 5,
  };
};

async function cycle() {
  const { runSupportTriageCycle } = await import("../triage/shadow");
  return runSupportTriageCycle({ classify: fake, now: new Date() });
}

async function setAgent(enabled: boolean, keyword = "batata") {
  const { saveAgentTestSettings } = await import("./settings");
  return tx((t) => saveAgentTestSettings(t, { orgId: ORG, userId: "admin", enabled, keyword, now: new Date() }));
}

async function conversation(id: string) {
  const [row] = await tx((t) => t.select().from(schema.supportConversations).where(eq(schema.supportConversations.id, id)));
  return row;
}

async function aiTexts(id: string): Promise<string[]> {
  const rows = await tx((t) =>
    t
      .select({ text: schema.supportMessages.text })
      .from(schema.supportMessages)
      .where(and(eq(schema.supportMessages.conversationId, id), eq(schema.supportMessages.actor, "ai")))
      .orderBy(asc(schema.supportMessages.occurredAt)),
  );
  return rows.map((row) => row.text ?? "");
}

async function runsOf(id: string) {
  return tx((t) =>
    t
      .select({ result: schema.supportAiRuns.result })
      .from(schema.supportAiRuns)
      .where(eq(schema.supportAiRuns.conversationId, id))
      .orderBy(asc(schema.supportAiRuns.createdAt)),
  );
}

async function outboxOf(id: string) {
  return tx((t) =>
    t
      .select({ text: schema.supportMessages.text, payload: schema.supportOutbox.payload, status: schema.supportOutbox.status, lastError: schema.supportOutbox.lastError })
      .from(schema.supportOutbox)
      .innerJoin(schema.supportMessages, eq(schema.supportMessages.id, schema.supportOutbox.messageId))
      .where(eq(schema.supportMessages.conversationId, id))
      .orderBy(asc(schema.supportMessages.occurredAt)),
  );
}

beforeAll(async () => {
  process.env.WHATSAPP_TOKEN_KEY = randomBytes(32).toString("base64");
  process.env.WHATSAPP_APP_ID = "123456";
  process.env.WHATSAPP_APP_SECRET = "segredo-de-teste";
  process.env.SUPPORT_AI_MODE = "shadow";
  process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS = "0";
  await applyMigrations(client);
  // Fiscal: Ana conectou o WhatsApp (janela aberta) e é a responsável da Academia na
  // Carteira; Rui e Maria não conectaram (Maria conecta no teste do encaminhamento por assunto).
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'agente', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
      ('admin', 'Bruno', 'admin@x', true, now(), now()), ('ana', 'Ana', 'ana@x', true, now(), now()),
      ('rui', 'Rui', 'rui@x', true, now(), now()), ('maria', 'Maria Souza', 'maria@x', true, now(), now());
    INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
      ('m1', '${ORG}', 'admin', 'admin', now()), ('m2', '${ORG}', 'ana', 'member', now()),
      ('m3', '${ORG}', 'rui', 'member', now()), ('m4', '${ORG}', 'maria', 'member', now());
    INSERT INTO clans (id, org_id, name, slug) VALUES ('${FISCAL}', '${ORG}', 'Fiscal', 'fiscal');
    INSERT INTO clan_memberships (org_id, clan_id, user_id) VALUES ('${ORG}', '${FISCAL}', 'ana'), ('${ORG}', '${FISCAL}', 'rui'), ('${ORG}', '${FISCAL}', 'maria');
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164, last_inbound_at) VALUES ('${ORG}', 'ana', '+5554988887777', '2026-11-19T12:00:00Z');
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES ('${COMPANY}', '${ORG}', 'ACADEMIA FORMA LTDA', 'simples', '33000167000101');
    INSERT INTO fiscal_portfolios (org_id, client_id, user_id, assigned_by) VALUES ('${ORG}', '${COMPANY}', 'ana', 'admin');
  `);
  await client.exec("SET ROLE guilda_app;");
  const { encryptWhatsAppToken } = await import("@/lib/whatsapp/token-vault");
  const envelope = encryptWhatsAppToken("token-de-teste-1234", { orgId: ORG, channelId: CHANNEL });
  await tx((t) =>
    t.insert(schema.supportWhatsAppChannels).values({
      id: CHANNEL,
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
  // Carrega aqui o que os testes importam: a primeira importação passava dos 5 s do teste.
  await Promise.all([
    import("@/lib/whatsapp/inbound-worker"),
    import("@/lib/whatsapp/outbound-worker"),
    import("@/lib/whatsapp/member-notification-worker"),
    import("../triage/shadow"),
    import("../inbox"),
    import("./settings"),
    import("./routing"),
  ]);
  vi.useFakeTimers({ toFake: ["Date"] });
}, 120_000);

beforeEach(() => {
  calls.length = 0;
  rosters.length = 0;
  replies = [];
  during = null;
});

afterAll(async () => {
  vi.useRealTimers();
  process.env = env;
  await client.close();
});

test("com o teste desligado, a palavra é uma mensagem comum", async () => {
  setClock(0);
  const id = await customerSays("5554900000001", "batata, preciso da guia", -30);
  expect(await conversation(id)).toMatchObject({ status: "needs_human", aiTestStartedAt: null });
});

test("a palavra abre a rodada, e só a palavra recebe o pedido de assunto sem chamar a IA", async () => {
  expect(await setAgent(true, " Batata ")).toEqual({ ok: true, data: { closedRounds: 0 } });
  setClock(60);
  const id = await customerSays("5554900000002", "Batata", 30);
  expect(await conversation(id)).toMatchObject({ status: "ai_active", aiTestStartedAt: at(30), assignedClanId: null });

  await cycle();
  // A sombra lê a conversa do teste anterior neste ciclo; a rodada não chama a IA.
  expect(calls.filter((call) => call.modo === "conversa")).toEqual([]);
  expect(await aiTexts(id)).toEqual([`Bom dia! ${ASK}`]);
  const [queued] = await outboxOf(id);
  expect(queued.payload).toEqual({ to: "5554900000002", text: `Bom dia! ${ASK}`, agentRound: at(30).toISOString() });

  // A fala da IA é a última mensagem: o ciclo seguinte não lê de novo.
  await cycle();
  expect(await aiTexts(id)).toHaveLength(1);

  const { loadSupportQueue, loadSupportConversation } = await import("../inbox");
  const queue = await tx((t) => loadSupportQueue(t, { orgId: ORG, viewer: admin, filter: "open" }));
  expect(queue.rows.find((row) => row.id === id)).toMatchObject({ status: "ai_active", agentTest: true });
  const view = await tx((t) => loadSupportConversation(t, { orgId: ORG, viewer: admin, conversationId: id, now: new Date() }));
  expect(view?.agentTest).toBe(true);
  expect(view?.timeline.some((item) => item.kind === "event" && item.text === "Teste do agente iniciado pela palavra-chave")).toBe(true);
});

test("pergunta, resposta do cliente e encaminhamento ao clã; a palavra de novo reinicia", async () => {
  setClock(100);
  const id = await customerSays("5554900000003", "batata, preciso da guia do DAS", 70);
  replies = [{ pergunta: "De qual empresa?" }];
  await cycle();
  expect(calls).toEqual([{ current: "preciso da guia do DAS", modo: "conversa", perguntasFeitas: 0 }]);
  expect(await aiTexts(id)).toEqual(["Bom dia! Só preciso confirmar: De qual empresa?"]);

  setClock(200);
  await customerSays("5554900000003", "da Academia", 150);
  await cycle();
  expect(calls[1]).toEqual({ current: "da Academia", modo: "conversa", perguntasFeitas: 1 });
  expect((await aiTexts(id)).at(-1)).toBe("Encaminhei ao setor Fiscal. Uma pessoa da equipe continua o atendimento por aqui.");
  expect(await conversation(id)).toMatchObject({
    status: "needs_human",
    assignedClanId: FISCAL,
    summary: "Cliente pede a guia do DAS",
    aiPauseReason: "ai_handoff",
  });
  expect((await runsOf(id)).map((run) => (run.result as { agent?: { kind: string } }).agent?.kind)).toEqual(["clarify", "handoff"]);

  const { loadSupportConversation } = await import("../inbox");
  const view = await tx((t) => loadSupportConversation(t, { orgId: ORG, viewer: admin, conversationId: id, now: new Date() }));
  expect(view?.timeline.some((item) => item.kind === "event" && item.text === "IA: encaminhou para Fiscal")).toBe(true);
  expect(view?.timeline.filter((item) => item.kind === "message" && item.author === "IA")).toHaveLength(2);

  // Encaminhada, a conversa volta à sombra: a IA lê, mas não fala.
  setClock(300);
  await customerSays("5554900000003", "obrigado", 250);
  await cycle();
  expect(await aiTexts(id)).toHaveLength(2);
  expect((await runsOf(id)).at(-1)?.result).toMatchObject({ mode: "sombra" });

  // A palavra de novo recomeça do zero, com cumprimento.
  setClock(400);
  await customerSays("5554900000003", "batata", 350);
  expect(await conversation(id)).toMatchObject({ status: "ai_active", assignedClanId: null, aiTestStartedAt: at(350) });
  await cycle();
  expect((await aiTexts(id)).at(-1)).toBe(`Bom dia! ${ASK}`);
});

test("o encaminhamento avisa no WhatsApp quem é do clã e conectou o número", async () => {
  const id = await customerIdFor("5554900000003");
  const rows = await tx((t) =>
    t
      .select({ userId: schema.memberWhatsAppOutbox.userId, companyFlowId: schema.memberWhatsAppOutbox.companyFlowId })
      .from(schema.memberWhatsAppOutbox)
      .where(eq(schema.memberWhatsAppOutbox.supportConversationId, id)),
  );
  expect(rows).toEqual([{ userId: "ana", companyFlowId: null }]);

  const { runMemberWhatsAppNotificationCycle } = await import("@/lib/whatsapp/member-notification-worker");
  const sent: { to: string; text: string }[] = [];
  const fetchSpy = (async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: string; text: { body: string } };
    sent.push({ to: body.to, text: body.text.body });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.aviso${sent.length}` }] }), { status: 200 });
  }) as unknown as typeof fetch;
  await runMemberWhatsAppNotificationCycle(20, fetchSpy);
  expect(sent).toEqual([
    {
      to: "5554988887777",
      text: "Nova conversa no Atendimento\n\nCliente: Bruno\nClã: Fiscal\nAssunto: Cliente pede a guia do DAS",
    },
  ]);
});

test("quem assume enquanto a IA lê vence: a fala é descartada", async () => {
  setClock(500);
  const id = await customerSays("5554900000004", "batata preciso de uma nota", 470);
  const { takeSupportConversation } = await import("../inbox");
  during = () => tx((t) => takeSupportConversation(t, { orgId: ORG, viewer: admin, conversationId: id, now: new Date() }));
  await cycle();
  expect(await aiTexts(id)).toEqual([]);
  expect((await runsOf(id))[0]?.result).toMatchObject({ mode: "conversa", agent: { kind: "handoff", discarded: "pessoa_assumiu" } });
  expect(await conversation(id)).toMatchObject({ status: "human_active", assignedUserId: "admin" });
});

test("mensagem nova do cliente durante a leitura descarta a fala e vira o próximo turno", async () => {
  setClock(600);
  const id = await customerSays("5554900000005", "batata preciso do balancete", 570);
  during = () => customerSays("5554900000005", "é urgente", 590);
  await cycle();
  expect(await aiTexts(id)).toEqual([]);
  expect((await runsOf(id))[0]?.result).toMatchObject({ agent: { discarded: "nova_mensagem" } });

  await cycle();
  expect(calls.at(-1)?.current).toBe("preciso do balancete\né urgente");
  // A fala descartada não conta: a primeira que sai ainda cumprimenta.
  expect(await aiTexts(id)).toEqual(["Bom dia! Encaminhei ao setor Fiscal. Uma pessoa da equipe continua o atendimento por aqui."]);
});

test("conversa sem a palavra, com o teste ligado, continua só em sombra", async () => {
  setClock(700);
  const id = await customerSays("5554900000006", "preciso da guia", 670);
  await cycle();
  expect(await aiTexts(id)).toEqual([]);
  expect((await runsOf(id))[0]?.result).toMatchObject({ mode: "sombra" });
  expect(await outboxOf(id)).toEqual([]);
});

test("o worker envia a fala da rodada e segura a de rodada antiga ou sem rodada", async () => {
  const { runSupportOutboxCycle } = await import("@/lib/whatsapp/outbound-worker");
  // Fala da IA criada fora do agente, sem rodada: nunca sai.
  const manual = await customerSays("5554900000008", "oi", 680);
  const [message] = await tx((t) =>
    t
      .insert(schema.supportMessages)
      .values({ orgId: ORG, channelId: CHANNEL, conversationId: manual, direction: "outbound", actor: "ai", source: "guilda_ai", messageType: "text", text: "Sugestão interna.", occurredAt: new Date() })
      .returning({ id: schema.supportMessages.id }),
  );
  await tx((t) => t.insert(schema.supportOutbox).values({ orgId: ORG, channelId: CHANNEL, messageId: message.id, payload: { to: "5554900000008", text: "Sugestão interna." } }));

  const sent: { to: string; text: string }[] = [];
  const fetchOk = (async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: string; text: { body: string } };
    sent.push({ to: body.to, text: body.text.body });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.ia${sent.length}` }] }), { status: 200 });
  }) as unknown as typeof fetch;
  await runSupportOutboxCycle(50, fetchOk);

  expect(sent).toContainEqual({ to: "5554900000002", text: `Bom dia! ${ASK}` });
  // Encaminhamento sai com a conversa já com a equipe.
  expect(sent).toContainEqual({ to: "5554900000005", text: "Bom dia! Encaminhei ao setor Fiscal. Uma pessoa da equipe continua o atendimento por aqui." });
  // Da conversa reiniciada, só sai a fala da rodada nova.
  expect(sent.filter((row) => row.to === "5554900000003")).toEqual([{ to: "5554900000003", text: `Bom dia! ${ASK}` }]);
  const restarted = (await outboxOf(await customerIdFor("5554900000003"))).filter((row) => row.status === "failed");
  expect(restarted).toHaveLength(2);
  expect(restarted.every((row) => row.lastError === "Mensagem da IA fora da rodada de teste: ficou na Guilda.")).toBe(true);
  expect(sent.some((row) => row.to === "5554900000008")).toBe(false);
  expect(await outboxOf(manual)).toEqual([expect.objectContaining({ status: "failed", lastError: "Mensagem da IA fora da rodada de teste: ficou na Guilda." })]);
});

async function customerIdFor(whatsappId: string): Promise<string> {
  const [row] = await tx((t) =>
    t
      .select({ id: schema.supportConversations.id })
      .from(schema.supportConversations)
      .innerJoin(schema.supportContacts, eq(schema.supportContacts.id, schema.supportConversations.contactId))
      .where(eq(schema.supportContacts.whatsappId, whatsappId)),
  );
  return row.id;
}

test("desligar o teste encerra a rodada aberta e segura o que estava na fila", async () => {
  const { runSupportOutboxCycle } = await import("@/lib/whatsapp/outbound-worker");
  setClock(800);
  const id = await customerSays("5554900000007", "batata", 770);
  await cycle();
  expect(await aiTexts(id)).toEqual([`Bom dia! ${ASK}`]);

  const result = await setAgent(false);
  expect(result.ok && result.data?.closedRounds).toBeGreaterThanOrEqual(1);
  expect(await conversation(id)).toMatchObject({ status: "needs_human", aiPauseReason: "test_disabled" });

  const sent: string[] = [];
  const fetchSpy = (async (_url: URL, init: RequestInit) => {
    sent.push((JSON.parse(String(init.body)) as { to: string }).to);
    return new Response(JSON.stringify({ messages: [{ id: "wamid.nao-deveria-sair" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  await runSupportOutboxCycle(50, fetchSpy);
  expect(sent).not.toContain("5554900000007");
  expect(await outboxOf(id)).toEqual([expect.objectContaining({ status: "failed", lastError: "Teste do agente desligado: a mensagem da IA ficou na Guilda." })]);

  const { loadSupportConversation } = await import("../inbox");
  const view = await tx((t) => loadSupportConversation(t, { orgId: ORG, viewer: admin, conversationId: id, now: new Date() }));
  expect(view?.timeline.some((item) => item.kind === "event" && item.text === "Bruno desligou o teste do agente")).toBe(true);
});

test("fora da janela de 24 horas, o aviso de conversa não sai (ainda não há modelo para ele)", async () => {
  // O encaminhamento da conversa 5 deixou um aviso pendente para a Ana.
  const id = await customerIdFor("5554900000005");
  await tx((t) => t.update(schema.memberWhatsAppConnections).set({ lastInboundAt: null }).where(eq(schema.memberWhatsAppConnections.userId, "ana")));
  const { runMemberWhatsAppNotificationCycle } = await import("@/lib/whatsapp/member-notification-worker");
  const sent: string[] = [];
  const fetchSpy = (async (_url: URL, init: RequestInit) => {
    sent.push((JSON.parse(String(init.body)) as { to: string }).to);
    return new Response(JSON.stringify({ messages: [{ id: "wamid.nao-deveria-sair" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  await runMemberWhatsAppNotificationCycle(20, fetchSpy);
  expect(sent).toEqual([]);
  // Fechado sem tentar de novo. A função do #139 grava aviso pulado como "sent" e
  // descarta o motivo, como já faz no caso do modelo não aprovado.
  const [row] = await tx((t) =>
    t
      .select({ status: schema.memberWhatsAppOutbox.status })
      .from(schema.memberWhatsAppOutbox)
      .where(eq(schema.memberWhatsAppOutbox.supportConversationId, id)),
  );
  expect(row.status).not.toBe("pending");
});

async function noticesFor(conversationId: string): Promise<string[]> {
  const rows = await tx((t) =>
    t
      .select({ userId: schema.memberWhatsAppOutbox.userId })
      .from(schema.memberWhatsAppOutbox)
      .where(eq(schema.memberWhatsAppOutbox.supportConversationId, conversationId)),
  );
  return rows.map((row) => row.userId).sort();
}

test("encaminhamento por assunto: a pessoa do assunto recebe a conversa e o aviso, só ela", async () => {
  // O teste anterior desligou o agente: liga de novo, faz do Rui o líder e escreve as regras.
  await setAgent(true);
  await tx((t) => t.update(schema.clanMemberships).set({ isLeader: true }).where(eq(schema.clanMemberships.userId, "rui")));
  await tx((t) => t.update(schema.memberWhatsAppConnections).set({ lastInboundAt: at(900) }).where(eq(schema.memberWhatsAppConnections.userId, "ana")));
  await tx((t) => t.insert(schema.memberWhatsAppConnections).values({ orgId: ORG, userId: "maria", phoneE164: "+5554977776666", lastInboundAt: at(900) }));
  const { saveClanRoutingTopics } = await import("./routing");
  expect(
    await tx((t) =>
      saveClanRoutingTopics(t, {
        orgId: ORG,
        actorId: "admin",
        clanId: FISCAL,
        people: [{ userId: "maria", topics: "parcelamento, guia de parcelamento, parcelamento atrasado" }, { userId: "rui", topics: "  " }],
        portfolioTopics: "guias de imposto, guia atrasada",
        now: new Date(),
      }),
    ),
  ).toEqual({ ok: true });

  setClock(1000);
  const id = await customerSays("5554900000009", "batata, preciso da guia do parcelamento", 970);
  replies = [{ atendente: "maria" }];
  await cycle();
  // A IA recebe quem atende cada assunto, com a Carteira como entrada especial.
  expect(rosters.at(-1)).toEqual(["maria", "carteira"]);
  expect(await conversation(id)).toMatchObject({ status: "needs_human", assignedClanId: FISCAL, assignedUserId: "maria" });
  expect(await noticesFor(id)).toEqual(["maria"]);

  const { loadSupportConversation } = await import("../inbox");
  const view = await tx((t) => loadSupportConversation(t, { orgId: ORG, viewer: admin, conversationId: id, now: new Date() }));
  expect(view?.timeline.some((item) => item.kind === "event" && item.text === "IA: encaminhou para Fiscal · Maria Souza")).toBe(true);
});

test("assunto da Carteira vai ao responsável da empresa vinculada; sem empresa, ao líder", async () => {
  const { linkSupportContact } = await import("../inbox");
  setClock(1100);
  const linked = await customerSays("5554900000010", "oi", 1060);
  await tx((t) => linkSupportContact(t, { orgId: ORG, viewer: admin, conversationId: linked, now: new Date(), clientId: COMPANY }));
  await customerSays("5554900000010", "batata, preciso da guia atrasada", 1070);
  replies = [{ atendente: "carteira" }];
  await cycle();
  expect(await conversation(linked)).toMatchObject({ assignedUserId: "ana" });
  expect(await noticesFor(linked)).toEqual(["ana"]);

  setClock(1200);
  const unknown = await customerSays("5554900000011", "batata, preciso da guia atrasada", 1170);
  replies = [{ atendente: "carteira" }];
  await cycle();
  // Sem empresa, o líder; o Rui não conectou o WhatsApp, então ninguém é avisado.
  expect(await conversation(unknown)).toMatchObject({ assignedUserId: "rui" });
  expect(await noticesFor(unknown)).toEqual([]);
});

test("assunto que não casa com ninguém vai ao líder", async () => {
  setClock(1300);
  const id = await customerSays("5554900000012", "batata, preciso de uma certidão", 1270);
  replies = [{}];
  await cycle();
  expect(await conversation(id)).toMatchObject({ assignedClanId: FISCAL, assignedUserId: "rui" });
});

test("quem sai do clã leva a regra junto", async () => {
  await tx((t) => t.delete(schema.clanMemberships).where(and(eq(schema.clanMemberships.clanId, FISCAL), eq(schema.clanMemberships.userId, "maria"))));
  const left = await tx((t) => t.select({ userId: schema.supportRoutingTopics.userId }).from(schema.supportRoutingTopics).where(eq(schema.supportRoutingTopics.clanId, FISCAL)));
  expect(left).toEqual([{ userId: null }]);
});

test("a configuração recusa palavra inválida e não se apaga", async () => {
  expect(await setAgent(true, "")).toEqual({ ok: false, error: "Informe a palavra-chave para ligar o teste." });
  expect(await setAgent(true, "duas palavras")).toEqual({ ok: false, error: "Use uma palavra só, de 3 a 40 letras ou números, sem espaço." });
  await expect(
    tx((t) => t.update(schema.supportAgentSettings).set({ testKeyword: "Com Espaço" }).where(eq(schema.supportAgentSettings.orgId, ORG))),
  ).rejects.toThrow();
  await expect(tx((t) => t.delete(schema.supportAgentSettings))).rejects.toThrow();
});
