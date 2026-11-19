import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("@/db", () => ({ db }));

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES ('org-whatsapp-member', 'Escritório', 'escritorio', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES ('user-whatsapp-member', 'Bruno', 'bruno@example.test', true, now(), now());
    SET ROLE guilda_app;
    SELECT set_config('app.org_id', 'org-whatsapp-member', false);
  `);
}, 120_000);

afterAll(async () => {
  await client.close();
});

test("aceita número E.164 com o sinal +", async () => {
  await expect(client.exec(`
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164)
    VALUES ('org-whatsapp-member', 'user-whatsapp-member', '+5554984184808');
  `)).resolves.toBeDefined();
});

test("recusa telefone sem o prefixo E.164", async () => {
  await expect(client.exec(`
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164)
    VALUES ('org-whatsapp-member', 'user-whatsapp-member', '5554984184808');
  `)).rejects.toThrow();
});

test("mensagem que chega sem o nono dígito abre a janela de quem salvou com ele", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { recordMemberWhatsAppInbound, isActiveMemberWhatsAppPhone } = await import("./member-notifications");
  await client.exec(`
    RESET ROLE;
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES ('user-nono-digito', 'Fiscal', 'fiscal@example.test', true, now(), now());
    SET ROLE guilda_app;
    INSERT INTO member_whatsapp_connections (org_id, user_id, phone_e164)
    VALUES ('org-whatsapp-member', 'user-nono-digito', '+5554999990000');
  `);
  const occurredAt = new Date("2026-11-19T14:00:00Z");
  // O WhatsApp manda o número da conta (wa_id), que em conta antiga vem sem o 9.
  const matched = await withOrgTx("org-whatsapp-member", (tx) =>
    recordMemberWhatsAppInbound(tx, { orgId: "org-whatsapp-member", phoneE164: "+555499990000", occurredAt }),
  );
  expect(matched).toBe(true);
  const [row] = await db
    .select({ lastInboundAt: schema.memberWhatsAppConnections.lastInboundAt })
    .from(schema.memberWhatsAppConnections)
    .where(eq(schema.memberWhatsAppConnections.userId, "user-nono-digito"));
  expect(row.lastInboundAt).toEqual(occurredAt);
  expect(await withOrgTx("org-whatsapp-member", (tx) => isActiveMemberWhatsAppPhone(tx, { orgId: "org-whatsapp-member", phoneE164: "+555499990000" }))).toBe(true);
});
