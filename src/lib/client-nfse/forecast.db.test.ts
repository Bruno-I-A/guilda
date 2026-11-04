/**
 * A previsão do mês contra um Postgres de verdade (PGlite), como guilda_app:
 * fontes da Guilda e do Portal, abatimento, nota padrão, "não emitir este mês"
 * e o isolamento entre organizações.
 */
import { gzipSync } from "node:zlib";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";
import { testNfseXml } from "@/lib/nfse/testing/nfse-xml";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "orgA";
const OTHER = "orgB";
const ACADEMIA = "00000000-0000-4000-8000-000000000001";
const ENVELOPE = { v: 1 as const, keyId: "0123456789abcdef", wrappedKey: "AAAA", iv: "AAAA", ciphertext: "AAAA" };
const TEMPLATE: NfseIssuerTemplate = {
  cityCode: "4314902",
  taxRegime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
  service: { nationalTaxCode: "060101" },
  issqn: { taxation: "1", withholding: "1" },
  totalTaxes: { kind: "simples", percent: "6.00" },
};
const ACTOR = { orgId: ORG, actorId: "u1" };
const NOVEMBER = { year: 2026, month: 11 };
const DECEMBER = { year: 2026, month: 12 };
const NOW_NOV = new Date("2026-11-20T12:00:00Z");
const NOW = new Date("2026-12-05T12:00:00Z");
const MARIA = "40503119091";
const PADARIA = "33000167000101";
const OFICINA = "11222333000181";
const key = (n: number) => String(n).padStart(50, "0");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let issuerId = "";
let nsu = 1;

async function tx<T>(run: Parameters<typeof import("@/db/org-tx").withOrgTx<T>>[1], org = ORG) {
  const { withOrgTx } = await import("@/db/org-tx");
  return withOrgTx(org, run);
}

/** Uma nota emitida no Portal, como a rotina da aba XML guarda. */
async function portalNote(accessKey: string, issuedAt: string, taker: { cnpj: string; name: string }, amountCents: number, description: string, cancelled = false) {
  const xml = testNfseXml({ taker: { ...taker, address: { cityCode: "4308904", zipCode: "99900000", street: "RUA A", number: "1", complement: null, district: "CENTRO" } }, amountCents, description });
  const n = nsu++;
  await tx((t) =>
    t.insert(schema.nfseIssuedNotes).values({
      orgId: ORG,
      clientId: ACADEMIA,
      accessKey,
      nsu: n,
      issuedAt: new Date(issuedAt),
      xmlGz: gzipSync(xml),
      ...(cancelled ? { cancelledAt: new Date(issuedAt), cancelNsu: n + 1000, cancelXmlGz: Buffer.from("x") } : {}),
    }),
  );
}

/** Pede uma nota pela Guilda e a marca como emitida. */
async function guildaNote(requestId: string, period: { year: number; month: number }, now: Date, document: string, name: string, amount: string, description: string, accessKey: string | null, source?: string) {
  const { emitClientNfseNote } = await import("./emit");
  const result = await tx((t) =>
    emitClientNfseNote(t, { ...ACTOR, issuerId, requestId, taker: { document, name, address: null }, amount, description, reference: "previous", service: null, retentions: null, period, now, sourceAccessKey: source }),
  );
  if (!result.ok) throw new Error(result.error);
  const invoiceId = result.data!.invoiceId;
  if (accessKey) {
    await tx((t) => t.update(schema.clientNfseInvoices).set({ status: "issued", accessKey, nfseNumber: "1", issuedAt: now }).where(eq(schema.clientNfseInvoices.id, invoiceId)));
  }
  return invoiceId;
}

async function forecast(period = DECEMBER, now = NOW, org = ORG, standing: { issuerId: string; takerDocument: string }[] = []) {
  const { loadClientNfseForecast } = await import("./forecast-month");
  const map = await tx((t) => loadClientNfseForecast(t, { orgId: org, now, period, issuers: [{ id: issuerId, clientId: ACADEMIA, active: true }], standing }), org);
  return map.get(issuerId);
}

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now()), ('${OTHER}', 'Outro', 'outro', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES ('${ACADEMIA}', '${ORG}', 'Academia', 'simples', '07412545000154');
  `);
  await client.exec("SET ROLE guilda_app;");
  const registry = await import("./registry");
  const created = await tx((t) => registry.saveClientNfseIssuer(t, { ...ACTOR, issuerId: null, clientId: ACADEMIA, template: TEMPLATE, dpsSeries: "900", active: true }));
  if (!created.ok) throw new Error(created.error);
  issuerId = created.data!.issuerId;
  await tx((t) =>
    t.insert(schema.nfseClientCertificates).values({ orgId: ORG, clientId: ACADEMIA, envelope: ENVELOPE, uploadedBy: "u1", status: "valid", certificateCnpj: "07412545000154", validUntil: new Date("2027-06-01T00:00:00Z") }),
  );
  // Novembro: uma pela Guilda (também guardada pela rotina), duas só no Portal e uma cancelada.
  await guildaNote(uuid(1), NOVEMBER, NOW_NOV, MARIA, "Maria", "150.00", "Atendimentos 10/2026", key(1));
  await portalNote(key(1), "2026-11-20T12:00:00Z", { cnpj: MARIA, name: "Maria" }, 15000, "Atendimentos 10/2026");
  await portalNote(key(2), "2026-11-10T12:00:00Z", { cnpj: PADARIA, name: "Padaria" }, 90000, "Aluguel 11/2026");
  await portalNote(key(3), "2026-11-11T12:00:00Z", { cnpj: PADARIA, name: "Padaria" }, 5000, "Taxa de novembro");
  await portalNote(key(4), "2026-11-12T12:00:00Z", { cnpj: OFICINA, name: "Oficina" }, 7000, "Revisão", true);
  // Outubro não entra: a previsão olha só o mês anterior.
  await portalNote(key(5), "2026-10-12T12:00:00Z", { cnpj: OFICINA, name: "Oficina" }, 8000, "Trimestral");
}, 120_000);

afterAll(() => client.close());

test("a previsão une Guilda e Portal, sem repetir a mesma nota, sem cancelada e sem mês mais antigo", async () => {
  const result = await forecast();
  expect(result?.notes.map((note) => [note.sourceAccessKey, note.takerDocument, note.amount, note.description, note.textNeedsReview])).toEqual([
    [key(1), MARIA, "150.00", "Atendimentos 11/2026", false],
    [key(3), PADARIA, "50.00", "Taxa de novembro", true],
    [key(2), PADARIA, "900.00", "Aluguel 12/2026", false],
  ]);
});

test("a prevista traz o que o formulário precisa: tomador do cadastro ou o endereço da nota de origem", async () => {
  const result = await forecast();
  const maria = result!.notes.find((note) => note.takerDocument === MARIA)!;
  expect(maria.takerId).not.toBeNull();
  const padaria = result!.notes.find((note) => note.takerDocument === PADARIA)!;
  expect(padaria.takerId).toBeNull();
  expect(padaria.address).toMatchObject({ street: "RUA A", zipCode: "99900000" });
  expect(padaria.service).toMatchObject({ nationalTaxCode: "171901", municipalTaxCode: "001" });
});

test("só o mês corrente tem previsão", async () => {
  expect(await forecast(NOVEMBER, NOW)).toBeUndefined();
  expect(await forecast({ year: 2027, month: 1 }, NOW)).toBeUndefined();
});

test("nota padrão em aberto ocupa o lugar da prevista da pessoa", async () => {
  const result = await forecast(DECEMBER, NOW, ORG, [{ issuerId, takerDocument: MARIA }]);
  expect(result?.notes.some((note) => note.takerDocument === MARIA)).toBe(false);
});

test("não emitir este mês some da conta e desfazer traz de volta", async () => {
  const { skipClientNfseForecast, restoreClientNfseForecast } = await import("./forecast-month");
  const skip = () => tx((t) => skipClientNfseForecast(t, { ...ACTOR, issuerId, sourceAccessKey: key(3), period: DECEMBER }));
  expect((await skip()).ok).toBe(true);
  expect((await skip()).ok).toBe(true);
  let result = await forecast();
  expect(result?.notes.map((note) => note.sourceAccessKey)).not.toContain(key(3));
  expect(result?.skipped.map((note) => note.sourceAccessKey)).toEqual([key(3)]);
  expect((await tx((t) => skipClientNfseForecast(t, { ...ACTOR, issuerId, sourceAccessKey: key(4), period: DECEMBER }))).ok).toBe(false);
  expect((await tx((t) => skipClientNfseForecast(t, { ...ACTOR, issuerId, sourceAccessKey: key(99), period: DECEMBER }))).ok).toBe(false);
  await tx((t) => restoreClientNfseForecast(t, { orgId: ORG, issuerId, sourceAccessKey: key(3), period: DECEMBER }));
  result = await forecast();
  expect(result?.skipped).toEqual([]);
  expect(result?.notes.map((note) => note.sourceAccessKey)).toContain(key(3));
});

test("outra organização não vê nada", async () => {
  const result = await forecast(DECEMBER, NOW, OTHER);
  expect(result?.notes ?? []).toEqual([]);
});

test("emitir a prevista tira só ela; nota pela Guilda ou no Portal abate a da pessoa; cancelar devolve", async () => {
  const invoiceId = await guildaNote(uuid(2), DECEMBER, NOW, MARIA, "Maria", "150.00", "Atendimentos 11/2026", null, key(1));
  let keys = (await forecast())?.notes.map((note) => note.sourceAccessKey);
  expect(keys).toEqual([key(3), key(2)]);

  // A nota nem saiu e já tira a prevista; com erro, ela aparece como erro, não como prevista.
  await tx((t) => t.update(schema.clientNfseInvoices).set({ status: "failed", lastError: "E0000" }).where(eq(schema.clientNfseInvoices.id, invoiceId)));
  keys = (await forecast())?.notes.map((note) => note.sourceAccessKey);
  expect(keys).toEqual([key(3), key(2)]);
  // Descartada, a origem volta a ser prevista.
  const { discardClientNfseInvoice } = await import("./month");
  await tx((t) => discardClientNfseInvoice(t, { ...ACTOR, invoiceId }));
  keys = (await forecast())?.notes.map((note) => note.sourceAccessKey);
  expect(keys).toEqual([key(1), key(3), key(2)]);

  // Feita no Portal em dezembro, com o mesmo valor: abate a de 900,00 da Padaria.
  await portalNote(key(6), "2026-12-02T12:00:00Z", { cnpj: PADARIA, name: "Padaria" }, 90000, "Aluguel 12/2026");
  keys = (await forecast())?.notes.map((note) => note.sourceAccessKey);
  expect(keys).toEqual([key(1), key(3)]);
  // Cancelada no Portal, a prevista volta.
  await client.exec("RESET ROLE;");
  await client.exec(`UPDATE nfse_issued_notes SET cancelled_at = now(), cancel_nsu = 9000, cancel_xml_gz = '\\x00' WHERE access_key = '${key(6)}';`);
  await client.exec("SET ROLE guilda_app;");
  keys = (await forecast())?.notes.map((note) => note.sourceAccessKey);
  expect(keys).toEqual([key(1), key(3), key(2)]);
});

test("mostra quando as notas do Portal foram lidas pela última vez", async () => {
  expect((await forecast())?.portalReadAt).toBeNull();
  const readAt = new Date("2026-12-05T06:00:00Z");
  await tx((t) => t.insert(schema.nfseDfeCursors).values({ orgId: ORG, clientId: ACADEMIA, lastSyncedAt: readAt, updatedAt: readAt }));
  expect((await forecast())?.portalReadAt).toBe(readAt.toISOString());
});

test("a tela recebe a previsão junto das notas do mês", async () => {
  const { loadClientNfseWorkspace } = await import("./loaders");
  const workspace = await tx((t) => loadClientNfseWorkspace(t, { orgId: ORG, ...DECEMBER, now: NOW }));
  const academia = workspace.issuers.find((issuer) => issuer.id === issuerId)!;
  expect(academia.forecast.notes.length).toBeGreaterThan(0);
  const past = await tx((t) => loadClientNfseWorkspace(t, { orgId: ORG, ...NOVEMBER, now: NOW }));
  expect(past.issuers.find((issuer) => issuer.id === issuerId)!.forecast.notes).toEqual([]);
});
