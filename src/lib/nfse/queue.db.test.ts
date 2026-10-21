/**
 * A fila das notas contra um Postgres de verdade (PGlite, em WASM, sem Docker),
 * conectado como guilda_app com os default privileges dos ambientes reais
 * (docker/dev/init/01-roles.sql). Pega o que teste puro não pega: RLS, UPDATE
 * só nas colunas do ciclo de vida e a transação da etapa do controle.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { nfseBatchItemKey } from "@/domain/nfse";

import { applyMigrations } from "./testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "orgA";

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj) VALUES
      ('00000000-0000-4000-8000-000000000001', '${ORG}', 'Padaria Pão Quente', 'simples', '33000167000101'),
      ('00000000-0000-4000-8000-000000000002', '${ORG}', 'Sem CNPJ', 'simples', NULL);
    UPDATE clients SET address = '{"street":"RUA EDITH KURTZ","number":"871","complement":null,"district":"SANTO ANDRE","city":"GETULIO VARGAS","state":"RS","zipCode":"99900-000"}'::jsonb
     WHERE id = '00000000-0000-4000-8000-000000000001';
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

// Fechar libera a memória do Postgres em WASM (máquina com pouca RAM derruba o processo).
afterAll(() => client.close());

test("ciclo completo: enfileirar, emitir, marcar etapa, cancelar, reabrir", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { materializeOfficeFeeControl } = await import("@/lib/office-fees/materialize");
  const requests = await import("./requests");
  const repo = await import("./repository");
  const { TEST_TEMPLATE } = await import("./testing/fixtures");

  await withOrgTx(ORG, async (tx) => {
    await tx.insert(schema.officeFeeProfiles).values([
      { orgId: ORG, clientId: "00000000-0000-4000-8000-000000000001", monthlyFee: "850.00", chargesAdditionalInstallment: true },
      { orgId: ORG, clientId: "00000000-0000-4000-8000-000000000002", monthlyFee: "500.00" },
    ]);
    await materializeOfficeFeeControl(tx, { orgId: ORG, actorId: "u1", periodYear: 2026, periodMonth: 9 });
    expect((await requests.upsertNfseSettings(tx, { orgId: ORG, actorId: "u1", providerCnpj: "11222333000181", dpsSeries: "1", template: TEST_TEMPLATE })).ok).toBe(true);
  });

  const preview = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 9, includeAdditional: true }));
  expect(preview.items.map((item) => item.kind)).toEqual(["monthly", "additional_installment"]);
  expect(preview.excluded.map((item) => item.reason)).toEqual(["missing_cnpj"]);
  // Controle de setembro emite a nota dos serviços de agosto.
  expect(preview.descriptions?.monthly).toBe("Honorários contábeis referentes à competência 08/2026.");

  const stale = await withOrgTx(ORG, (tx) => requests.enqueueNfseBatch(tx, { orgId: ORG, actorId: "u1", year: 2026, month: 9, includeAdditional: true, selected: preview.items.map(nfseBatchItemKey), expectedCount: 1, expectedTotalCents: 85000, today: "2026-10-05" }));
  expect(stale.ok).toBe(false);
  // Só a mensal marcada: a PA fica para depois, e volta na próxima prévia.
  const [monthlyItem, additionalItem] = preview.items;
  const onlyMonthly = await withOrgTx(ORG, (tx) => requests.enqueueNfseBatch(tx, { orgId: ORG, actorId: "u1", year: 2026, month: 9, includeAdditional: true, selected: [nfseBatchItemKey(monthlyItem)], expectedCount: 1, expectedTotalCents: 85000, today: "2026-10-05" }));
  expect(onlyMonthly).toEqual({ ok: true, data: { queued: 1 } });
  const remaining = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 9, includeAdditional: true }));
  expect(remaining.items.map(nfseBatchItemKey)).toEqual([nfseBatchItemKey(additionalItem)]);
  const queued = await withOrgTx(ORG, (tx) => requests.enqueueNfseBatch(tx, { orgId: ORG, actorId: "u1", year: 2026, month: 9, includeAdditional: true, selected: remaining.items.map(nfseBatchItemKey), expectedCount: 1, expectedTotalCents: 85000, today: "2026-10-05" }));
  expect(queued).toEqual({ ok: true, data: { queued: 1 } });

  // Repetir não duplica: a prévia já não tem nada.
  const again = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 9, includeAdditional: true }));
  expect(again.items).toHaveLength(0);

  // Batimento acha a organização.
  expect(await repo.registerFiscalService({ cnpj: "11222333000181", environment: 2, certificateValidUntil: new Date("2027-01-01"), error: null })).toBe(ORG);

  // Serviço: reivindica, emite as duas.
  const first = await repo.claimNfseJob(ORG);
  expect(first?.attemptCount).toBe(1);
  expect(first?.dpsNumber).toBe(1);
  const second = await repo.claimNfseJob(ORG); // a segunda, porque a primeira está com lease
  expect(second?.dpsNumber).toBe(2);
  // O pedido congelou o endereço do cadastro, com o código IBGE da tabela oficial.
  expect(first?.takerAddress).toEqual({ cityCode: "4308904", zipCode: "99900000", street: "RUA EDITH KURTZ", number: "871", complement: null, district: "SANTO ANDRE" });
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

  // "Tentar de novo" relê o endereço do cadastro (precisa do GRANT da 0081).
  expect(await repo.finishNfseJob(ORG, second!, { kind: "failed", message: "E0234: endereço", errors: [] })).toBe(true);
  await withOrgTx(ORG, (tx) => tx.update(schema.clients).set({ address: { street: "RUA NOVA", number: "", complement: null, district: "CENTRO", city: "Getúlio Vargas", state: "rs", zipCode: "99900000" } }).where(sql`id = '00000000-0000-4000-8000-000000000001'`));
  expect((await withOrgTx(ORG, (tx) => requests.requeueNfseInvoice(tx, { orgId: ORG, actorId: "u1", invoiceId: second!.id }))).ok).toBe(true);
  const [requeued] = await withOrgTx(ORG, (tx) => tx.select({ status: schema.nfseInvoices.status, address: schema.nfseInvoices.takerAddress }).from(schema.nfseInvoices).where(sql`id = ${second!.id}`));
  expect(requeued).toEqual({ status: "queued", address: { cityCode: "4308904", zipCode: "99900000", street: "RUA NOVA", number: "S/N", complement: null, district: "CENTRO" } });

  const events = await withOrgTx(ORG, (tx) => tx.select({ type: schema.nfseInvoiceEvents.eventType }).from(schema.nfseInvoiceEvents));
  expect(events.map((event) => event.type).sort()).toEqual(["cancel_requested", "cancelled", "failed", "issued", "requested", "requested", "retried"]);
}, 120_000);

test("tomador avulso com CPF: abre o mês, entra no lote e emite sem virar empresa", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { materializeOfficeFeeControl } = await import("@/lib/office-fees/materialize");
  const requests = await import("./requests");

  const takerId = await withOrgTx(ORG, async (tx) => {
    const [taker] = await tx.insert(schema.officeFeeTakers).values({
      orgId: ORG,
      name: "Pedro Rodighiero",
      document: "40503119091",
      address: { street: "LINHA SAO JOAO", number: null, complement: null, district: "INTERIOR", city: "GETULIO VARGAS", state: "RS", zipCode: "99900000" },
    }).returning();
    await tx.insert(schema.officeFeeProfiles).values({ orgId: ORG, takerId: taker.id, monthlyFee: "700.00" });
    // Empresa e avulso ao mesmo tempo não pode.
    await expect(
      tx.execute(sql`SAVEPOINT payer`).then(() => tx.insert(schema.officeFeeProfiles).values({ orgId: ORG, clientId: "00000000-0000-4000-8000-000000000002", takerId: taker.id, monthlyFee: "1.00" })),
    ).rejects.toThrow();
    await tx.execute(sql`ROLLBACK TO SAVEPOINT payer`);
    await materializeOfficeFeeControl(tx, { orgId: ORG, actorId: "u1", periodYear: 2026, periodMonth: 10 });
    // Abrir de novo não duplica a linha do avulso.
    await materializeOfficeFeeControl(tx, { orgId: ORG, actorId: "u1", periodYear: 2026, periodMonth: 10 });
    return taker.id;
  });

  const controls = await withOrgTx(ORG, (tx) => tx.select().from(schema.officeFeeControlPeriods).where(sql`taker_id = ${takerId}`));
  expect(controls).toHaveLength(1);
  expect(controls[0]).toMatchObject({ clientId: null, clientCnpjSnapshot: "40503119091", responsibleUserId: null });

  const preview = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 10, includeAdditional: false }));
  const item = preview.items.find((candidate) => candidate.takerId === takerId);
  expect(item).toMatchObject({ clientId: null, cnpj: "40503119091", amountCents: 70000, kind: "monthly" });
  expect(item?.address?.cityCode).toBe("4308904");

  const queued = await withOrgTx(ORG, (tx) => requests.enqueueNfseBatch(tx, { orgId: ORG, actorId: "u1", year: 2026, month: 10, includeAdditional: false, selected: [nfseBatchItemKey(item!)], expectedCount: 1, expectedTotalCents: 70000, today: "2026-10-21" }));
  expect(queued).toEqual({ ok: true, data: { queued: 1 } });
  const again = await withOrgTx(ORG, (tx) => requests.loadNfseEmissionPreview(tx, { orgId: ORG, year: 2026, month: 10, includeAdditional: false }));
  expect(again.items.some((candidate) => candidate.takerId === takerId)).toBe(false);
  const [invoice] = await withOrgTx(ORG, (tx) => tx.select().from(schema.nfseInvoices).where(sql`taker_id = ${takerId}`));
  expect(invoice).toMatchObject({ clientId: null, takerCnpj: "40503119091", takerName: "Pedro Rodighiero" });

  // O avulso não aparece como empresa.
  expect(await withOrgTx(ORG, (tx) => tx.select().from(schema.clients).where(sql`name = 'Pedro Rodighiero'`))).toHaveLength(0);

  // Com nota, apagar recusa (desativa); sem nota, apaga cadastro e Mês a mês.
  const { deleteOfficeFeePayer } = await import("@/lib/office-fees/delete-payer");
  const refused = await withOrgTx(ORG, (tx) => deleteOfficeFeePayer(tx, { orgId: ORG, clientId: null, takerId }));
  expect(refused.ok).toBe(false);
  const wrongId = await withOrgTx(ORG, async (tx) => {
    const [taker] = await tx.insert(schema.officeFeeTakers).values({ orgId: ORG, name: "KMJ cadastrada errado", document: "03750194000564" }).returning();
    await tx.insert(schema.officeFeeProfiles).values({ orgId: ORG, takerId: taker.id, monthlyFee: "415.00" });
    await materializeOfficeFeeControl(tx, { orgId: ORG, actorId: "u1", periodYear: 2026, periodMonth: 10 });
    return taker.id;
  });
  expect(await withOrgTx(ORG, (tx) => deleteOfficeFeePayer(tx, { orgId: ORG, clientId: null, takerId: wrongId }))).toEqual({ ok: true });
  expect(await withOrgTx(ORG, (tx) => tx.select().from(schema.officeFeeTakers).where(sql`id = ${wrongId}`))).toHaveLength(0);
  expect(await withOrgTx(ORG, (tx) => tx.select().from(schema.officeFeeControlPeriods).where(sql`taker_id = ${wrongId}`))).toHaveLength(0);
  // Empresa sem nota (o "Sem CNPJ" nunca emitiu) também apaga.
  expect(await withOrgTx(ORG, (tx) => deleteOfficeFeePayer(tx, { orgId: ORG, clientId: "00000000-0000-4000-8000-000000000002", takerId: null }))).toEqual({ ok: true });
});
