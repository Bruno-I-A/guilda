import { afterEach, describe, expect, test, vi } from "vitest";

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
    takerAddress: null,
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
    emit: async () => ({ kind: "issued", accessKey: KEY, nfseNumber: "77", xml: null }),
    findAccessKeyByDps: async () => null,
    getNfseNumber: async () => "77",
    cancel: async () => ({ kind: "cancelled" }),
    getNfseXml: async () => "<NFSe/>",
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
    const outcome = await runNfseJob(job(), deps(client({ emit: async (xml) => { emitted = xml; return { kind: "issued", accessKey: KEY, nfseNumber: "77", xml: "<NFSe/>" }; } })));
    // O XML da resposta segue no desfecho (a fila das notas dos clientes guarda; a dos honorários não).
    expect(outcome).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "77", xml: "<NFSe/>", environment: 2 });
    expect(emitted).toContain("<Signature");
    expect(emitted).toContain("<dCompet>2026-10-05</dCompet>");
  });

  test("DPS que já virou nota é só recuperada, sem reenviar", async () => {
    let emitCalls = 0;
    const outcome = await runNfseJob(job({ attemptCount: 2 }), deps(client({
      findAccessKeyByDps: async () => KEY,
      emit: async () => { emitCalls += 1; return { kind: "issued", accessKey: KEY, nfseNumber: null, xml: null }; },
    })));
    expect(outcome).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "77", environment: 2, foundByDps: true });
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

describe("virada da NT 009 (01/12/2026)", () => {
  // Produção (ambiente 1) em 01/12/2026: pela data, a DPS sai no leiaute da NT 009.
  const production = (sefin: SefinClient) => ({ ...deps(sefin), environment: 1 as const, now: new Date("2026-12-01T13:00:00Z") });
  const schemaError = { code: "E1235", message: "The element 'infDPS' has invalid child element 'finNFSe'." };
  const isNt009 = (xml: string) => xml.includes("<tpEmit>1</tpEmit><finNFSe>");

  afterEach(() => vi.unstubAllEnvs());

  test("o governo ainda no leiaute antigo: a recusa de esquema faz a mesma DPS sair no outro leiaute, uma vez", async () => {
    const sent: string[] = [];
    const outcome = await runNfseJob(job(), production(client({
      emit: async (xml) => {
        sent.push(xml);
        return isNt009(xml) ? { kind: "rejected", errors: [schemaError] } : { kind: "issued", accessKey: KEY, nfseNumber: "78", xml: null };
      },
    })));
    expect(outcome).toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "78", xml: null, environment: 1 });
    expect(sent.map(isNt009)).toEqual([true, false]);
  });

  test("recusa que não é de esquema não tenta o outro leiaute", async () => {
    let emits = 0;
    const outcome = await runNfseJob(job(), production(client({
      emit: async () => { emits += 1; return { kind: "rejected", errors: [{ code: "E0312", message: "Tomador inexistente" }] }; },
    })));
    expect(outcome).toMatchObject({ kind: "failed", message: "E0312: Tomador inexistente" });
    expect(emits).toBe(1);
  });

  test("com NFSE_LEIAUTE forçado, o leiaute não troca", async () => {
    vi.stubEnv("NFSE_LEIAUTE", "nt009");
    let emits = 0;
    const outcome = await runNfseJob(job(), production(client({
      emit: async () => { emits += 1; return { kind: "rejected", errors: [schemaError] }; },
    })));
    expect(outcome.kind).toBe("failed");
    expect(emits).toBe(1);
  });

  test("os dois leiautes recusados: fica o erro do leiaute da data, que é o que explica o problema", async () => {
    const outcome = await runNfseJob(job(), production(client({
      emit: async (xml) => ({
        kind: "rejected",
        errors: [isNt009(xml) ? { code: "E1235", message: "Caractere inválido na descrição" } : schemaError],
      }),
    })));
    expect(outcome).toMatchObject({ kind: "failed", message: "E1235: Caractere inválido na descrição" });
  });
});
