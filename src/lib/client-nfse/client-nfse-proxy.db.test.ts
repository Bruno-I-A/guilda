/**
 * Emissão das notas dos clientes por procuração (decisão de 2026-11-18),
 * contra um Postgres de verdade (PGlite) como guilda_app: o A1 do escritório
 * emite em nome da empresa, o XML vem da resposta, a nota achada pela DPS
 * nunca é adotada sem conferência e a recusa vira selo da empresa.
 */
import { gzipSync } from "node:zlib";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import type { SefinClient } from "@/lib/nfse/sefin-client";
import { createTestCertificate } from "@/lib/nfse/testing/certificate";
import { TEST_ACCESS_KEY, testNfseXml } from "@/lib/nfse/testing/nfse-xml";
import { applyMigrations } from "@/lib/nfse/testing/pglite";
import type { NfseIssuerTemplate } from "@/lib/nfse/template";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "orgA";
// O prestador das notas de teste (testNfseXml) é este CNPJ.
const EMPRESA = "00000000-0000-4000-8000-000000000001";
const CNPJ = "11222333000181";
const ISSUER = "00000000-0000-4000-8000-0000000000a1";
const TAKER = "00000000-0000-4000-8000-0000000000b1";
const INVOICE = "00000000-0000-4000-8000-0000000000d1";
const TEMPLATE: NfseIssuerTemplate = {
  cityCode: "4308904",
  taxRegime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
  service: { nationalTaxCode: "171901" },
  issqn: { taxation: "1", withholding: "1" },
  totalTaxes: { kind: "simples", percent: "6.00" },
};
// Gerado uma vez: o RSA do node-forge é lento.
const office = createTestCertificate({ commonName: "ESCRITORIO:99888777000166", password: "x" });
// Por procuração o cofre não pode ser aberto.
const vault = {
  keyId: "0123456789abcdef",
  publicKeySpki: "AAAA",
  open: () => {
    throw new Error("o cofre não deve ser aberto por procuração");
  },
};

function officeClient(overrides: Partial<SefinClient>): SefinClient {
  return {
    emit: async () => {
      throw new Error("emit não preparado");
    },
    findAccessKeyByDps: async () => null,
    getNfseNumber: async () => null,
    cancel: async () => ({ kind: "cancelled" }),
    // Por procuração a consulta pela chave é recusada.
    getNfseXml: async () => {
      throw new Error("Consulta da nota falhou: HTTP 403.");
    },
    ...overrides,
  };
}

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('${ORG}', 'Escritório', 'esc', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Fiscal', 'f@x', true, now(), now());
    INSERT INTO clients (id, org_id, name, tax_regime, cnpj, cnae_code) VALUES ('${EMPRESA}', '${ORG}', 'Engenharia', 'simples', '${CNPJ}', '7112000');
    INSERT INTO client_nfse_issuers (id, org_id, client_id, template, dps_series, next_dps_number) VALUES ('${ISSUER}', '${ORG}', '${EMPRESA}', '${JSON.stringify(TEMPLATE)}', '900', 2);
    INSERT INTO client_nfse_takers (id, org_id, issuer_id, name, document) VALUES ('${TAKER}', '${ORG}', '${ISSUER}', 'Padaria', '33000167000101');
    INSERT INTO client_nfse_items (id, org_id, request_id, issuer_id, taker_id, period_year, period_month, amount, description)
      VALUES ('00000000-0000-4000-8000-0000000000c1', '${ORG}', '00000000-0000-4000-8000-0000000000e1', '${ISSUER}', '${TAKER}', 2026, 11, '850.50', 'SERVIÇO');
    INSERT INTO client_nfse_invoices (id, org_id, issuer_id, client_id, taker_id, item_id, period_year, period_month, amount, provider_cnpj, template,
      taker_document, taker_name, description, dps_series, dps_number, dps_id, requested_by)
      VALUES ('${INVOICE}', '${ORG}', '${ISSUER}', '${EMPRESA}', '${TAKER}', '00000000-0000-4000-8000-0000000000c1', 2026, 11, '850.50', '${CNPJ}',
        '${JSON.stringify(TEMPLATE)}', '33000167000101', 'Padaria', 'SERVIÇO', '900', 1, 'DPS430890421122233300018100900000000000001', 'u1');
    INSERT INTO nfse_credential_settings (org_id, default_mode) VALUES ('${ORG}', 'proxy');
  `);
  await client.exec("SET ROLE guilda_app;");
}, 120_000);

afterAll(() => client.close());

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function invoice() {
  const { withOrgTx } = await import("@/db/org-tx");
  const [row] = await withOrgTx(ORG, (tx) => tx.select().from(schema.clientNfseInvoices).where(eq(schema.clientNfseInvoices.id, INVOICE)));
  return row;
}

async function requeue() {
  const { withOrgTx } = await import("@/db/org-tx");
  await withOrgTx(ORG, (tx) =>
    tx.update(schema.clientNfseInvoices).set({ status: "queued", lastError: null, nextAttemptAt: new Date(0) }).where(eq(schema.clientNfseInvoices.id, INVOICE)),
  );
}

test("nota achada pela DPS sem XML para conferir fica com erro, nunca é adotada", async () => {
  const { runClientNfseQueue } = await import("./service");
  const signed: string[] = [];
  const client = officeClient({
    findAccessKeyByDps: async () => TEST_ACCESS_KEY,
    emit: async (xml) => {
      signed.push(xml);
      throw new Error("não deve emitir: a DPS já existe");
    },
  });

  await runClientNfseQueue(ORG, vault, "restrita", { client, signingKey: { privateKeyPem: office.privateKeyPem, certificatePem: office.certificatePem } });

  expect(signed).toEqual([]);
  expect(await invoice()).toMatchObject({ status: "failed", accessKey: null, lastError: expect.stringMatching(/Não foi possível conferir a nota achada pela DPS/) });
}, 60_000);

test("nota achada pela DPS é conferida pelo XML que a rotina da aba XML já guardou", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { runClientNfseQueue } = await import("./service");
  // A nota guardada pela rotina é de outro tomador: a conferência pega e não adota.
  await withOrgTx(ORG, (tx) =>
    tx.insert(schema.nfseIssuedNotes).values({
      orgId: ORG,
      clientId: EMPRESA,
      accessKey: TEST_ACCESS_KEY,
      nsu: 7,
      issuedAt: new Date("2026-11-05T12:00:00Z"),
      xmlGz: new Uint8Array(gzipSync(Buffer.from(testNfseXml(), "utf8"))),
    }),
  );
  await requeue();
  const client = officeClient({ findAccessKeyByDps: async () => TEST_ACCESS_KEY });

  await runClientNfseQueue(ORG, vault, "restrita", { client, signingKey: { privateKeyPem: office.privateKeyPem, certificatePem: office.certificatePem } });

  const after = await invoice();
  expect(after.status).not.toBe("issued");
  expect(after.accessKey).toBeNull();
}, 60_000);

test("procuração: emite com o A1 do escritório, guarda o XML da resposta e não abre o cofre", async () => {
  const { runClientNfseQueue } = await import("./service");
  await requeue();
  const xml = testNfseXml();
  const signed: string[] = [];
  const client = officeClient({
    emit: async (dps) => {
      signed.push(dps);
      return { kind: "issued", accessKey: "1".repeat(50), nfseNumber: "8", xml };
    },
  });

  await runClientNfseQueue(ORG, vault, "restrita", { client, signingKey: { privateKeyPem: office.privateKeyPem, certificatePem: office.certificatePem } });

  const after = await invoice();
  expect(after).toMatchObject({ status: "issued", nfseNumber: "8", accessKey: "1".repeat(50) });
  expect(after.xmlGz).not.toBeNull();
  // A DPS sai em nome da empresa, assinada com o A1 do escritório.
  expect(signed[0]).toContain(`<prest><CNPJ>${CNPJ}</CNPJ>`);
  expect(signed[0]).toContain("<Signature");
}, 60_000);

test("procuração sem permissão de emissão vira selo da empresa e a próxima nota nem tenta", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { runClientNfseQueue } = await import("./service");
  const credentials = await import("@/lib/nfse/credentials-repository");
  await withOrgTx(ORG, (tx) =>
    tx.update(schema.clientNfseInvoices).set({ status: "failed", accessKey: null, nfseNumber: null, xmlGz: null, environment: null, issuedAt: null }).where(eq(schema.clientNfseInvoices.id, INVOICE)),
  );
  await requeue();
  let emits = 0;
  const client = officeClient({
    emit: async () => {
      emits += 1;
      return { kind: "rejected", errors: [{ code: "E2245", message: "Não há procuração da inscrição X para a Y" }] };
    },
  });
  const signingKey = { privateKeyPem: office.privateKeyPem, certificatePem: office.certificatePem };

  await runClientNfseQueue(ORG, vault, "restrita", { client, signingKey });
  expect(await credentials.loadClientCredential(ORG, EMPRESA)).toMatchObject({ mode: "proxy", proxyStatus: "no_emission" });
  expect((await invoice()).status).toBe("failed");

  await requeue();
  await runClientNfseQueue(ORG, vault, "restrita", { client, signingKey });
  expect(emits).toBe(1);
  expect((await invoice()).lastError).toMatch(/não permite emitir/);
}, 60_000);

test("sem o A1 do escritório no serviço fiscal, a nota por procuração falha com o motivo", async () => {
  const { runClientNfseQueue } = await import("./service");
  const credentials = await import("@/lib/nfse/credentials-repository");
  await credentials.saveProxyStatus(ORG, EMPRESA, { status: "confirmed", code: null, message: null, checkedAt: new Date() });
  await requeue();

  await runClientNfseQueue(ORG, vault, "restrita", null);

  expect(await invoice()).toMatchObject({ status: "failed", lastError: "O A1 do escritório não está disponível no serviço fiscal." });
}, 60_000);

test("prontidão: por procuração a empresa sem certificado emite; recusada bloqueia com o motivo; por certificado volta a pedir o A1", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const month = await import("./month");
  const credentials = await import("@/lib/nfse/credentials-repository");
  const problem = async () => (await withOrgTx(ORG, (tx) => month.loadIssuerReadiness(tx, { orgId: ORG, now: new Date() }))).get(ISSUER)?.problem;

  await credentials.saveProxyStatus(ORG, EMPRESA, { status: "untested", code: null, message: null, checkedAt: new Date() });
  expect(await problem()).toBeNull();
  await credentials.saveProxyStatus(ORG, EMPRESA, { status: "invalid", code: "E2245", message: "Não há procuração", checkedAt: new Date() });
  expect(await problem()).toMatch(/Procuração recusada/);
  await withOrgTx(ORG, (tx) => credentials.setClientModeIn(tx, ORG, { clientId: EMPRESA, mode: "certificate", actorId: "u1", now: new Date() }));
  expect(await problem()).toMatch(/Sem certificado A1/);
  await withOrgTx(ORG, (tx) => credentials.setClientModeIn(tx, ORG, { clientId: EMPRESA, mode: null, actorId: "u1", now: new Date() }));
}, 60_000);

test("buscar notas antigas e o cartão da empresa seguem a procuração", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const loaders = await import("./loaders");
  const credentials = await import("@/lib/nfse/credentials-repository");

  await credentials.saveProxyStatus(ORG, EMPRESA, { status: "confirmed", code: null, message: null, checkedAt: new Date() });
  expect((await withOrgTx(ORG, (tx) => loaders.loadIssuerCustomers(tx, { orgId: ORG, issuerId: ISSUER })))?.canReadHistory).toBe(true);
  const workspace = await withOrgTx(ORG, (tx) => loaders.loadClientNfseWorkspace(tx, { orgId: ORG, year: 2026, month: 11, now: new Date() }));
  expect(workspace.issuers.find((issuer) => issuer.id === ISSUER)?.credential).toEqual({ mode: "proxy", proxyStatus: "confirmed" });

  await credentials.saveProxyStatus(ORG, EMPRESA, { status: "invalid", code: "E2245", message: "Não há procuração", checkedAt: new Date() });
  expect((await withOrgTx(ORG, (tx) => loaders.loadIssuerCustomers(tx, { orgId: ORG, issuerId: ISSUER })))?.canReadHistory).toBe(false);
}, 60_000);
