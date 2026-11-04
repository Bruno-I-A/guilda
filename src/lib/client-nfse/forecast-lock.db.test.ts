/**
 * A trava da previsão do mês, contra um Postgres de verdade (PGlite), como
 * guilda_app: cada nota do mês anterior gera no máximo uma nota no mês, venha
 * ela da Guilda ou do Portal. É o que impede nota real em dobro.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "orgA";
const ACADEMIA = "00000000-0000-4000-8000-000000000001";
const MERCADO = "00000000-0000-4000-8000-000000000002";
const ENVELOPE = { v: 1 as const, keyId: "0123456789abcdef", wrappedKey: "AAAA", iv: "AAAA", ciphertext: "AAAA" };
const TEMPLATE: NfseIssuerTemplate = {
  cityCode: "4314902",
  taxRegime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
  service: { nationalTaxCode: "060101" },
  issqn: { taxation: "1", withholding: "1" },
  totalTaxes: { kind: "simples", percent: "6.00" },
};
const NOW = new Date("2026-12-05T12:00:00Z");
const ACTOR = { orgId: ORG, actorId: "u1" };
const DECEMBER = { year: 2026, month: 12 };
const key = (n: number) => String(n).padStart(50, "0");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let issuerId = "";

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES
      ('${ACADEMIA}', '${ORG}', 'Academia', 'simples', '33000167000101'),
      ('${MERCADO}', '${ORG}', 'Mercado', 'simples', '07412545000154');
  `);
  await client.exec("SET ROLE guilda_app;");
  const { withOrgTx } = await import("@/db/org-tx");
  const registry = await import("./registry");
  const created = await withOrgTx(ORG, (tx) => registry.saveClientNfseIssuer(tx, { ...ACTOR, issuerId: null, clientId: ACADEMIA, template: TEMPLATE, dpsSeries: "900", active: true }));
  if (!created.ok) throw new Error(created.error);
  issuerId = created.data!.issuerId;
  await withOrgTx(ORG, (tx) =>
    tx.insert(schema.nfseClientCertificates).values({ orgId: ORG, clientId: ACADEMIA, envelope: ENVELOPE, uploadedBy: "u1", status: "valid", certificateCnpj: "33000167000101", validUntil: new Date("2027-06-01T00:00:00Z") }),
  );
  // Notas de novembro vindas do Portal: duas da Academia, uma cancelada, e uma de outra empresa.
  const note = (accessKey: string, clientId: string, nsu: number) => ({ orgId: ORG, clientId, accessKey, nsu, issuedAt: new Date("2026-11-10T12:00:00Z"), xmlGz: Buffer.from("x") });
  await withOrgTx(ORG, (tx) =>
    tx.insert(schema.nfseIssuedNotes).values([
      note(key(1), ACADEMIA, 1),
      note(key(2), ACADEMIA, 2),
      { ...note(key(3), ACADEMIA, 3), cancelledAt: new Date("2026-11-11T12:00:00Z"), cancelNsu: 4, cancelXmlGz: Buffer.from("x") },
      note(key(4), MERCADO, 5),
    ]),
  );
}, 120_000);

afterAll(() => client.close());

async function emit(requestId: string, sourceAccessKey?: string) {
  const { withOrgTx } = await import("@/db/org-tx");
  const { emitClientNfseNote } = await import("./emit");
  return withOrgTx(ORG, (tx) =>
    emitClientNfseNote(tx, {
      ...ACTOR,
      issuerId,
      requestId,
      taker: { document: "40503119091", name: "João Aluno", address: null },
      amount: "150.00",
      description: "Atendimentos de {mes}",
      reference: "previous",
      service: null,
      retentions: null,
      period: DECEMBER,
      now: NOW,
      sourceAccessKey,
    }),
  );
}

async function invoicesOf(accessKey: string) {
  const { withOrgTx } = await import("@/db/org-tx");
  return withOrgTx(ORG, (tx) =>
    tx
      .select({ id: schema.clientNfseInvoices.id, status: schema.clientNfseInvoices.status })
      .from(schema.clientNfseItems)
      .innerJoin(schema.clientNfseInvoices, eq(schema.clientNfseInvoices.itemId, schema.clientNfseItems.id))
      .where(eq(schema.clientNfseItems.sourceAccessKey, accessKey)),
  );
}

test("a mesma nota de origem não pede duas notas no mês, mesmo com formulários diferentes", async () => {
  const first = await emit(uuid(101), key(1));
  if (!first.ok) throw new Error(first.error);
  expect(first.data!.repeated).toBe(false);
  // Outra aba, outro formulário, mesma origem: devolve a nota que já foi pedida.
  expect(await emit(uuid(102), key(1))).toEqual({ ok: true, data: { invoiceId: first.data!.invoiceId, repeated: true } });
  expect(await invoicesOf(key(1))).toHaveLength(1);
});

test("duas notas de origem para a mesma pessoa continuam sendo duas", async () => {
  const second = await emit(uuid(103), key(2));
  if (!second.ok) throw new Error(second.error);
  expect(second.data!.repeated).toBe(false);
  expect(await invoicesOf(key(1))).toHaveLength(1);
  expect(await invoicesOf(key(2))).toHaveLength(1);
});

test("nota de origem cancelada, de outra empresa ou inexistente não gera nota", async () => {
  for (const [offset, source] of [key(3), key(4), key(99)].entries()) {
    const result = await emit(uuid(110 + offset), source);
    expect(result.ok).toBe(false);
    expect(await invoicesOf(source)).toHaveLength(0);
  }
});

test("depois de descartada, a mesma origem pode sair de novo, sem duplicar a nota do mês", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { discardClientNfseInvoice } = await import("./month");
  const [{ id: invoiceId }] = await invoicesOf(key(2));
  await withOrgTx(ORG, (tx) => tx.update(schema.clientNfseInvoices).set({ status: "failed", lastError: "E0000" }).where(eq(schema.clientNfseInvoices.id, invoiceId)));
  expect((await withOrgTx(ORG, (tx) => discardClientNfseInvoice(tx, { ...ACTOR, invoiceId }))).ok).toBe(true);
  const again = await emit(uuid(120), key(2));
  if (!again.ok) throw new Error(again.error);
  expect(again.data!.repeated).toBe(false);
  expect(again.data!.invoiceId).not.toBe(invoiceId);
  const invoices = await invoicesOf(key(2));
  expect(invoices.map((row) => row.status).sort()).toEqual(["cancelled", "queued"]);
  const items = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseItems).where(eq(schema.clientNfseItems.sourceAccessKey, key(2))));
  expect(items).toHaveLength(1);
  // E o mesmo formulário reenviado devolve a nota nova, não uma terceira.
  expect(await emit(uuid(120), key(2))).toEqual({ ok: true, data: { invoiceId: again.data!.invoiceId, repeated: true } });
});

test("o banco recusa duas notas do mês com a mesma origem, mesmo fora do fluxo", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const [item] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseItems).where(eq(schema.clientNfseItems.sourceAccessKey, key(1))));
  const copy = { orgId: ORG, requestId: uuid(130), issuerId, takerId: item.takerId, amount: "1.00", description: "x", sourceAccessKey: key(1) };
  await expect(withOrgTx(ORG, (tx) => tx.insert(schema.clientNfseItems).values({ ...copy, periodYear: 2026, periodMonth: 12 }))).rejects.toThrow();
  // Em outro mês a mesma origem é permitida: a trava é por mês.
  await withOrgTx(ORG, (tx) => tx.insert(schema.clientNfseItems).values({ ...copy, periodYear: 2027, periodMonth: 1 }));
});

test("nota sem origem continua igual a hoje", async () => {
  const first = await emit(uuid(140));
  if (!first.ok) throw new Error(first.error);
  const second = await emit(uuid(141));
  if (!second.ok) throw new Error(second.error);
  expect(second.data!.invoiceId).not.toBe(first.data!.invoiceId);
});
