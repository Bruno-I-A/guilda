/**
 * Credenciais contra um Postgres de verdade (PGlite), como guilda_app: RLS,
 * modo efetivo, cursor zerado na troca e pedidos de teste de procuração.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";

import { applyMigrations } from "./testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "orgA";
const OTHER = "orgB";
// Padaria: CNAE de serviço (divisão 62). Mercado: comércio (47).
const PADARIA = "00000000-0000-4000-8000-000000000001";
const MERCADO = "00000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now()), ('${OTHER}', 'Outro', 'outro', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj, cnae_code) VALUES
      ('${PADARIA}', '${ORG}', 'Padaria', 'simples', '33000167000101', '6201501'),
      ('${MERCADO}', '${ORG}', 'Mercado', 'simples', '44000167000102', '4711302');
    INSERT INTO nfse_dfe_cursors (org_id, client_id, last_nsu, history_nsu) VALUES ('${ORG}', '${PADARIA}', 80, 12);
    INSERT INTO nfse_issued_notes (org_id, client_id, access_key, nsu, issued_at, competence, xml_gz)
      VALUES ('${ORG}', '${PADARIA}', '${"4".repeat(50)}', 41, now(), '2026-10-01', '\\x00'),
             ('${ORG}', '${PADARIA}', '${"5".repeat(50)}', 57, now(), '2026-10-01', '\\x00');
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

afterAll(() => client.close());

test("sem nada gravado: padrão certificado, empresa segue o padrão, selo não testado", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./credentials-repository");
  expect(await withOrgTx(ORG, (tx) => repo.credentialPolicyIn(tx, ORG))).toEqual({ defaultMode: "certificate", proxyTestRequestedAt: null });
  expect(await repo.loadClientCredential(ORG, PADARIA)).toEqual({ mode: "certificate", explicitMode: null, proxyStatus: "untested" });

  await withOrgTx(ORG, (tx) => repo.setDefaultModeIn(tx, ORG, { mode: "proxy", actorId: "u1", now: new Date() }));
  await withOrgTx(ORG, (tx) => repo.setClientModeIn(tx, ORG, { clientId: MERCADO, mode: "certificate", actorId: "u1", now: new Date() }));
  expect(await repo.loadClientCredential(ORG, PADARIA)).toMatchObject({ mode: "proxy", explicitMode: null });
  expect(await repo.loadClientCredential(ORG, MERCADO)).toMatchObject({ mode: "certificate", explicitMode: "certificate" });
  await withOrgTx(ORG, (tx) => repo.setDefaultModeIn(tx, ORG, { mode: "certificate", actorId: "u1", now: new Date() }));
  await withOrgTx(ORG, (tx) => repo.setClientModeIn(tx, ORG, { clientId: MERCADO, mode: null, actorId: "u1", now: new Date() }));
});

test("trocar a credencial zera o cursor e a releitura do histórico, e guarda a credencial do cursor", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./credentials-repository");
  await repo.resetCursorForMode(ORG, PADARIA, "proxy", new Date("2026-11-18T12:00:00Z"));
  const [cursor] = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseDfeCursors));
  expect(cursor).toMatchObject({ lastNsu: 0, historyNsu: 0 });
  // Empresa sem cursor ainda: nasce zerado, sem releitura inventada.
  await repo.resetCursorForMode(ORG, MERCADO, "proxy", new Date("2026-11-18T12:00:00Z"));
  const cursors = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseDfeCursors));
  expect(cursors.find((row) => row.clientId === MERCADO)).toMatchObject({ lastNsu: 0, historyNsu: null });
  const credentials = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseClientCredentials));
  expect(credentials.find((row) => row.clientId === PADARIA)).toMatchObject({ readMode: "proxy", mode: null });
});

test("pedidos de teste: todas as de serviço, uma pelo pedido próprio; limpa só o que foi pedido antes", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./credentials-repository");
  const before = new Date("2026-11-18T12:00:00Z");
  expect(await repo.listProxyTestTargets(ORG)).toEqual([]);

  await withOrgTx(ORG, (tx) => repo.requestProxyTestFor(tx, ORG, { clientId: null, actorId: "u1", now: before }));
  // Para todas: só a de serviço, com a nota mais antiga guardada.
  expect(await repo.listProxyTestTargets(ORG)).toEqual([{ clientId: PADARIA, cnpj: "33000167000101", oldestStoredNsu: 41 }]);
  await withOrgTx(ORG, (tx) => repo.requestProxyTestFor(tx, ORG, { clientId: MERCADO, actorId: "u1", now: before }));
  expect((await repo.listProxyTestTargets(ORG)).map((target) => target.clientId).sort()).toEqual([PADARIA, MERCADO].sort());

  await repo.saveProxyStatus(ORG, PADARIA, { status: "invalid", code: "E2245", message: "Não há procuração", checkedAt: before, sameSequence: null });
  expect(await repo.loadClientCredential(ORG, PADARIA)).toMatchObject({ proxyStatus: "invalid" });

  // Pedido feito durante o teste fica para a próxima volta.
  const during = new Date("2026-11-18T12:05:00Z");
  await withOrgTx(ORG, (tx) => repo.requestProxyTestFor(tx, ORG, { clientId: PADARIA, actorId: "u1", now: during }));
  await repo.clearProxyTestRequests(ORG, new Date("2026-11-18T12:01:00Z"));
  expect(await repo.listProxyTestTargets(ORG)).toEqual([{ clientId: PADARIA, cnpj: "33000167000101", oldestStoredNsu: 41 }]);

  expect(await repo.storedNsuByKey(ORG, PADARIA, ["4".repeat(50), "9".repeat(50)])).toEqual(new Map([["4".repeat(50), 41]]));
  // Outra organização não vê nada.
  expect(await withOrgTx(OTHER, (tx) => tx.select().from(schema.nfseClientCredentials))).toHaveLength(0);
  expect(await withOrgTx(OTHER, (tx) => tx.select().from(schema.nfseCredentialSettings))).toHaveLength(0);
});

test("o app não apaga configuração nem credencial", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const denied = { cause: { message: expect.stringMatching(/permission denied/) } };
  await expect(withOrgTx(ORG, (tx) => tx.delete(schema.nfseClientCredentials))).rejects.toMatchObject(denied);
  await expect(withOrgTx(ORG, (tx) => tx.delete(schema.nfseCredentialSettings))).rejects.toMatchObject(denied);
});

test("rotina: por procuração lê as de serviço sem certificado; o comércio só com a procuração marcada", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./credentials-repository");
  const xml = await import("./xml-repository");
  const now = new Date("2026-11-18T12:00:00Z");
  // Padrão certificado e nenhuma empresa com A1: ninguém é lido.
  expect(await xml.listRoutineClients(ORG, now)).toEqual([]);
  await withOrgTx(ORG, (tx) => repo.setDefaultModeIn(tx, ORG, { mode: "proxy", actorId: "u1", now }));
  expect(await xml.listRoutineClients(ORG, now)).toEqual([
    { clientId: PADARIA, cnpj: "33000167000101", lastNsu: 0, historyFromNsu: 0, mode: "proxy", readMode: "proxy", envelope: null },
  ]);
  await withOrgTx(ORG, (tx) => repo.setClientModeIn(tx, ORG, { clientId: MERCADO, mode: "proxy", actorId: "u1", now }));
  expect((await xml.listRoutineClients(ORG, now)).map((row) => row.clientId)).toEqual([MERCADO, PADARIA]);
});

test("aba XML: credencial de cada empresa, painel Credenciais e problemas seguem o modo", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const views = await import("./xml-requests");
  // Daqui: padrão procuração, Padaria com a procuração recusada e um teste pedido para ela.
  const companies = await withOrgTx(ORG, (tx) => views.loadXmlCompanies(tx, { orgId: ORG, year: 2026, month: 10 }));
  expect(companies.find((company) => company.clientId === PADARIA)?.credential).toMatchObject({
    mode: "proxy",
    explicitMode: null,
    proxyStatus: "invalid",
    testRequested: true,
  });
  expect(companies.find((company) => company.clientId === MERCADO)?.credential).toMatchObject({ mode: "proxy", explicitMode: "proxy" });
  expect(await withOrgTx(ORG, (tx) => views.loadXmlCredentialsView(tx, ORG))).toEqual({
    defaultMode: "proxy",
    testRequested: true,
    office: { validUntil: null, error: null },
  });
  const routine = await withOrgTx(ORG, (tx) => views.loadXmlRoutineView(tx, ORG, new Date()));
  expect(routine.problems).toContainEqual({ clientName: "Padaria", message: "procuração recusada" });
});
