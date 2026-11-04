/**
 * Notas dos clientes contra um Postgres de verdade (PGlite), como guilda_app:
 * cadastro com as travas, mês idempotente, fila com a numeração de cada
 * empresa, nota que não se apaga, RLS e o serviço fiscal sem certificado.
 */
import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
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
const OTHER = "orgB";
const ACADEMIA = "00000000-0000-4000-8000-000000000001";
const MERCADO = "00000000-0000-4000-8000-000000000002";
const MEI = "00000000-0000-4000-8000-000000000003";
const ENVELOPE = { v: 1 as const, keyId: "0123456789abcdef", wrappedKey: "AAAA", iv: "AAAA", ciphertext: "AAAA" };
const TEMPLATE: NfseIssuerTemplate = {
  cityCode: "4314902",
  taxRegime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
  service: { nationalTaxCode: "060101" },
  issqn: { taxation: "1", withholding: "1" },
  totalTaxes: { kind: "simples", percent: "6.00" },
};
const NOW = new Date("2026-11-05T12:00:00Z");
const ACTOR = { orgId: ORG, actorId: "u1" };

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now()), ('${OTHER}', 'Outro', 'outro', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES
      ('${ACADEMIA}', '${ORG}', 'Academia', 'simples', '33000167000101'),
      ('${MERCADO}', '${ORG}', 'Mercado', 'simples', '07412545000154'),
      ('${MEI}', '${ORG}', 'Eletricista MEI', 'mei', '11222333000181');
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

afterAll(() => client.close());

test("ciclo: cadastro, mês, prévia, fila com numeração por empresa, travas e RLS", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const registry = await import("./registry");
  const month = await import("./month");

  // Cadastro: MEI fica fora; empresa vira emissora uma vez só.
  const mei = await withOrgTx(ORG, (tx) => registry.saveClientNfseIssuer(tx, { ...ACTOR, issuerId: null, clientId: MEI, template: TEMPLATE, dpsSeries: "900", active: true }));
  expect(mei.ok).toBe(false);
  const created = await withOrgTx(ORG, (tx) => registry.saveClientNfseIssuer(tx, { ...ACTOR, issuerId: null, clientId: ACADEMIA, template: TEMPLATE, dpsSeries: "900", active: true, usesStandardNotes: true }));
  expect(created.ok).toBe(true);
  const issuerId = created.ok ? created.data!.issuerId : "";
  const again = await withOrgTx(ORG, (tx) => registry.saveClientNfseIssuer(tx, { ...ACTOR, issuerId: null, clientId: ACADEMIA, template: TEMPLATE, dpsSeries: "900", active: true }));
  expect(again.ok).toBe(false);
  const mercado = await withOrgTx(ORG, (tx) => registry.saveClientNfseIssuer(tx, { ...ACTOR, issuerId: null, clientId: MERCADO, template: TEMPLATE, dpsSeries: "1", active: true, usesStandardNotes: true }));
  const mercadoId = mercado.ok ? mercado.data!.issuerId : "";

  // Tomadores: documento validado e único por empresa.
  const badDoc = await withOrgTx(ORG, (tx) => registry.saveClientNfseTaker(tx, { ...ACTOR, issuerId, takerId: null, name: "X", document: "33000167000102", address: null, active: true }));
  expect(badDoc.ok).toBe(false);
  const taker = await withOrgTx(ORG, (tx) => registry.saveClientNfseTaker(tx, { ...ACTOR, issuerId, takerId: null, name: "João Aluno", document: "40503119091", address: null, active: true }));
  const takerId = taker.ok ? taker.data!.takerId : "";
  const taker2 = await withOrgTx(ORG, (tx) => registry.saveClientNfseTaker(tx, { ...ACTOR, issuerId, takerId: null, name: "Empresa Parceira", document: "44000167000102".replace(/2$/, "0"), address: null, active: true }));
  expect(taker2.ok).toBe(false); // dígito errado
  const mercadoTaker = await withOrgTx(ORG, (tx) => registry.saveClientNfseTaker(tx, { ...ACTOR, issuerId: mercadoId, takerId: null, name: "Padaria", document: "33000167000101", address: null, active: true }));
  const mercadoTakerId = mercadoTaker.ok ? mercadoTaker.data!.takerId : "";

  // Nota padrão: o tomador tem de ser da própria empresa.
  const crossed = await withOrgTx(ORG, (tx) => registry.saveClientNfseModel(tx, { ...ACTOR, issuerId, modelId: null, takerId: mercadoTakerId, amount: "10.00", description: "x", reference: "previous", service: null, active: true }));
  expect(crossed.ok).toBe(false);
  const model = await withOrgTx(ORG, (tx) => registry.saveClientNfseModel(tx, { ...ACTOR, issuerId, modelId: null, takerId, amount: "150.00", description: "Mensalidade referente a {mes}", reference: "previous", service: null, active: true }));
  expect(model.ok).toBe(true);
  await withOrgTx(ORG, (tx) => registry.saveClientNfseModel(tx, { ...ACTOR, issuerId, modelId: null, takerId, amount: "40.00", description: "Taxa de {mes}", reference: "current", service: { nationalTaxCode: "060102" }, active: true }));
  await withOrgTx(ORG, (tx) => registry.saveClientNfseModel(tx, { ...ACTOR, issuerId: mercadoId, modelId: null, takerId: mercadoTakerId, amount: "900.00", description: "Aluguel {mes}", reference: "previous", service: null, active: true }));
  await withOrgTx(ORG, (tx) => registry.saveClientNfseModel(tx, { ...ACTOR, issuerId: mercadoId, modelId: null, takerId: mercadoTakerId, amount: "1.00", description: "Pausada", reference: "previous", service: null, active: false }));

  // Sem "abrir o mês": as notas padrão ativas já aparecem em novembro, com a descrição resolvida.
  const rows = await withOrgTx(ORG, (tx) => month.loadClientNfseMonthRows(tx, { orgId: ORG, year: 2026, month: 11, now: NOW }));
  expect(rows.map((row) => row.description).sort()).toEqual(["Aluguel 10/2026", "Mensalidade referente a 10/2026", "Taxa de 11/2026"]);
  expect(rows.every((row) => row.itemId === null)).toBe(true);
  expect(await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseItems))).toHaveLength(0);

  // Sem certificado ninguém emite; com certificado conferido, emite.
  const blocked = await withOrgTx(ORG, (tx) => month.loadClientNfsePreview(tx, { orgId: ORG, year: 2026, month: 11, now: NOW }));
  expect(blocked.items).toHaveLength(0);
  expect(new Set(blocked.excluded.map((item) => item.reason))).toEqual(new Set(["issuer_not_ready"]));
  await withOrgTx(ORG, (tx) =>
    tx.insert(schema.nfseClientCertificates).values([
      { orgId: ORG, clientId: ACADEMIA, envelope: ENVELOPE, uploadedBy: "u1", status: "valid", certificateCnpj: "33000167000101", validUntil: new Date("2027-06-01T00:00:00Z") },
      { orgId: ORG, clientId: MERCADO, envelope: ENVELOPE, uploadedBy: "u1", status: "valid", certificateCnpj: "07412545000154", validUntil: new Date("2027-06-01T00:00:00Z") },
    ]),
  );
  const preview = await withOrgTx(ORG, (tx) => month.loadClientNfsePreview(tx, { orgId: ORG, year: 2026, month: 11, now: NOW }));
  expect(preview.items).toHaveLength(3);
  expect(preview.totalCents).toBe(15000 + 4000 + 90000);

  // Ajuste do mês não mexe na nota padrão.
  const taxa = preview.items.find((item) => item.description === "Taxa de 11/2026")!;
  expect((await withOrgTx(ORG, (tx) => month.adjustClientNfseMonthNote(tx, { ...ACTOR, year: 2026, month: 11, modelId: taxa.modelId, amount: "45.50", description: "Taxa de novembro" }))).ok).toBe(true);
  // Dezembro continua com o padrão.
  const december = await withOrgTx(ORG, (tx) => month.loadClientNfseMonthRows(tx, { orgId: ORG, year: 2026, month: 12, now: NOW }));
  expect(december.find((row) => row.modelId === taxa.modelId)).toMatchObject({ amount: "40.00", description: "Taxa de 12/2026", itemId: null });
  const adjusted = await withOrgTx(ORG, (tx) => month.loadClientNfsePreview(tx, { orgId: ORG, year: 2026, month: 11, now: NOW }));
  expect(adjusted.totalCents).toBe(15000 + 4550 + 90000);
  expect((await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseModels).where(eq(schema.clientNfseModels.amount, "40.00")))).length).toBe(1);

  // Lista velha é recusada; a certa reserva a DPS de cada empresa em sequência.
  const selected = adjusted.items.map((item) => item.modelId);
  const stale = await withOrgTx(ORG, (tx) => month.enqueueClientNfseBatch(tx, { ...ACTOR, year: 2026, month: 11, selected, expectedCount: 3, expectedTotalCents: 109000, today: "2026-11-05", now: NOW }));
  expect(stale.ok).toBe(false);
  const future = await withOrgTx(ORG, (tx) => month.enqueueClientNfseBatch(tx, { ...ACTOR, year: 2026, month: 12, selected, expectedCount: 3, expectedTotalCents: adjusted.totalCents, today: "2026-11-05", now: NOW }));
  expect(future.ok).toBe(false);
  const queued = await withOrgTx(ORG, (tx) => month.enqueueClientNfseBatch(tx, { ...ACTOR, year: 2026, month: 11, selected, expectedCount: 3, expectedTotalCents: adjusted.totalCents, today: "2026-11-05", now: NOW }));
  expect(queued).toEqual({ ok: true, data: { queued: 3 } });
  const invoices = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices));
  const academia = invoices.filter((row) => row.issuerId === issuerId).sort((a, b) => a.dpsNumber - b.dpsNumber);
  expect(academia.map((row) => [row.dpsSeries, row.dpsNumber])).toEqual([["900", 1], ["900", 2]]);
  expect(invoices.find((row) => row.issuerId === mercadoId)).toMatchObject({ dpsSeries: "1", dpsNumber: 1, providerCnpj: "07412545000154" });
  // O serviço próprio da nota padrão substitui o do emissor na nota congelada.
  expect((invoices.find((row) => row.description === "Taxa de novembro")!.template as NfseIssuerTemplate).service.nationalTaxCode).toBe("060102");
  expect(academia[0].dpsId).toBe("DPS431490223300016700010100900000000000000001");

  // Já pedida: sai da prévia, não se edita, não duplica, e o cadastro não se apaga.
  const after = await withOrgTx(ORG, (tx) => month.loadClientNfsePreview(tx, { orgId: ORG, year: 2026, month: 11, now: NOW }));
  expect(after.items).toHaveLength(0);
  expect((await withOrgTx(ORG, (tx) => month.adjustClientNfseMonthNote(tx, { ...ACTOR, year: 2026, month: 11, modelId: taxa.modelId, amount: "1.00", description: "x" }))).ok).toBe(false);
  // Pausar a nota padrão não some com a nota já pedida em novembro.
  await withOrgTx(ORG, (tx) => tx.update(schema.clientNfseModels).set({ active: false }).where(eq(schema.clientNfseModels.id, taxa.modelId)));
  const paused = await withOrgTx(ORG, (tx) => month.loadClientNfseMonthRows(tx, { orgId: ORG, year: 2026, month: 11, now: NOW }));
  expect(paused.find((row) => row.modelId === taxa.modelId)).toMatchObject({ modelActive: false, hasActiveInvoice: true });
  expect((await withOrgTx(ORG, (tx) => month.loadClientNfseMonthRows(tx, { orgId: ORG, year: 2026, month: 12, now: NOW }))).some((row) => row.modelId === taxa.modelId)).toBe(false);
  expect((await withOrgTx(ORG, (tx) => registry.deleteClientNfseIssuer(tx, { ...ACTOR, issuerId }))).ok).toBe(false);
  expect((await withOrgTx(ORG, (tx) => registry.deleteClientNfseTaker(tx, { ...ACTOR, takerId }))).ok).toBe(false);
  // Mesmo pulando a action, o banco recusa (a nota não tem cascata).
  const raw = await withOrgTx(ORG, (tx) => tx.delete(schema.clientNfseIssuers).where(eq(schema.clientNfseIssuers.id, issuerId))).then(() => "apagou", () => "recusou");
  expect(raw).toBe("recusou");
  // Nota não se apaga e o valor não muda.
  const amountChange = await withOrgTx(ORG, (tx) => tx.update(schema.clientNfseInvoices).set({ amount: "1.00" })).then(() => "mudou", () => "recusou");
  expect(amountChange).toBe("recusou");
  const deleteInvoice = await withOrgTx(ORG, (tx) => tx.delete(schema.clientNfseInvoices)).then(() => "apagou", () => "recusou");
  expect(deleteInvoice).toBe("recusou");

  // Outra organização não vê nada.
  expect(await withOrgTx(OTHER, (tx) => tx.select().from(schema.clientNfseInvoices))).toHaveLength(0);
  expect(await withOrgTx(OTHER, (tx) => tx.select().from(schema.clientNfseIssuers))).toHaveLength(0);

  // Cancelamento só de emitida.
  expect((await withOrgTx(ORG, (tx) => month.requestClientNfseCancel(tx, { ...ACTOR, invoiceId: academia[0].id, reasonCode: 1, reasonText: "Valor errado na nota." }))).ok).toBe(false);
}, 60_000);

test("serviço fiscal: sem certificado que abra, a nota falha com o motivo; série nova renumera no Tentar de novo", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { runClientNfseQueue } = await import("./service");
  const { VaultError } = await import("@/lib/nfse/vault");
  const month = await import("./month");
  const registry = await import("./registry");

  const vault = {
    keyId: "0123456789abcdef",
    publicKeySpki: "AAAA",
    open: () => {
      throw new VaultError("Não foi possível abrir o envelope do certificado. Envie de novo.");
    },
  };
  await runClientNfseQueue(ORG, vault, "restrita");
  const failed = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices));
  expect(failed.every((row) => row.status === "failed")).toBe(true);
  expect(failed[0].lastError).toBe("Não foi possível abrir o envelope do certificado. Envie de novo.");
  expect(failed[0].lockToken).toBeNull();

  // Trocar a série e tentar de novo: número novo na série nova.
  const academiaInvoice = failed.find((row) => row.dpsSeries === "900")!;
  const [issuer] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseIssuers).where(eq(schema.clientNfseIssuers.id, academiaInvoice.issuerId)));
  await withOrgTx(ORG, (tx) => registry.saveClientNfseIssuer(tx, { ...ACTOR, issuerId: issuer.id, clientId: issuer.clientId, template: TEMPLATE, dpsSeries: "901", active: true }));
  expect((await withOrgTx(ORG, (tx) => month.requeueClientNfseInvoice(tx, { ...ACTOR, invoiceId: academiaInvoice.id }))).ok).toBe(true);
  const [renumbered] = await withOrgTx(ORG, (tx) =>
    tx.select().from(schema.clientNfseInvoices).where(and(eq(schema.clientNfseInvoices.id, academiaInvoice.id), sql`true`)),
  );
  expect(renumbered).toMatchObject({ status: "queued", dpsSeries: "901", dpsNumber: 3 });
  expect(renumbered.dpsId.slice(-20)).toBe("00901000000000000003");
}, 60_000);

test("série ocupada por outro sistema: a empresa passa sozinha para a série seguinte e a nota volta à fila", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { claimClientNfseJob, moveToNextSeries } = await import("./service");

  const claim = await claimClientNfseJob(ORG);
  expect(claim).toMatchObject({ dpsSeries: "901", dpsNumber: 3 });
  expect(await moveToNextSeries(ORG, claim!)).toEqual({ from: "901", to: "902", number: 1 });
  const [invoice] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.id, claim!.id)));
  expect(invoice).toMatchObject({ status: "queued", dpsSeries: "902", dpsNumber: 1, lockToken: null, lastError: null });
  expect(invoice.dpsId.slice(-20)).toBe("00902000000000000001");
  const [issuer] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseIssuers).where(eq(schema.clientNfseIssuers.id, claim!.issuerId)));
  expect(issuer).toMatchObject({ dpsSeries: "902", nextDpsNumber: 2 });
  const events = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoiceEvents).where(eq(schema.clientNfseInvoiceEvents.invoiceId, claim!.id)));
  expect(events).toContainEqual(expect.objectContaining({ eventType: "retried", actorId: null, detail: expect.objectContaining({ previousSeries: "901", dpsSeries: "902" }) }));

  // Sem o lease (outra passada pegou a nota), não mexe em nada.
  expect(await moveToNextSeries(ORG, { ...claim!, lockToken: "00000000-0000-4000-8000-0000000000ff" })).toBeNull();
}, 60_000);

test("sugestão pelas notas guardadas da empresa e importação das notas padrão marcadas", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { gzipSync } = await import("node:zlib");
  const { testNfseXml } = await import("@/lib/nfse/testing/nfse-xml");
  const { loadIssuerSuggestion } = await import("./loaders");
  const registry = await import("./registry");

  const MERCADO_CNPJ = "07412545000154";
  const notes = [
    { at: "2026-09-08T10:00:00-03:00", series: "1", cpf: "40503119091", name: "João da Silva", cents: 15000, text: "MENSALIDADE REFERENTE A 08/2026" },
    { at: "2026-10-08T10:00:00-03:00", series: "1", cpf: "40503119091", name: "João da Silva", cents: 15000, text: "MENSALIDADE REFERENTE A 09/2026" },
    { at: "2026-10-09T10:00:00-03:00", series: "901", cpf: "65029267034", name: "Maria Oliveira", cents: 5000, text: "AVALIAÇÃO" },
    // Antiga, fora da janela: só conta para a série já usada.
    { at: "2025-03-10T10:00:00-03:00", series: "900", cpf: "65029267034", name: "Maria Oliveira", cents: 5000, text: "AVALIAÇÃO" },
    // Cancelada: não vira nota padrão, mas a DPS dela continua ocupada no Sistema Nacional.
    { at: "2026-10-10T10:00:00-03:00", series: "902", cpf: "65029267034", name: "Maria Oliveira", cents: 7000, text: "CONSULTA", cancelled: true },
  ];
  await withOrgTx(ORG, (tx) =>
    tx.insert(schema.nfseIssuedNotes).values(
      notes.map((row, index) => {
        const xml = testNfseXml({ providerCnpj: MERCADO_CNPJ, series: row.series, taker: { cnpj: row.cpf, name: row.name, address: null }, amountCents: row.cents, description: row.text })
          .replace(/<dhProc>[^<]+<\/dhProc>/, `<dhProc>${row.at}</dhProc>`);
        return {
          orgId: ORG,
          clientId: MERCADO,
          accessKey: String(index + 1).padStart(50, "7"),
          nsu: index + 1,
          issuedAt: new Date(row.at),
          ...("cancelled" in row ? { cancelledAt: new Date(row.at), cancelNsu: 100 + index, cancelXmlGz: new Uint8Array(gzipSync(Buffer.from("<evento/>", "utf8"))) } : {}),
          xmlGz: new Uint8Array(gzipSync(Buffer.from(xml, "utf8"))),
        };
      }),
    ),
  );
  const [issuer] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseIssuers).where(eq(schema.clientNfseIssuers.clientId, MERCADO)));
  const suggestion = await withOrgTx(ORG, (tx) => loadIssuerSuggestion(tx, { orgId: ORG, clientId: MERCADO, issuerId: issuer.id, now: NOW }));
  expect(suggestion.dpsSeries).toBe("903");
  expect(suggestion.template?.service.nationalTaxCode).toBe("171901");
  expect(suggestion.models.map((model) => [model.takerName, model.description, model.recurring])).toEqual([
    ["João da Silva", "MENSALIDADE REFERENTE A {mes}", true],
    ["Maria Oliveira", "AVALIAÇÃO", false],
  ]);

  // Importa as marcadas; o tomador "Padaria" (já cadastrado) seria reaproveitado pelo documento.
  const imported = await withOrgTx(ORG, (tx) =>
    registry.importClientNfseSuggestions(tx, {
      ...ACTOR,
      issuerId: issuer.id,
      items: suggestion.models.map(({ takerDocument, takerName, address, amount, description, reference }) => ({ takerDocument, takerName, address, amount, description, reference })),
    }),
  );
  expect(imported).toEqual({ ok: true, data: { takers: 2, models: 2 } });
  // Já cadastradas, não voltam como sugestão.
  const again = await withOrgTx(ORG, (tx) => loadIssuerSuggestion(tx, { orgId: ORG, clientId: MERCADO, issuerId: issuer.id, now: NOW }));
  expect(again.models).toEqual([]);

  // Clientes já atendidos: o histórico inteiro, um por documento, sem a nota cancelada.
  const { loadIssuerCustomers, requestIssuerHistory } = await import("./loaders");
  const view = await withOrgTx(ORG, (tx) => loadIssuerCustomers(tx, { orgId: ORG, issuerId: issuer.id }));
  expect(view?.customers.map((customer) => [customer.takerName, customer.notes, customer.registered])).toEqual([
    ["Maria Oliveira", 2, true],
    ["João da Silva", 2, true],
  ]);
  expect(view?.customers.find((customer) => customer.takerName === "Maria Oliveira")?.description).toBe("AVALIAÇÃO");
  expect(view).toMatchObject({ historyReading: false, canReadHistory: true });
  expect(await withOrgTx(OTHER, (tx) => loadIssuerCustomers(tx, { orgId: OTHER, issuerId: issuer.id }))).toBeNull();

  // Cliente que ainda não é tomador: importação em lote cria só ele, com nome e endereço da nota.
  const xml = testNfseXml({ providerCnpj: MERCADO_CNPJ, series: "1", taker: { cnpj: "11222333000181", name: "Oficina Nova", address: null }, amountCents: 30000, description: "REVISÃO" })
    .replace(/<dhProc>[^<]+<\/dhProc>/, "<dhProc>2026-10-20T10:00:00-03:00</dhProc>");
  await withOrgTx(ORG, (tx) =>
    tx.insert(schema.nfseIssuedNotes).values({ orgId: ORG, clientId: MERCADO, accessKey: "9".repeat(50), nsu: 99, issuedAt: new Date("2026-10-20T13:00:00Z"), xmlGz: new Uint8Array(gzipSync(Buffer.from(xml, "utf8"))) }),
  );
  const takersBefore = (await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseTakers).where(eq(schema.clientNfseTakers.issuerId, issuer.id)))).length;
  const bulk = await withOrgTx(ORG, (tx) => registry.importIssuerTakers(tx, { ...ACTOR, issuerId: issuer.id, documents: ["11222333000181", "40503119091"] }));
  expect(bulk).toEqual({ ok: true, data: { created: 1 } });
  const takersAfter = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseTakers).where(eq(schema.clientNfseTakers.issuerId, issuer.id)));
  expect(takersAfter).toHaveLength(takersBefore + 1);
  expect(takersAfter.find((row) => row.document === "11222333000181")?.name).toBe("Oficina Nova");

  // Releitura do histórico: o cursor da empresa volta ao começo e a rotina é chamada.
  expect(await withOrgTx(ORG, (tx) => requestIssuerHistory(tx, { orgId: ORG, issuerId: issuer.id, now: NOW }))).toBe(true);
  expect((await withOrgTx(ORG, (tx) => loadIssuerCustomers(tx, { orgId: ORG, issuerId: issuer.id })))?.historyReading).toBe(true);
  const [routine] = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseXmlRoutines));
  expect(routine.runRequestedAt).toEqual(NOW);

  // Nota avulsa: vai para a fila na hora; o mesmo envio repetido não pede outra.
  const { emitClientNfseNote } = await import("./emit");
  const requestId = "00000000-0000-4000-8000-0000000000aa";
  const emit = () =>
    withOrgTx(ORG, (tx) =>
      emitClientNfseNote(tx, {
        ...ACTOR,
        issuerId: issuer.id,
        requestId,
        taker: { document: "11222333000181", name: "Oficina Nova", address: null },
        amount: "250.00",
        description: "REVISÃO DE {mes}",
        reference: "previous",
        service: null,
        retentions: null,
        rememberRetentions: false,
        period: { year: 2026, month: 11 },
        now: NOW,
      }),
    );
  const first = await emit();
  if (!first.ok) throw new Error(first.error);
  expect(await emit()).toEqual({ ok: true, data: { invoiceId: first.data!.invoiceId, repeated: true } });
  const [free] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.id, first.data!.invoiceId)));
  expect(free).toMatchObject({ status: "queued", amount: "250.00", description: "REVISÃO DE 10/2026", takerName: "Oficina Nova", periodMonth: 11 });
  const [freeItem] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseItems).where(eq(schema.clientNfseItems.id, free.itemId)));
  expect(freeItem.modelId).toBeNull();
  // Com retenção: ISS retido pelo tomador e IR no modelo congelado; gravada como a do tomador.
  const retained = await withOrgTx(ORG, (tx) =>
    emitClientNfseNote(tx, {
      ...ACTOR,
      issuerId: issuer.id,
      requestId: "00000000-0000-4000-8000-0000000000ab",
      taker: { document: "11222333000181", name: "Oficina Nova", address: null },
      amount: "1000.00",
      description: "SERVIÇO",
      reference: "previous",
      service: null,
      retentions: { issWithheld: true, issRate: "2.00", irrf: "1.50", cp: null, pis: null, cofins: null, csll: null, pisCofinsCst: "01" },
      rememberRetentions: true,
      period: { year: 2026, month: 11 },
      now: NOW,
    }),
  );
  if (!retained.ok) throw new Error(retained.error);
  const [withTax] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.id, retained.data!.invoiceId)));
  expect(withTax.template).toMatchObject({ issqn: { withholding: "2", rate: "2.00" }, federal: { irrfCents: 1500 } });
  expect(free.template).toMatchObject({ issqn: { withholding: "1" } });
  expect((free.template as { federal?: unknown }).federal).toBeUndefined();
  const [oficina] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseTakers).where(eq(schema.clientNfseTakers.document, "11222333000181")));
  expect(oficina.retentions).toMatchObject({ issWithheld: true, irrf: "1.50" });
  // A avulsa não vira linha de nota fixa; e sem notas fixas, as padrão somem do mês.
  const monthModule = await import("./month");
  const rows = await withOrgTx(ORG, (tx) => monthModule.loadClientNfseMonthRows(tx, { orgId: ORG, year: 2026, month: 12, now: NOW }));
  expect(rows.some((row) => row.issuerId === issuer.id)).toBe(true);
  await withOrgTx(ORG, (tx) => tx.update(schema.clientNfseIssuers).set({ usesStandardNotes: false }).where(eq(schema.clientNfseIssuers.id, issuer.id)));
  const withoutFixed = await withOrgTx(ORG, (tx) => monthModule.loadClientNfseMonthRows(tx, { orgId: ORG, year: 2026, month: 12, now: NOW }));
  expect(withoutFixed.some((row) => row.issuerId === issuer.id)).toBe(false);
  await withOrgTx(ORG, (tx) => tx.update(schema.clientNfseIssuers).set({ usesStandardNotes: true }).where(eq(schema.clientNfseIssuers.id, issuer.id)));

  // Nota com o tomador no mesmo formulário: o CPF de quem já recebe reaproveita o tomador.
  const note = await withOrgTx(ORG, (tx) =>
    registry.saveClientNfseNote(tx, {
      ...ACTOR,
      issuerId: issuer.id,
      modelId: null,
      taker: { document: "40503119091", name: "João da Silva Souza", address: null },
      amount: "80.00",
      description: "PERSONAL REFERENTE A {mes}",
      reference: "previous",
      service: null,
      active: true,
    }),
  );
  expect(note.ok).toBe(true);
  const joaos = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseTakers).where(and(eq(schema.clientNfseTakers.issuerId, issuer.id), eq(schema.clientNfseTakers.document, "40503119091"))));
  expect(joaos).toHaveLength(1);
  expect(joaos[0].name).toBe("João da Silva Souza");
}, 60_000);

test("adicionar empresa: quem não pode entrar aparece com o motivo, não some", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { loadClientNfseWorkspace } = await import("./loaders");
  await withOrgTx(ORG, (tx) =>
    tx.insert(schema.clients).values([
      { orgId: ORG, name: "Sociedade Getuliense Inativa", taxRegime: "association", cnpj: "44000167000102", active: false },
      { orgId: ORG, name: "Associacao Sem CNPJ", taxRegime: "association", cnpj: null },
      { orgId: ORG, name: "Associacao Ativa", taxRegime: "association", cnpj: "11444777000161" },
    ]),
  );
  const { candidates } = await withOrgTx(ORG, (tx) => loadClientNfseWorkspace(tx, { orgId: ORG, year: 2026, month: 11, now: NOW }));
  const reason = (name: string) => candidates.find((item) => item.name === name)?.blocked;
  expect(reason("Associacao Ativa")).toBeNull();
  expect(reason("Sociedade Getuliense Inativa")).toMatch(/Inativa/);
  expect(reason("Associacao Sem CNPJ")).toMatch(/Sem CNPJ/);
  expect(reason("Eletricista MEI")).toMatch(/MEI/);
  // Quem já emite pelas Notas dos clientes aparece, mas não pode entrar de novo.
  expect(reason("Academia")).toMatch(/Já está nas Notas dos clientes/);
}, 60_000);

test("nota com erro: corrigir o endereço grava no tomador e devolve à fila com a mesma DPS", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { retryClientNfseWithAddress } = await import("./emit");
  const invoices = schema.clientNfseInvoices;
  // Da empresa que não trocou de série: quem trocou ganha número novo no requeue (outro teste).
  const failed = (await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(and(eq(invoices.status, "failed"), eq(invoices.dpsSeries, "1")))))[0];
  expect(failed).toBeDefined();
  const fix = (invoiceId: string, zipCode: string, city = "Getúlio Vargas") =>
    withOrgTx(ORG, (tx) =>
      retryClientNfseWithAddress(tx, {
        ...ACTOR,
        invoiceId,
        address: { zipCode, street: "Rua das Palmeiras", number: "10", complement: null, district: "Centro", city, state: "rs" },
      }),
    );
  // CEP curto e cidade que não existe na UF: nada muda.
  expect(await fix(failed.id, "9990")).toMatchObject({ ok: false, error: expect.stringMatching(/CEP/) });
  expect(await fix(failed.id, "99900-000", "Cidade Que Não Existe")).toMatchObject({ ok: false, error: expect.stringMatching(/cidade/) });
  const [same] = await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(eq(invoices.id, failed.id)));
  expect(same.status).toBe("failed");

  expect(await fix(failed.id, "99900-000")).toEqual({ ok: true });
  const [requeued] = await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(eq(invoices.id, failed.id)));
  expect(requeued).toMatchObject({ status: "queued", lastError: null, dpsSeries: failed.dpsSeries, dpsNumber: failed.dpsNumber, amount: failed.amount });
  expect(requeued.takerAddress).toMatchObject({ zipCode: "99900000", cityCode: expect.any(String) });
  const [taker] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseTakers).where(eq(schema.clientNfseTakers.id, failed.takerId)));
  expect(taker.address).toMatchObject({ zipCode: "99900000", state: "RS" });
  // Já na fila: não corrige de novo por aqui.
  expect(await fix(failed.id, "99900-000")).toMatchObject({ ok: false, error: expect.stringMatching(/erro/) });
  // Outra organização não vê a nota.
  expect(await withOrgTx(OTHER, (tx) => retryClientNfseWithAddress(tx, { orgId: OTHER, actorId: "u1", invoiceId: failed.id, address: { zipCode: "99900000", street: "R", number: "1", complement: null, district: "C", city: "Getúlio Vargas", state: "RS" } }))).toMatchObject({ ok: false });
}, 60_000);

test("tentar de novo relê os dados fiscais da empresa; o que é da nota continua congelado", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const month = await import("./month");
  const invoices = schema.clientNfseInvoices;
  const issuers = schema.clientNfseIssuers;
  const [invoice] = await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(eq(invoices.dpsSeries, "1")).limit(1));
  await withOrgTx(ORG, (tx) => tx.update(invoices).set({ status: "failed", lastError: "E0903" }).where(eq(invoices.id, invoice.id)));
  // Nota com IBS/CBS exige o endereço do tomador.
  await withOrgTx(ORG, (tx) =>
    tx.update(schema.clientNfseTakers).set({ address: { zipCode: "99900000", street: "Rua A", number: "1", complement: null, district: "Centro", city: "Getúlio Vargas", state: "RS" } }).where(eq(schema.clientNfseTakers.id, invoice.takerId)),
  );
  const [issuer] = await withOrgTx(ORG, (tx) => tx.select().from(issuers).where(eq(issuers.id, invoice.issuerId)));
  const ibsCbs = { operationIndicator: "100301", cst: "200", classification: "200052", operationType: "5" };
  await withOrgTx(ORG, (tx) =>
    tx.update(issuers).set({ template: { ...(issuer.template as object), ibsCbs, service: { nationalTaxCode: "999999" } } }).where(eq(issuers.id, issuer.id)),
  );
  expect(await withOrgTx(ORG, (tx) => month.requeueClientNfseInvoice(tx, { ...ACTOR, invoiceId: invoice.id }))).toEqual({ ok: true });
  const [requeued] = await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(eq(invoices.id, invoice.id)));
  expect(requeued.status).toBe("queued");
  expect(requeued.template).toMatchObject({ ibsCbs, service: (invoice.template as { service: unknown }).service });
  expect(requeued.amount).toBe(invoice.amount);
  // O banco segue recusando mudar o valor da nota.
  const amountChange = await withOrgTx(ORG, (tx) => tx.update(invoices).set({ amount: "1.00" }).where(eq(invoices.id, invoice.id))).then(() => "mudou", () => "recusou");
  expect(amountChange).toBe("recusou");
  await withOrgTx(ORG, (tx) => tx.update(issuers).set({ template: issuer.template }).where(eq(issuers.id, issuer.id)));
}, 60_000);

test("nota com erro: corrigir o serviço muda o pedido, opcionalmente a empresa, e devolve à fila", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { retryClientNfseWithService } = await import("./emit");
  const invoices = schema.clientNfseInvoices;
  const issuers = schema.clientNfseIssuers;
  const [invoice] = await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(eq(invoices.dpsSeries, "1")).limit(1));
  const [before] = await withOrgTx(ORG, (tx) => tx.select().from(issuers).where(eq(issuers.id, invoice.issuerId)));
  const fix = (service: { nationalTaxCode: string; municipalTaxCode?: string }, applyToIssuer: boolean) =>
    withOrgTx(ORG, (tx) => retryClientNfseWithService(tx, { ...ACTOR, invoiceId: invoice.id, service, applyToIssuer }));

  await withOrgTx(ORG, (tx) => tx.update(invoices).set({ status: "queued" }).where(eq(invoices.id, invoice.id)));
  expect(await fix({ nationalTaxCode: "010101" }, false)).toMatchObject({ ok: false });

  await withOrgTx(ORG, (tx) => tx.update(invoices).set({ status: "failed", lastError: "E0314" }).where(eq(invoices.id, invoice.id)));
  expect(await fix({ nationalTaxCode: "010101" }, false)).toEqual({ ok: true });
  const [only] = await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(eq(invoices.id, invoice.id)));
  expect(only).toMatchObject({ status: "queued", lastError: null, amount: invoice.amount, dpsNumber: invoice.dpsNumber });
  expect((only.template as { service: unknown }).service).toEqual({ nationalTaxCode: "010101" });
  const [same] = await withOrgTx(ORG, (tx) => tx.select().from(issuers).where(eq(issuers.id, invoice.issuerId)));
  expect(same.template).toEqual(before.template);

  await withOrgTx(ORG, (tx) => tx.update(invoices).set({ status: "failed" }).where(eq(invoices.id, invoice.id)));
  expect(await fix({ nationalTaxCode: "020202", municipalTaxCode: "001" }, true)).toEqual({ ok: true });
  const [changed] = await withOrgTx(ORG, (tx) => tx.select().from(issuers).where(eq(issuers.id, invoice.issuerId)));
  expect((changed.template as { service: unknown }).service).toEqual({ nationalTaxCode: "020202", municipalTaxCode: "001" });
  await withOrgTx(ORG, (tx) => tx.update(issuers).set({ template: before.template }).where(eq(issuers.id, before.id)));
}, 60_000);

test("reparo: nota antiga adotada volta para com erro; a emitida depois do pedido fica", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { gzipSync } = await import("node:zlib");
  const { testNfseXml } = await import("@/lib/nfse/testing/nfse-xml");
  const { repairAdoptedClientNfse } = await import("./service");
  const invoices = schema.clientNfseInvoices;
  const rows = await withOrgTx(ORG, (tx) => tx.select().from(invoices).limit(3));
  expect(rows.length).toBe(3);
  const [adopted, real, cancelling] = rows;
  const gz = (issuedAt: string) => new Uint8Array(gzipSync(Buffer.from(testNfseXml({ issuedAt }), "utf8")));
  const asIssued = (id: string, key: string, issuedAt: string, status: "issued" | "cancel_requested") =>
    withOrgTx(ORG, (tx) =>
      tx.update(invoices).set({ status, accessKey: key.repeat(50), nfseNumber: "1", environment: 1, issuedAt: new Date(), xmlGz: gz(issuedAt), cancelReasonCode: status === "cancel_requested" ? 1 : null }).where(eq(invoices.id, id)),
    );
  const late = new Date(Date.now() + 60_000).toISOString();
  await asIssued(adopted.id, "1", "2024-02-01T16:57:28-03:00", "issued");
  await asIssued(real.id, "2", late, "issued");
  await asIssued(cancelling.id, "3", "2024-02-01T16:57:28-03:00", "cancel_requested");

  expect(await repairAdoptedClientNfse(ORG)).toBe(2);
  const read = async (id: string) => (await withOrgTx(ORG, (tx) => tx.select().from(invoices).where(eq(invoices.id, id))))[0];
  const fixed = await read(adopted.id);
  expect(fixed).toMatchObject({ status: "failed", accessKey: null, nfseNumber: null, xmlGz: null, dpsNumber: adopted.dpsNumber });
  expect(fixed.lastError).toMatch(/NÃO foi emitida.*01\/02\/2024/);
  expect(await read(real.id)).toMatchObject({ status: "issued", nfseNumber: "1" });
  // O cancelamento pendente cairia na nota antiga, que é verdadeira.
  expect(await read(cancelling.id)).toMatchObject({ status: "failed", cancelReasonCode: null });
  // Fica registrado qual nota tinha sido adotada, e rodar de novo não muda nada.
  const events = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoiceEvents).where(eq(schema.clientNfseInvoiceEvents.invoiceId, adopted.id)));
  expect(events).toContainEqual(expect.objectContaining({ eventType: "failed", detail: expect.objectContaining({ adoptedNfseNumber: "1" }) }));
  expect(await repairAdoptedClientNfse(ORG)).toBe(0);
}, 60_000);
