import { describe, expect, test } from "vitest";

import { buildDpsId } from "@/domain/nfse";

import { runNfseJob, type NfseJob } from "./processor";
import { NfseTransientError, type SefinClient } from "./sefin-client";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { createTestCertificate } from "./testing/certificate";

const template = TEST_TEMPLATE;
const cert = createTestCertificate();
const PROVIDER = "11222333000181";
const KEY = "4".repeat(50);

function job(overrides: Partial<NfseJob> = {}): NfseJob {
  return {
    id: "inv1",
    status: "queued",
    attemptCount: 1,
    dpsId: buildDpsId({ cityCode: template.cityCode, cnpj: PROVIDER, series: "1", number: 5 }),
    dpsSeries: "1",
    dpsNumber: 5,
    periodYear: 2026,
    periodMonth: 9,
    amountCents: 85000,
    takerCnpj: "33000167000101",
    takerName: "Padaria",
    description: "Honorários 09/2026.",
    accessKey: null,
    issuedEnvironment: null,
    cancelReasonCode: null,
    cancelReasonText: null,
    ...overrides,
  };
}

function client(overrides: Partial<SefinClient> = {}): SefinClient {
  return {
    emit: async () => ({ kind: "issued", accessKey: KEY, nfseNumber: "77" }),
    findAccessKeyByDps: async () => null,
    getNfseNumber: async () => "77",
    cancel: async () => ({ kind: "cancelled" }),
    getDanfse: async () => Buffer.from(""),
    ...overrides,
  };
}

function deps(sefin: SefinClient) {
  return {
    client: sefin,
    environment: 2 as const,
    providerCnpj: PROVIDER,
    template,
    signingKey: { privateKeyPem: cert.privateKeyPem, certificatePem: cert.certificatePem },
    now: new Date("2026-10-05T12:00:00Z"),
  };
}

describe("emissão", () => {
  test("consulta a DPS, emite e devolve chave e número", async () => {
    let emitted = "";
    const outcome = await runNfseJob(job(), deps(client({ emit: async (xml) => { emitted = xml; return { kind: "issued", accessKey: KEY, nfseNumber: "77" }; } })));
    expect(outcome).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "77", environment: 2 });
    expect(emitted).toContain("<Signature");
    expect(emitted).toContain("<dCompet>2026-09-30</dCompet>");
  });

  test("DPS que já virou nota é só recuperada, sem reenviar", async () => {
    let emitCalls = 0;
    const outcome = await runNfseJob(job({ attemptCount: 2 }), deps(client({
      findAccessKeyByDps: async () => KEY,
      emit: async () => { emitCalls += 1; return { kind: "issued", accessKey: KEY, nfseNumber: null }; },
    })));
    expect(outcome).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "77", environment: 2 });
    expect(emitCalls).toBe(0);
  });

  test("E0014 recupera a nota que já existe", async () => {
    let lookups = 0;
    const outcome = await runNfseJob(job(), deps(client({
      findAccessKeyByDps: async () => (lookups++ === 0 ? null : KEY),
      emit: async () => ({ kind: "rejected", errors: [{ code: "E0014", message: "já existe" }] }),
    })));
    expect(outcome.kind).toBe("issued");
  });

  test("recusa vira falha com o motivo legível", async () => {
    const outcome = await runNfseJob(job(), deps(client({
      emit: async () => ({ kind: "rejected", errors: [{ code: "E0312", message: "Tomador inexistente" }] }),
    })));
    expect(outcome).toEqual({
      kind: "failed",
      message: "E0312: Tomador inexistente",
      errors: [{ code: "E0312", message: "Tomador inexistente" }],
    });
  });

  test("queda de rede espera 1, 5 e 15 minutos e depois desiste", async () => {
    const down = client({ findAccessKeyByDps: async () => { throw new NfseTransientError("ECONNRESET"); } });
    expect(await runNfseJob(job({ attemptCount: 1 }), deps(down))).toEqual({ kind: "retry", message: "ECONNRESET", delayMinutes: 1 });
    expect(await runNfseJob(job({ attemptCount: 3 }), deps(down))).toEqual({ kind: "retry", message: "ECONNRESET", delayMinutes: 15 });
    const gaveUp = await runNfseJob(job({ attemptCount: 4 }), deps(down));
    expect(gaveUp.kind).toBe("failed");
  });

  test("modelo trocado depois do pedido não emite com identificador errado", async () => {
    const outcome = await runNfseJob(job({ dpsId: "DPS" + "9".repeat(42) }), deps(client()));
    expect(outcome.kind).toBe("failed");
  });
});

describe("cancelamento", () => {
  const issued = { status: "cancel_requested" as const, accessKey: KEY, issuedEnvironment: 2 as const, cancelReasonCode: 1 as const, cancelReasonText: "Valor do honorário errado." };

  test("evento aceito cancela", async () => {
    let sent = "";
    const outcome = await runNfseJob(job(issued), deps(client({ cancel: async (_key, xml) => { sent = xml; return { kind: "cancelled" }; } })));
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(sent).toContain("<e101101>");
  });

  test("evento recusado mantém a nota", async () => {
    const outcome = await runNfseJob(job(issued), deps(client({ cancel: async () => ({ kind: "rejected", errors: [{ code: "E1235", message: "Fora do prazo" }] }) })));
    expect(outcome).toEqual({ kind: "cancel_rejected", message: "E1235: Fora do prazo", errors: [{ code: "E1235", message: "Fora do prazo" }] });
  });

  test("nota de outro ambiente não é cancelada por este serviço", async () => {
    const outcome = await runNfseJob(job({ ...issued, issuedEnvironment: 1 }), deps(client()));
    expect(outcome.kind).toBe("cancel_rejected");
  });
});
