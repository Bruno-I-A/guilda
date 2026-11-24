import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("@/db", () => ({ db }));
vi.mock("./config", () => ({ getWhatsAppConfig: () => ({ appId: "app", appSecret: "secret", graphApiVersion: "v24.0" }) }));
vi.mock("./channel-repository", () => ({
  loadWhatsAppChannelAccess: async () => ({ channel: { phoneNumberId: "222222", wabaId: "111111" }, accessToken: "EA-token" }),
}));

const ORG = "org-avisos";
const TASK = "11111111-1111-4111-8111-111111111111";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

type Sent = { url: string; body: Record<string, unknown> };
let sent: Sent[] = [];
const fakeFetch = (async (url: URL | string, init?: RequestInit) => {
  sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'avisos', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
      ('aberta', 'Ana', 'ana@example.test', true, now(), now()),
      ('fechada', 'Bia', 'bia@example.test', true, now(), now()),
      ('sem-prova', 'Caio', 'caio@example.test', true, now(), now());
    INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
      ('m1', '${ORG}', 'aberta', 'member', now()),
      ('m2', '${ORG}', 'fechada', 'member', now()),
      ('m3', '${ORG}', 'sem-prova', 'member', now());
    SET ROLE guilda_app;
    SELECT set_config('app.org_id', '${ORG}', false);
    INSERT INTO support_whatsapp_channels (org_id, name, status, waba_id, phone_number_id, display_phone_number)
      VALUES ('${ORG}', 'Escritório', 'active', '111111', '222222', '+5554999999999');
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164, verified_at, last_inbound_at) VALUES
      ('${ORG}', 'aberta', '+5554911110000', now(), '${hoursAgo(1).toISOString()}'),
      ('${ORG}', 'fechada', '+5554922220000', now(), '${hoursAgo(30).toISOString()}'),
      ('${ORG}', 'sem-prova', '+5554933330000', NULL, '${hoursAgo(1).toISOString()}');
    INSERT INTO member_whatsapp_templates (org_id, key, name, language, status, checked_at) VALUES
      ('${ORG}', 'nova_missao', 'guilda_nova_missao', 'pt_BR', 'APPROVED', now()),
      ('${ORG}', 'aprovacao', 'guilda_aprovacao', 'pt_BR', 'PENDING', now());
  `);
  await import("./member-notification-worker");
}, 120_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  sent = [];
  await client.exec(`RESET ROLE; DELETE FROM member_whatsapp_outbox; DELETE FROM member_notification_preferences; SET ROLE guilda_app;`);
});

async function queue(userId: string, dedupeKey: string, payload: unknown) {
  await db.insert(schema.memberWhatsAppOutbox).values({ orgId: ORG, userId, dedupeKey, payload });
}

const approval = { version: 3, kind: "notice", preference: "approvals", notice: { family: "approval", who: "Bia", title: "Folha", xp: 40, path: `tasks/${TASK}`, taskId: TASK } };
const newMission = { version: 3, kind: "notice", preference: "tasks", notice: { family: "new_mission", heading: "Nova missão para você", title: "Folha", due: "25/11/2026", xp: 40, path: `tasks/${TASK}` } };

async function run() {
  const { runMemberWhatsAppNotificationCycle } = await import("./member-notification-worker");
  return runMemberWhatsAppNotificationCycle(20, fakeFetch);
}

test("janela aberta: o aviso de aprovação sai com o botão Aprovar", async () => {
  await queue("aberta", "a1", approval);
  expect(await run()).toEqual({ claimed: 1, sent: 1 });
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toMatchObject({ to: "5554911110000", type: "interactive", interactive: { action: { buttons: [{ reply: { id: `task:approve:${TASK}`, title: "Aprovar" } }] } } });
});

test("janela fechada: sai o modelo aprovado com as variáveis e o link curto", async () => {
  await queue("fechada", "f1", newMission);
  await run();
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toMatchObject({
    to: "5554922220000",
    type: "template",
    template: {
      name: "guilda_nova_missao",
      components: [
        { type: "body", parameters: [{ text: "Folha" }, { text: "25/11/2026" }, { text: "40" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `t-${TASK}` }] },
      ],
    },
  });
});

test("janela fechada e modelo em análise consultado há pouco: não sai nem pergunta à Meta", async () => {
  await queue("fechada", "f2", approval);
  expect(await run()).toEqual({ claimed: 1, sent: 0 });
  expect(sent).toHaveLength(0);
});

test("número sem confirmação não recebe aviso, mas recebe a resposta do código", async () => {
  await queue("sem-prova", "s1", newMission);
  await queue("sem-prova", "s2", { version: 3, kind: "reply", text: "Esse código não confere." });
  await run();
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toMatchObject({ to: "5554933330000", type: "text", text: { body: "Esse código não confere." } });
});

test("horário de silêncio adia o aviso sem gastar tentativa", async () => {
  await db.insert(schema.memberNotificationPreferences).values({ orgId: ORG, userId: "aberta", quietHoursStart: "00:00", quietHoursEnd: "23:59", timezone: "UTC" });
  await queue("aberta", "q1", newMission);
  await run();
  expect(sent).toHaveLength(0);
  const [row] = await db.select().from(schema.memberWhatsAppOutbox).where(eq(schema.memberWhatsAppOutbox.dedupeKey, "q1"));
  expect(row.status).toBe("pending");
  expect(row.attemptCount).toBe(0);
  expect(row.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
});

test("preferência desligada: o aviso não sai", async () => {
  await db.insert(schema.memberNotificationPreferences).values({ orgId: ORG, userId: "aberta", approvalNotifications: false });
  await queue("aberta", "p1", approval);
  await run();
  expect(sent).toHaveLength(0);
});
