import { describe, expect, test } from "vitest";

import {
  amountToCents,
  buildCancelRequestId,
  buildDpsId,
  centsToNfseAmount,
  danfseFileName,
  isFutureNfsePeriod,
  nfseCompetenceDate,
  nfseServiceHealth,
  normalizeDpsSeries,
  renderNfseDescription,
  selectNfseBatch,
  type NfseCandidate,
} from "./nfse";

const CNPJ_OK = "11222333000181";

function candidate(overrides: Partial<NfseCandidate> = {}): NfseCandidate {
  return {
    controlPeriodId: "c1",
    clientId: "cli1",
    clientName: "Padaria Pão Quente",
    cnpj: CNPJ_OK,
    monthlyFee: "850.00",
    chargesAdditionalInstallment: false,
    ...overrides,
  };
}

describe("identificadores do leiaute nacional", () => {
  test("DPS tem 45 posições com série e número completados com zeros", () => {
    const id = buildDpsId({ cityCode: "4314902", cnpj: CNPJ_OK, series: "1", number: 37 });
    expect(id).toBe(`DPS43149022${CNPJ_OK}00001000000000000037`);
    expect(id).toHaveLength(45);
  });

  test("série fora da faixa de aplicativo próprio é recusada", () => {
    expect(() => normalizeDpsSeries("70000")).toThrow(/1 e 49999/);
    expect(() => normalizeDpsSeries("0")).toThrow();
    expect(normalizeDpsSeries("00010")).toBe("10");
  });

  test("pedido de cancelamento é PRE + chave + 101101", () => {
    const key = "1".repeat(50);
    expect(buildCancelRequestId(key)).toBe(`PRE${key}101101`);
    expect(buildCancelRequestId(key)).toHaveLength(59);
    expect(() => buildCancelRequestId("123")).toThrow();
  });
});

describe("valores", () => {
  test("decimal canônico vira centavos e volta no formato do leiaute", () => {
    expect(amountToCents("850")).toBe(85000);
    expect(amountToCents("850.5")).toBe(85050);
    expect(amountToCents("0.07")).toBe(7);
    expect(centsToNfseAmount(85050)).toBe("850.50");
    expect(centsToNfseAmount(7)).toBe("0.07");
    expect(() => centsToNfseAmount(0)).toThrow();
  });
});

describe("texto e datas", () => {
  test("descrição troca competência e ano", () => {
    expect(renderNfseDescription("Honorários {competencia} ({ano})", { year: 2026, month: 9 }))
      .toBe("Honorários 09/2026 (2026)");
  });

  test("competência é o último dia do mês, ou hoje se o mês não terminou", () => {
    expect(nfseCompetenceDate({ year: 2026, month: 9 }, "2026-10-05")).toBe("2026-09-30");
    expect(nfseCompetenceDate({ year: 2026, month: 10 }, "2026-10-05")).toBe("2026-10-05");
    expect(nfseCompetenceDate({ year: 2028, month: 2 }, "2028-03-01")).toBe("2028-02-29");
  });

  test("mês que ainda não começou não emite", () => {
    expect(isFutureNfsePeriod({ year: 2026, month: 11 }, "2026-10-31")).toBe(true);
    expect(isFutureNfsePeriod({ year: 2026, month: 10 }, "2026-10-01")).toBe(false);
  });

  test("nome do PDF é estável e sem acento", () => {
    expect(danfseFileName({ nfseNumber: "123", dpsNumber: 9, takerName: "Padaria Pão & Cia" }))
      .toBe("000123-padaria-pao-cia.pdf");
    expect(danfseFileName({ nfseNumber: null, dpsNumber: 9, takerName: "  " })).toBe("dps-9.pdf");
  });
});

describe("seleção do lote", () => {
  test("inclui a mensal e explica quem fica de fora", () => {
    const batch = selectNfseBatch({
      candidates: [
        candidate(),
        candidate({ controlPeriodId: "c2", clientId: "cli2", clientName: "Sem CNPJ", cnpj: null }),
        candidate({ controlPeriodId: "c3", clientId: "cli3", clientName: "CNPJ errado", cnpj: "11111111111111" }),
        candidate({ controlPeriodId: "c4", clientId: "cli4", clientName: "Zerada", monthlyFee: "0.00" }),
        candidate({ controlPeriodId: "c5", clientId: "cli5", clientName: "Já emitida" }),
      ],
      activeMonthlyClientIds: new Set(["cli5"]),
      activeAdditionalClientIds: new Set(),
      includeAdditional: false,
    });
    expect(batch.items.map((item) => item.clientId)).toEqual(["cli1"]);
    expect(batch.totalCents).toBe(85000);
    expect(batch.excluded.map((item) => item.reason)).toEqual([
      "missing_cnpj",
      "invalid_cnpj",
      "zero_amount",
      "already_active",
    ]);
  });

  test("PA só entra marcada, para quem cobra, uma vez por ano", () => {
    const candidates = [
      candidate({ chargesAdditionalInstallment: true }),
      candidate({ controlPeriodId: "c2", clientId: "cli2", clientName: "Já teve PA", chargesAdditionalInstallment: true }),
      candidate({ controlPeriodId: "c3", clientId: "cli3", clientName: "Não cobra PA" }),
    ];
    const without = selectNfseBatch({ candidates, activeMonthlyClientIds: new Set(), activeAdditionalClientIds: new Set(["cli2"]), includeAdditional: false });
    expect(without.items.filter((item) => item.kind === "additional_installment")).toHaveLength(0);

    const withPa = selectNfseBatch({ candidates, activeMonthlyClientIds: new Set(), activeAdditionalClientIds: new Set(["cli2"]), includeAdditional: true });
    expect(withPa.items.filter((item) => item.kind === "additional_installment").map((item) => item.clientId)).toEqual(["cli1"]);
    expect(withPa.excluded).toEqual([
      { controlPeriodId: "c2", clientName: "Já teve PA", kind: "additional_installment", reason: "already_active" },
    ]);
    expect(withPa.totalCents).toBe(85000 * 4);
  });
});

describe("saúde do serviço fiscal", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  test("sem batimento recente é offline; com erro é erro; senão pronto", () => {
    expect(nfseServiceHealth({ configured: false, serviceSeenAt: null, serviceError: null, certificateValidUntil: null, now }).state).toBe("unconfigured");
    expect(nfseServiceHealth({ configured: true, serviceSeenAt: new Date("2026-10-10T11:50:00Z"), serviceError: null, certificateValidUntil: null, now }).state).toBe("offline");
    expect(nfseServiceHealth({ configured: true, serviceSeenAt: new Date("2026-10-10T11:59:00Z"), serviceError: "Certificado vencido", certificateValidUntil: null, now }).state).toBe("error");
    const ready = nfseServiceHealth({ configured: true, serviceSeenAt: new Date("2026-10-10T11:59:00Z"), serviceError: null, certificateValidUntil: new Date("2026-11-01T12:00:00Z"), now });
    expect(ready).toEqual({ state: "ready", certificateDaysLeft: 22 });
  });
});
