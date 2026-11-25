import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

import { fiscalProfileSnapshot } from "./materialize";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "org-fiscal-profile";
const CLIENT = "00000000-0000-4000-8000-000000000051";

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES ('${ORG}', 'Escritório', 'fiscal-profile', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES ('fiscal-user', 'Fiscal', 'fiscal-profile@example.test', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime)
    VALUES ('${CLIENT}', '${ORG}', 'Empresa', 'simples');
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

afterAll(() => client.close());

test("Ficha Fiscal persiste os seis informativos no perfil e no snapshot", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const [created] = await withOrgTx(ORG, (tx) =>
    tx
      .insert(schema.fiscalClientProfiles)
      .values({
        orgId: ORG,
        clientId: CLIENT,
        createdBy: "fiscal-user",
        updatedBy: "fiscal-user",
      })
      .returning(),
  );

  expect(created).toMatchObject({
    spedApplicability: "unknown",
    giaApplicability: "unknown",
    deisApplicability: "unknown",
    pgdasApplicability: "unknown",
    efdContributionsApplicability: "unknown",
    mitApplicability: "unknown",
  });

  const [updated] = await withOrgTx(ORG, (tx) =>
    tx
      .update(schema.fiscalClientProfiles)
      .set({
        spedApplicability: "required",
        giaApplicability: "not_required",
        deisApplicability: "not_applicable",
        pgdasApplicability: "required",
        efdContributionsApplicability: "required",
        mitApplicability: "not_required",
      })
      .where(eq(schema.fiscalClientProfiles.id, created.id))
      .returning(),
  );

  expect(fiscalProfileSnapshot(updated)).toMatchObject({
    spedApplicability: "required",
    giaApplicability: "not_required",
    deisApplicability: "not_applicable",
    pgdasApplicability: "required",
    efdContributionsApplicability: "required",
    mitApplicability: "not_required",
  });
});
