/**
 * A fila das notas contra um Postgres de verdade (PGlite, em WASM, sem Docker),
 * conectado como guilda_app com os default privileges dos ambientes reais
 * (docker/dev/init/01-roles.sql). Pega o que teste puro não pega: RLS, UPDATE
 * só nas colunas do ciclo de vida e a transação da etapa do controle.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "orgA";

beforeAll(async () => {
  const dir = path.resolve(process.cwd(), "src/db/migrations");
  const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8"));
  await client.exec(`
    CREATE ROLE guilda_app NOLOGIN NOSUPERUSER;
    GRANT USAGE ON SCHEMA public TO guilda_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO guilda_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO guilda_app;
  `);
  for (const entry of journal.entries) {
    for (const statement of readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES
      ('00000000-0000-4000-8000-000000000001', '${ORG}', 'Padaria Pão Quente', 'simples', '33000167000101'),
      ('00000000-0000-4000-8000-000000000002', '${ORG}', 'Sem CNPJ', 'simples', NULL);
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

test("ciclo completo: enfileirar, emitir, marcar etapa, cancelar, reabrir", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { materializeOfficeFeeControl } = await import("@/lib/office-fees/materialize");
  const requests = await import("./requests");
  const repo = await import("./repository");
  const { TEST_TEMPLATE } = await import("./testing/fixtures");

  await withOrgTx(ORG, async (tx) => {
    await tx.insert(schema.officeFeeProfiles).values([
      { orgId: ORG, clientId: "00000000-0000-4000-8000-000000000001", billingMethod: "pix", monthlyFee: "850.00", chargesAdditionalInstallment: true },
      { orgId: ORG, clientId: "00000000-0000-4000-8000-000000000002", billingMethod: "pix", monthlyFee: "500.00" },
    ]);
    await materializeOfficeFeeControl(tx, { orgId: ORG, actorId: "u1", periodYear: 2026, periodMonth: 9 });
    expect((await requests.upsertNfseSettings(tx, { orgId: ORG, actorId: "u1", providerCnpj: "11222333000181", dpsSeries: "1", template: TEST_TEMPLATE })).ok).toBe(true);
  });

  const preview = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 9, includeAdditional: true }));
  expect(preview.items.map((item) => item.kind)).toEqual(["monthly", "additional_installment"]);
  expect(preview.excluded.map((item) => item.reason)).toEqual(["missing_cnpj"]);

  const stale = await withOrgTx(ORG, (tx) => requests.enqueueNfseBatch(tx, { orgId: ORG, actorId: "u1", year: 2026, month: 9, includeAdditional: true, expectedCount: 1, expectedTotalCents: 85000, today: "2026-10-05" }));
  expect(stale.ok).toBe(false);
  const queued = await withOrgTx(ORG, (tx) => requests.enqueueNfseBatch(tx, { orgId: ORG, actorId: "u1", year: 2026, month: 9, includeAdditional: true, expectedCount: 2, expectedTotalCents: 170000, today: "2026-10-05" }));
  expect(queued).toEqual({ ok: true, data: { queued: 2 } });

  // Repetir não duplica: a prévia já não tem nada.
  const again = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 9, includeAdditional: true }));
  expect(again.items).toHaveLength(0);

  // Batimento acha a organização.
  expect(await repo.registerFiscalService({ cnpj: "11222333000181", environment: 2, certificateValidUntil: new Date("2027-01-01"), error: null })).toBe(ORG);

  // Serviço: reivindica, emite as duas.
  const first = await repo.claimNfseJob(ORG);
  expect(first?.attemptCount).toBe(1);
  expect(first?.dpsNumber).toBe(1);
  expect(await repo.claimNfseJob(ORG).then((claim) => claim?.dpsNumber)).toBe(2); // a segunda, porque a primeira está com lease
  expect(await repo.finishNfseJob(ORG, first!, { kind: "issued", accessKey: "4".repeat(50), nfseNumber: "77", environment: 2 })).toBe(true);
  // lease errado não grava
  expect(await repo.finishNfseJob(ORG, { ...first!, lockToken: "00000000-0000-4000-8000-00000000dead" }, { kind: "failed", message: "x", errors: [] })).toBe(false);

  const control = await withOrgTx(ORG, (tx) => tx.select().from(schema.officeFeeControlPeriods).where(sql`client_id = '00000000-0000-4000-8000-000000000001'`));
  expect(control[0].invoiceStatus).toBe("completed");

  const month = await withOrgTx(ORG, (tx) => requests.loadNfseMonth(tx, { orgId: ORG, year: 2026, month: 9 }));
  const issued = month.find((row) => row.kind === "monthly");
  expect(issued?.status).toBe("issued");
  expect(await withOrgTx(ORG, (tx) => requests.loadDanfseItems(tx, { orgId: ORG, year: 2026, month: 9 }))).toEqual([
    { accessKey: "4".repeat(50), fileName: "000077-padaria-pao-quente.pdf" },
  ]);

  // Cancelamento.
  expect((await withOrgTx(ORG, (tx) => requests.requestNfseCancel(tx, { orgId: ORG, actorId: "u1", invoiceId: issued!.id, reasonCode: 1, reasonText: "Valor do honorário errado." }))).ok).toBe(true);
  // A PA ainda está com lease vencendo só em 5 min; a próxima reivindicação é o cancelamento.
  const cancelClaim = await repo.claimNfseJob(ORG);
  expect(cancelClaim?.status).toBe("cancel_requested");
  expect(await repo.finishNfseJob(ORG, cancelClaim!, { kind: "cancelled" })).toBe(true);
  const reopened = await withOrgTx(ORG, (tx) => tx.select().from(schema.officeFeeControlPeriods).where(sql`client_id = '00000000-0000-4000-8000-000000000001'`));
  expect(reopened[0].invoiceStatus).toBe("pending");

  // Nota cancelada libera a vaga: a mensal volta para a prévia.
  const afterCancel = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 9, includeAdditional: false }));
  expect(afterCancel.items.map((item) => item.kind)).toEqual(["monthly"]);

  // Outra organização não enxerga as notas; valor da nota não se edita.
  expect(await withOrgTx("orgB", (tx) => tx.select().from(schema.nfseInvoices))).toHaveLength(0);
  const denied = await withOrgTx(ORG, (tx) => tx.update(schema.nfseInvoices).set({ amount: "1.00" })).then(
    () => "gravou",
    (error: Error) => String((error.cause as Error | undefined)?.message ?? error.message),
  );
  expect(denied).toMatch(/permission denied/);

  const events = await withOrgTx(ORG, (tx) => tx.select({ type: schema.nfseInvoiceEvents.eventType }).from(schema.nfseInvoiceEvents));
  expect(events.map((event) => event.type).sort()).toEqual(["cancel_requested", "cancelled", "issued", "requested", "requested"]);
}, 120_000);
