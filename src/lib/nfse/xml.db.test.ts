/**
 * Pasta de XML e cofre contra um Postgres de verdade (PGlite), como
 * guilda_app: RLS, nota que não se apaga, só o cancelamento muda, cursor que
 * só avança.
 */
import { gunzipSync } from "node:zlib";

import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
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
const CLIENT = "00000000-0000-4000-8000-000000000001";
// Segunda e terceira empresas da mesma organização.
const CLIENT2 = "00000000-0000-4000-8000-000000000002";
const CLIENT3 = "00000000-0000-4000-8000-000000000003";
const KEY = "4".repeat(50);
const ENVELOPE = { v: 1 as const, keyId: "0123456789abcdef", wrappedKey: "AAAA", iv: "AAAA", ciphertext: "AAAA" };

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now()), ('${OTHER}', 'Outro', 'outro', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES
      ('${CLIENT}', '${ORG}', 'Padaria', 'simples', '33000167000101'),
      ('${CLIENT2}', '${ORG}', 'Mercado', 'simples', '44000167000102'),
      ('${CLIENT3}', '${ORG}', 'Oficina', 'simples', '55000167000103');
    INSERT INTO nfse_settings (org_id, provider_cnpj, dps_series) VALUES ('${ORG}', '11222333000181', '1');
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

// Fechar libera a memória do Postgres em WASM (máquina com pouca RAM derruba o processo).
afterAll(() => client.close());

test("certificado: pendente, conferido, listado para a rotina; chave pública publicada", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./xml-repository");
  await withOrgTx(ORG, (tx) => tx.insert(schema.nfseClientCertificates).values({ orgId: ORG, clientId: CLIENT, envelope: ENVELOPE, uploadedBy: "u1" }));
  const [pending] = await repo.listPendingCertificates(ORG);
  expect(pending).toMatchObject({ clientCnpj: "33000167000101", envelope: ENVELOPE });
  const now = new Date("2026-10-19T12:00:00Z");
  await repo.saveCertificateCheck(ORG, { id: pending.id, wrappedKey: pending.envelope.wrappedKey, result: { status: "valid", cnpj: "33000167000101", validUntil: new Date("2027-03-19T00:00:00Z") }, now });
  expect(await repo.listPendingCertificates(ORG)).toEqual([]);
  expect(await repo.listRoutineClients(ORG, now)).toEqual([{ clientId: CLIENT, cnpj: "33000167000101", lastNsu: 0, envelope: ENVELOPE }]);
  // Vencido sai da rotina.
  expect(await repo.listRoutineClients(ORG, new Date("2027-04-01T00:00:00Z"))).toEqual([]);
  await repo.publishVaultKey(ORG, { keyId: "fedcba9876543210", publicKeySpki: "AAAA" });
  const [settings] = await withOrgTx(ORG, (tx) => tx.select({ keyId: schema.nfseSettings.vaultKeyId }).from(schema.nfseSettings));
  expect(settings.keyId).toBe("fedcba9876543210");
});

test("certificado: reenvio no meio da conferência vence; certificado se remove", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./xml-repository");
  const c = schema.nfseClientCertificates;
  await withOrgTx(ORG, (tx) => tx.insert(c).values({ orgId: ORG, clientId: CLIENT2, envelope: ENVELOPE, uploadedBy: "u1" }));
  const [pending] = await repo.listPendingCertificates(ORG);
  expect(pending.envelope.wrappedKey).toBe("AAAA");

  // O Fiscal reenvia enquanto o serviço confere o envio anterior.
  const resent = { ...ENVELOPE, wrappedKey: "BBBB" };
  await withOrgTx(ORG, (tx) =>
    tx.update(c).set({ envelope: resent, status: "pending", uploadedAt: new Date() }).where(and(eq(c.orgId, ORG), eq(c.clientId, CLIENT2))),
  );
  const now = new Date("2026-10-19T12:00:00Z");
  await repo.saveCertificateCheck(ORG, { id: pending.id, wrappedKey: pending.envelope.wrappedKey, result: { status: "valid", cnpj: "44000167000102", validUntil: new Date("2027-03-19T00:00:00Z") }, now });
  const [afterStale] = await withOrgTx(ORG, (tx) => tx.select().from(c).where(eq(c.clientId, CLIENT2)));
  expect(afterStale).toMatchObject({ status: "pending", checkedAt: null, envelope: resent });

  // A conferência do envio novo grava.
  const [again] = await repo.listPendingCertificates(ORG);
  expect(again.envelope.wrappedKey).toBe("BBBB");
  await repo.saveCertificateCheck(ORG, { id: again.id, wrappedKey: again.envelope.wrappedKey, result: { status: "invalid", message: "x".repeat(600) }, now });
  const [checked] = await withOrgTx(ORG, (tx) => tx.select().from(c).where(eq(c.clientId, CLIENT2)));
  expect(checked).toMatchObject({ status: "invalid", checkedAt: now, certificateCnpj: null, validUntil: null });
  expect(checked.statusMessage).toHaveLength(500);

  // Certificado se remove.
  const removed = await withOrgTx(ORG, (tx) => tx.delete(c).where(and(eq(c.orgId, ORG), eq(c.clientId, CLIENT2))).returning({ id: c.id }));
  expect(removed).toHaveLength(1);
});

test("pasta: lote gravado uma vez só, cancelamento tardio, cursor só avança", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./xml-repository");
  const now = new Date("2026-10-19T12:00:00Z");
  const issued = { accessKey: KEY, nsu: 3, nfseNumber: "107", issuedAt: new Date("2026-09-30T23:59:00-03:00"), competence: "2026-09-30", xml: "<NFSe>107</NFSe>" };
  await repo.saveAdnProgress(ORG, { clientId: CLIENT, issued: [issued], cancellations: [], lastNsu: 3, finished: false }, now);
  await repo.saveAdnProgress(ORG, { clientId: CLIENT, issued: [issued], cancellations: [], lastNsu: 2, finished: true }, now);
  await repo.saveAdnProgress(ORG, { clientId: CLIENT, issued: [], cancellations: [{ accessKey: KEY, nsu: 9, cancelledAt: null, xml: "<evento/>" }], lastNsu: 9, finished: true }, now);
  const notes = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseIssuedNotes));
  expect(notes).toHaveLength(1);
  expect(gunzipSync(notes[0].xmlGz).toString("utf8")).toBe("<NFSe>107</NFSe>");
  expect(notes[0]).toMatchObject({ cancelNsu: 9, cancelledAt: now });
  const [cursor] = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseDfeCursors));
  expect(cursor).toMatchObject({ lastNsu: 9, lastError: null });
  expect(cursor.initialSyncAt).toEqual(now);

  // Outra organização não vê nada (RLS).
  expect(await withOrgTx(OTHER, (tx) => tx.select().from(schema.nfseIssuedNotes))).toEqual([]);
  // Nota não se apaga e o XML não muda.
  await expect(withOrgTx(ORG, (tx) => tx.execute(sql`DELETE FROM nfse_issued_notes`))).rejects.toThrow();
  await expect(withOrgTx(ORG, (tx) => tx.execute(sql`UPDATE nfse_issued_notes SET xml_gz = '\\x00'`))).rejects.toThrow();
});

test("pasta: nota e cancelamento no mesmo lote; cancelamento de outra empresa não marca nada", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./xml-repository");
  const n = schema.nfseIssuedNotes;
  const now = new Date("2026-10-19T12:00:00Z");
  const sameBatchKey = "5".repeat(50);
  const cancelledAt = new Date("2026-10-02T10:00:00Z");
  await repo.saveAdnProgress(
    ORG,
    {
      clientId: CLIENT,
      issued: [{ accessKey: sameBatchKey, nsu: 10, nfseNumber: "108", issuedAt: new Date("2026-10-01T09:00:00-03:00"), competence: "2026-10-01", xml: "<NFSe>108</NFSe>" }],
      cancellations: [{ accessKey: sameBatchKey, nsu: 11, cancelledAt, xml: "<evento>108</evento>" }],
      lastNsu: 11,
      finished: false,
    },
    now,
  );
  const [sameBatch] = await withOrgTx(ORG, (tx) => tx.select().from(n).where(eq(n.accessKey, sameBatchKey)));
  expect(sameBatch).toMatchObject({ nfseNumber: "108", cancelNsu: 11, cancelledAt });
  expect(gunzipSync(sameBatch.cancelXmlGz!).toString("utf8")).toBe("<evento>108</evento>");

  // A nota é da Padaria; o cancelamento chega pela leitura do Mercado.
  const otherKey = "6".repeat(50);
  await repo.saveAdnProgress(
    ORG,
    {
      clientId: CLIENT,
      issued: [{ accessKey: otherKey, nsu: 12, nfseNumber: "109", issuedAt: new Date("2026-10-03T09:00:00-03:00"), competence: "2026-10-03", xml: "<NFSe>109</NFSe>" }],
      cancellations: [],
      lastNsu: 12,
      finished: false,
    },
    now,
  );
  await repo.saveAdnProgress(ORG, { clientId: CLIENT2, issued: [], cancellations: [{ accessKey: otherKey, nsu: 5, cancelledAt: null, xml: "<evento/>" }], lastNsu: 5, finished: false }, now);
  const [untouched] = await withOrgTx(ORG, (tx) => tx.select().from(n).where(eq(n.accessKey, otherKey)));
  expect(untouched).toMatchObject({ clientId: CLIENT, cancelledAt: null, cancelNsu: null, cancelXmlGz: null });
});

test("cursor: erro gravado cortado, lote seguinte limpa; erro na primeira leitura cria o cursor no 0", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const repo = await import("./xml-repository");
  const cur = schema.nfseDfeCursors;
  const now = new Date("2026-10-19T12:00:00Z");
  const cursorOf = async (clientId: string) => (await withOrgTx(ORG, (tx) => tx.select().from(cur).where(eq(cur.clientId, clientId))))[0];

  // A Oficina nunca foi lida: o erro da primeira leitura cria o cursor.
  await repo.saveAdnError(ORG, CLIENT3, "Sistema Nacional fora do ar.", now);
  expect(await cursorOf(CLIENT3)).toMatchObject({ lastNsu: 0, lastError: "Sistema Nacional fora do ar.", initialSyncAt: null, lastSyncedAt: null });

  const before = await cursorOf(CLIENT);
  await repo.saveAdnError(ORG, CLIENT, "é".repeat(600), now);
  const failed = await cursorOf(CLIENT);
  expect(failed.lastError).toHaveLength(500);
  // O erro não mexe no NSU nem nas datas de leitura.
  expect(failed).toMatchObject({ lastNsu: before.lastNsu, initialSyncAt: before.initialSyncAt, lastSyncedAt: before.lastSyncedAt });

  await repo.saveAdnProgress(ORG, { clientId: CLIENT, issued: [], cancellations: [], lastNsu: before.lastNsu, finished: true }, now);
  expect(await cursorOf(CLIENT)).toMatchObject({ lastNsu: before.lastNsu, lastError: null });
});

test("rotina: estado padrão, início e fim da rodada", async () => {
  const repo = await import("./xml-repository");
  expect((await repo.loadXmlRoutineState(ORG)).schedule).toEqual({ enabled: true, frequency: "daily", dayOfMonth: null, time: "06:00" });
  const startedAt = new Date("2026-10-19T09:00:00Z");
  await repo.markXmlRoutineRun(ORG, { startedAt });
  const finishedAt = new Date("2026-10-19T09:05:00Z");
  await repo.markXmlRoutineRun(ORG, { finishedAt });
  expect((await repo.loadXmlRoutineState(ORG)).lastRunStartedAt).toEqual(startedAt);
  expect((await repo.loadXmlRoutineState(ORG)).lastRunFinishedAt).toEqual(finishedAt);

  // A rodada seguinte começa e não apaga o fim da anterior (é assim que a interrompida se reconhece).
  const nextStart = new Date("2026-10-20T09:00:00Z");
  await repo.markXmlRoutineRun(ORG, { startedAt: nextStart });
  expect(await repo.loadXmlRoutineState(ORG)).toMatchObject({ lastRunStartedAt: nextStart, lastRunFinishedAt: finishedAt, keepSince: null, runRequestedAt: null });
});

test("guilda_app: configuração e cursor não se apagam; RLS em pé nas tabelas novas", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  // O Drizzle embrulha o erro do banco; a causa diz que foi o privilégio.
  const denied = { cause: { message: expect.stringMatching(/permission denied/) } };
  await expect(withOrgTx(ORG, (tx) => tx.execute(sql`DELETE FROM nfse_xml_routines`))).rejects.toMatchObject(denied);
  await expect(withOrgTx(ORG, (tx) => tx.execute(sql`DELETE FROM nfse_dfe_cursors`))).rejects.toMatchObject(denied);
  const { rows } = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relkind = 'r' AND relname IN ('nfse_client_certificates', 'nfse_xml_routines', 'nfse_dfe_cursors', 'nfse_issued_notes')
      ORDER BY relname`,
  );
  expect(rows).toEqual(
    ["nfse_client_certificates", "nfse_dfe_cursors", "nfse_issued_notes", "nfse_xml_routines"].map((relname) => ({
      relname,
      relrowsecurity: true,
      relforcerowsecurity: true,
    })),
  );
});
