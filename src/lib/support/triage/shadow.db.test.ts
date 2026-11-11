/**
 * Triagem em sombra contra um Postgres de verdade (PGlite), como guilda_app:
 * desligada não lê nada; ligada lê cada turno uma vez, junta as mensagens
 * seguidas, não lê conversa que já tem dono e nada vai para a fila de saída.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

import type { Classifier } from "./shadow";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "org-triagem";
const FISCAL = "00000000-0000-4000-8000-0000000000f1";
const CHANNEL = "00000000-0000-4000-8000-0000000000a1";
const env = { ...process.env };
let seq = 0;

async function tx<T>(run: Parameters<typeof import("@/db/org-tx").withOrgTx<T>>[1]) {
  const { withOrgTx } = await import("@/db/org-tx");
  return withOrgTx(ORG, run);
}

async function customerSays(whatsappId: string, text: string, minutesAgo = 5) {
  seq += 1;
  const { runSupportInboundCycle } = await import("@/lib/whatsapp/inbound-worker");
  const at = Math.floor((Date.now() - minutesAgo * 60_000) / 1000);
  await tx((t) =>
    t.insert(schema.supportInboundEvents).values({
      orgId: ORG,
      channelId: CHANNEL,
      fingerprint: String(seq).padStart(64, "0"),
      webhookField: "messages",
      payload: { contacts: [{ wa_id: whatsappId, profile: { name: "Maria" } }], messages: [{ id: `wamid.t${seq}`, from: whatsappId, type: "text", timestamp: String(at), text: { body: text } }] },
    }),
  );
  await runSupportInboundCycle();
  const [row] = await tx((t) =>
    t
      .select({ id: schema.supportConversations.id })
      .from(schema.supportConversations)
      .innerJoin(schema.supportContacts, eq(schema.supportContacts.id, schema.supportConversations.contactId))
      .where(eq(schema.supportContacts.whatsappId, whatsappId)),
  );
  return row.id;
}

const seen: { current: string; history: number }[] = [];
const fake: Classifier = async (current, history) => {
  seen.push({ current, history: history.length });
  return {
    classificacao: { setor_sugerido: "fiscal", urgencia: "alta", confianca: 0.9, resumo: "Cliente pede a guia do DAS que vence hoje" },
    perguntaEsclarecimento: null,
    respostaDireta: null,
    modelo: "modelo-de-teste",
    tokensEntrada: 120,
    tokensSaida: 30,
  };
};

async function cycle(classify: Classifier = fake) {
  const { runSupportTriageCycle } = await import("./shadow");
  return runSupportTriageCycle({ classify });
}

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'triagem', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('ana', 'Ana', 'ana@x', true, now(), now());
    INSERT INTO clans (id, org_id, name, slug) VALUES ('${FISCAL}', '${ORG}', 'Fiscal', 'fiscal');
  `);
  await client.exec("SET ROLE guilda_app;");
  await tx((t) => t.insert(schema.supportWhatsAppChannels).values({ id: CHANNEL, orgId: ORG, name: "WhatsApp", status: "active", wabaId: "1", phoneNumberId: "2" }));
}, 120_000);

afterEach(() => {
  process.env = { ...env };
  seen.length = 0;
});

afterAll(() => client.close());

test("desligada por padrão: nenhuma mensagem vai à IA", async () => {
  delete process.env.SUPPORT_AI_MODE;
  await customerSays("5554900000001", "Preciso da guia");
  expect(await cycle()).toEqual({ triaged: 0 });
  expect(seen).toEqual([]);
});

test("em sombra, lê o turno inteiro uma vez, grava a leitura e não envia nada", async () => {
  process.env.SUPPORT_AI_MODE = "shadow";
  process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS = "0";
  const id = await customerSays("5554900000002", "Bom dia", 6);
  await customerSays("5554900000002", "preciso da guia do DAS, vence hoje", 5);
  expect((await cycle()).triaged).toBeGreaterThanOrEqual(1);
  const mine = seen.find((call) => call.current.includes("vence hoje"));
  expect(mine?.current).toBe("Bom dia\npreciso da guia do DAS, vence hoje");

  const runs = await tx((t) => t.select().from(schema.supportAiRuns).where(eq(schema.supportAiRuns.conversationId, id)));
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ status: "done", model: "modelo-de-teste", inputTokens: 120, result: { sector: "fiscal", urgency: "alta" } });
  expect(await tx((t) => t.select().from(schema.supportOutbox))).toEqual([]);

  // Rodar de novo sem mensagem nova não lê de novo.
  seen.length = 0;
  await cycle();
  expect(seen.find((call) => call.current.includes("vence hoje"))).toBeUndefined();

  // A leitura aparece na tela com o clã correspondente e marca a fila como urgente.
  const { loadSupportConversation, loadSupportQueue } = await import("../inbox");
  const viewer = { userId: "ana", role: "admin" as const, clanIds: [] };
  const view = await tx((t) => loadSupportConversation(t, { orgId: ORG, viewer, conversationId: id, now: new Date() }));
  expect(view?.aiSuggestion).toMatchObject({ sectorLabel: "Fiscal", clan: { id: FISCAL }, urgency: "alta", summary: "Cliente pede a guia do DAS que vence hoje" });
  const queue = await tx((t) => loadSupportQueue(t, { orgId: ORG, viewer, filter: "open" }));
  expect(queue.rows.find((row) => row.id === id)?.aiUrgent).toBe(true);
});

test("espera o cliente terminar de escrever", async () => {
  process.env.SUPPORT_AI_MODE = "shadow";
  process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS = "600";
  await customerSays("5554900000003", "oi, tudo bem?", 1);
  await cycle();
  expect(seen.find((call) => call.current.includes("tudo bem"))).toBeUndefined();
});

test("conversa que já tem dono não passa pela IA", async () => {
  process.env.SUPPORT_AI_MODE = "shadow";
  process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS = "0";
  const id = await customerSays("5554900000004", "Preciso de uma nota");
  const { takeSupportConversation } = await import("../inbox");
  await tx((t) => takeSupportConversation(t, { orgId: ORG, viewer: { userId: "ana", role: "admin", clanIds: [] }, conversationId: id, now: new Date() }));
  await cycle();
  expect(seen.find((call) => call.current.includes("nota"))).toBeUndefined();
});

test("falha da IA fica registrada como falha e não trava a conversa", async () => {
  process.env.SUPPORT_AI_MODE = "shadow";
  process.env.SUPPORT_TRIAGE_DEBOUNCE_SECONDS = "0";
  const id = await customerSays("5554900000005", "Oi, preciso de ajuda com o balancete");
  const broken: Classifier = async () => ({
    classificacao: { setor_sugerido: "outro", urgencia: "media", confianca: 0, resumo: "", fallback: { motivo: "erro_api" } },
    perguntaEsclarecimento: null,
    respostaDireta: null,
    modelo: "modelo-de-teste",
    tokensEntrada: 0,
    tokensSaida: 0,
  });
  await cycle(broken);
  const [run] = await tx((t) => t.select().from(schema.supportAiRuns).where(eq(schema.supportAiRuns.conversationId, id)));
  expect(run).toMatchObject({ status: "failed", fallbackReason: "erro_api" });
  const [conversation] = await tx((t) => t.select().from(schema.supportConversations).where(eq(schema.supportConversations.id, id)));
  expect(conversation.status).toBe("needs_human");
});

test("a leitura não se apaga", async () => {
  await expect(tx((t) => t.delete(schema.supportAiRuns))).rejects.toThrow();
});
