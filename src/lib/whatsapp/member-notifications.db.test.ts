import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";

import { applyMigrations } from "@/lib/nfse/testing/pglite";

const client = new PGlite();

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
