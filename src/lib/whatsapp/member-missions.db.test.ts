import { PGlite } from "@electric-sql/pglite";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import type { InformativeDraftPayload } from "@/lib/ai/informative-schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("@/db", () => ({ db }));

const ORG = "org-missoes-zap";
const RH = "123e4567-e89b-12d3-a456-426614174001";
const FISCAL = "123e4567-e89b-12d3-a456-426614174002";

/** A IA dos Informativos é simulada: o teste é do caminho, não da leitura. */
const draftPayload = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/informatives/draft", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/informatives/draft")>();
  return {
    ...original,
    buildInformativeDraft: vi.fn(async () => ({ ok: true, payload: draftPayload.current, model: "teste" })),
  };
});

const base = {
  kind: "general_task",
  sourceFormat: "business_mission",
  freeNotice: null,
  company: {
    systemCode: null, legalName: null, cnpj: null, taxRegime: null, city: null, contact: null, summary: "Pedido.",
    normalizedCnpj: null, clientId: null, createClient: false, cnaeCode: null, cnaeDescription: null, secondaryCnaes: null,
    openedAt: null, pendingFiscalNote: null, suggestedFiscalOwnerId: null,
  },
  commitments: [],
  ignoredNotes: [],
  observations: [],
  warnings: [],
  unresolvedAssignees: [],
};
const core = { category: "general", description: "Conferir antes do envio.", priority: 2, difficulty: 2, closingYear: null, sourceSection: "", sector: null, suggestions: [] };

function payloadFor(tasks: unknown[]): InformativeDraftPayload {
  return { ...base, tasks } as unknown as InformativeDraftPayload;
}

let connections: Record<string, string> = {};

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'missoes-zap', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
      ('ana', 'Ana Souza', 'ana@example.test', true, now(), now()),
      ('rui', 'Rui Lima', 'rui@example.test', true, now(), now()),
      ('lider', 'Lia Chefe', 'lia@example.test', true, now(), now());
    INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
      ('m1', '${ORG}', 'ana', 'member', now()),
      ('m2', '${ORG}', 'rui', 'member', now()),
      ('m3', '${ORG}', 'lider', 'member', now());
    INSERT INTO clans (id, org_id, name, slug) VALUES ('${RH}', '${ORG}', 'RH', 'rh'), ('${FISCAL}', '${ORG}', 'Fiscal', 'fiscal');
    INSERT INTO clan_memberships (org_id, clan_id, user_id, is_leader) VALUES
      ('${ORG}', '${RH}', 'ana', false), ('${ORG}', '${FISCAL}', 'rui', false), ('${ORG}', '${FISCAL}', 'lider', true);
    SET ROLE guilda_app;
    SELECT set_config('app.org_id', '${ORG}', false);
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164, verified_at, last_inbound_at) VALUES
      ('${ORG}', 'ana', '+5554911110000', now(), now()),
      ('${ORG}', 'rui', '+5554922220000', now(), now()),
      ('${ORG}', 'lider', '+5554933330000', now(), now());
  `);
  const rows = await db.select({ id: schema.memberWhatsAppConnections.id, userId: schema.memberWhatsAppConnections.userId }).from(schema.memberWhatsAppConnections);
  connections = Object.fromEntries(rows.map((row) => [row.userId, row.id]));
  await import("./member-commands");
}, 120_000);

afterAll(async () => {
  await client.close();
});

async function send(userId: string, externalId: string, fields: Partial<typeof schema.memberWhatsAppCommands.$inferInsert>) {
  await db.insert(schema.memberWhatsAppCommands).values({
    orgId: ORG, userId, connectionId: connections[userId], externalId, kind: "text", messageType: "text", receivedAt: new Date(), ...fields,
  });
}

async function cycle(readMedia?: Parameters<typeof import("./member-commands").runMemberCommandCycle>[2]) {
  const { runMemberCommandCycle } = await import("./member-commands");
  const noFetch = (async () => new Response("{}")) as unknown as typeof fetch;
  return runMemberCommandCycle(10, noFetch, readMedia ?? (async () => ({ ok: false, message: "sem leitura" })));
}

async function repliesTo(userId: string) {
  const rows = await db.select({ key: schema.memberWhatsAppOutbox.dedupeKey, payload: schema.memberWhatsAppOutbox.payload })
    .from(schema.memberWhatsAppOutbox).where(eq(schema.memberWhatsAppOutbox.userId, userId));
  return rows.map((row) => ({ key: row.key, ...(row.payload as { text?: string; buttons?: { id: string; title: string }[] }) }));
}

describe("integrante que não lidera clã pede missão avulsa", () => {
  test("texto vira prévia com botões; Criar nasce a missão avulsa para a colega", async () => {
    draftPayload.current = payloadFor([
      { ...core, title: "Conferir a folha de novembro", dueDate: "2026-11-28", assignmentType: "individual", assigneeId: "ana", assigneeName: "Ana Souza", clanId: RH, clanName: "RH" },
    ]);
    await send("rui", "w.rui.1", { text: "Ana, conferir a folha de novembro até sexta" });
    expect(await cycle()).toEqual({ claimed: 1, failed: 0 });

    const replies = await repliesTo("rui");
    const preview = replies.find((r) => r.key.endsWith(":preview"));
    const decision = replies.find((r) => r.key.endsWith(":decision"));
    expect(preview?.text).toContain("1. Ana Souza: Conferir a folha de novembro");
    expect(decision?.buttons?.map((b) => b.title)).toEqual(["Criar 1 missão", "Cancelar"]);
    expect(await db.select().from(schema.informatives)).toHaveLength(0);

    // Outro número não confirma a prévia de Rui.
    await send("ana", "w.ana.intrusa", { kind: "button", messageType: "interactive", buttonId: decision!.buttons![0].id });
    await cycle();
    expect(await db.select().from(schema.tasks)).toHaveLength(0);
    expect((await repliesTo("ana")).some((r) => r.text?.includes("Prévia não encontrada"))).toBe(true);

    await send("rui", "w.rui.criar", { kind: "button", messageType: "interactive", buttonId: decision!.buttons![0].id });
    await cycle();
    const tasks = await db.select().from(schema.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ creatorId: "rui", assigneeId: "ana", clanId: RH, informativeId: null, title: "Conferir a folha de novembro", xpValue: 50 });
    expect(tasks[0].dueDate?.toISOString()).toBe("2026-11-28T12:00:00.000Z");
    // Quem recebeu é avisado.
    expect((await repliesTo("ana")).some((r) => r.key === `task:${tasks[0].id}:assigned`)).toBe(true);

    // O segundo toque não cria de novo.
    await send("rui", "w.rui.criar2", { kind: "button", messageType: "interactive", buttonId: decision!.buttons![0].id });
    await cycle();
    expect(await db.select().from(schema.tasks)).toHaveLength(1);
    expect((await repliesTo("rui")).some((r) => r.text?.includes("já foram criadas"))).toBe(true);
  });

  test("áudio é transcrito, a transcrição aparece na prévia e Cancelar não cria nada", async () => {
    draftPayload.current = payloadFor([
      { ...core, title: "Revisar o DAS da ACME", dueDate: null, assignmentType: "clan", assigneeId: null, assigneeName: null, clanId: FISCAL, clanName: "Fiscal" },
    ]);
    await send("ana", "w.ana.audio", { kind: "media", messageType: "audio", mediaId: "998877", mediaMime: "audio/ogg; codecs=opus" });
    const readMedia = vi.fn(async () => ({ ok: true as const, kind: "audio" as const, text: "Pessoal do fiscal, revisar o DAS da ACME" }));
    await cycle(readMedia);
    expect(readMedia).toHaveBeenCalledWith(expect.objectContaining({ messageType: "audio", mediaId: "998877" }));
    const replies = await repliesTo("ana");
    const preview = replies.filter((r) => r.key.endsWith(":preview")).at(-1);
    expect(preview?.text).toContain('Entendi assim: "Pessoal do fiscal, revisar o DAS da ACME"');
    expect(preview?.text).toContain("Clã Fiscal (sem responsável): Revisar o DAS da ACME");
    const decision = replies.filter((r) => r.key.endsWith(":decision")).at(-1);
    await send("ana", "w.ana.cancela", { kind: "button", messageType: "interactive", buttonId: decision!.buttons![1].id });
    await cycle();
    const drafts = await db.select().from(schema.memberMissionDrafts).where(eq(schema.memberMissionDrafts.requestedBy, "ana"));
    expect(drafts[0].status).toBe("cancelled");
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.creatorId, "ana"))).toHaveLength(0);
  });

  test("foto que não dá para ler responde o motivo; vídeo explica o que se lê", async () => {
    await send("rui", "w.rui.foto", { kind: "media", messageType: "image", mediaId: "123", mediaMime: "image/jpeg", mediaCaption: "olha isso" });
    await send("rui", "w.rui.video", { kind: "other", messageType: "video" });
    await cycle(async () => ({ ok: false, message: "Não consegui ler o arquivo." }));
    const texts = (await repliesTo("rui")).map((r) => r.text ?? "");
    expect(texts).toContain("Não consegui ler o arquivo.");
    expect(texts.some((t) => t.startsWith("Por aqui eu leio texto, áudio, foto e PDF."))).toBe(true);
  });

  test("a prévia avulsa não se apaga pelo guilda_app", async () => {
    await expect(client.exec(`DELETE FROM member_mission_drafts`)).rejects.toThrow();
  });
});

describe("líder de clã continua pelo Informativo", () => {
  test("o pedido do líder vira Informativo pedido pelo WhatsApp, com a conexão dele", async () => {
    draftPayload.current = payloadFor([
      { ...core, title: "Conferir notas de entrada", dueDate: null, assignmentType: "individual", assigneeId: "rui", assigneeName: "Rui Lima", clanId: FISCAL, clanName: "Fiscal" },
    ]);
    await send("lider", "w.lider.1", { text: "Rui, conferir as notas de entrada" });
    await cycle();
    const [informative] = await db.select().from(schema.informatives).where(and(eq(schema.informatives.requestedBy, "lider"), isNull(schema.informatives.connectionId)));
    expect(informative).toMatchObject({ source: "whatsapp", whatsappConnectionId: connections.lider, status: "pending" });
    const decision = (await repliesTo("lider")).find((r) => r.key.endsWith(":decision"));
    expect(decision?.buttons?.[0].id).toBe(`draft:confirm:${informative.id}`);
  });
});
