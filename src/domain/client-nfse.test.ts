import { describe, expect, test } from "vitest";

import {
  clientNfseMonthDescription,
  clientNfseReferencePeriod,
  renderClientNfseDescription,
  selectClientNfseBatch,
  type ClientNfseCandidate,
} from "./client-nfse";

function candidate(overrides: Partial<ClientNfseCandidate> = {}): ClientNfseCandidate {
  return {
    itemId: "i1",
    issuerId: "e1",
    issuerName: "Academia",
    takerName: "Cliente",
    takerDocument: "33000167000101",
    amount: "150.00",
    description: "Mensalidade 10/2026",
    address: null,
    requireAddress: false,
    hasActiveInvoice: false,
    issuerProblem: null,
    ...overrides,
  };
}

describe("referência da nota", () => {
  test("mês anterior vira o ano em janeiro; o próprio mês fica", () => {
    expect(clientNfseReferencePeriod({ year: 2027, month: 1 }, "previous")).toEqual({ year: 2026, month: 12 });
    expect(clientNfseReferencePeriod({ year: 2026, month: 11 }, "previous")).toEqual({ year: 2026, month: 10 });
    expect(clientNfseReferencePeriod({ year: 2026, month: 11 }, "current")).toEqual({ year: 2026, month: 11 });
  });

  test("marcadores {mes}, {competencia} e {ano}", () => {
    expect(renderClientNfseDescription(" Aluguel {mes} — {competencia} de {ano} ", { year: 2026, month: 9 })).toBe(
      "Aluguel 09/2026 — 09/2026 de 2026",
    );
    expect(clientNfseMonthDescription("Referente a {mes}", { year: 2026, month: 11 }, "previous")).toBe("Referente a 10/2026");
    expect(clientNfseMonthDescription("Referente a {mes}", { year: 2026, month: 11 }, "current")).toBe("Referente a 11/2026");
  });
});

describe("lote do mês", () => {
  test("entra o que pode emitir; o resto sai com o motivo", () => {
    const batch = selectClientNfseBatch([
      candidate(),
      candidate({ itemId: "i2", hasActiveInvoice: true }),
      candidate({ itemId: "i3", issuerProblem: "Certificado vencido." }),
      candidate({ itemId: "i4", takerDocument: "33000167000102" }),
      candidate({ itemId: "i5", amount: "0.00" }),
      candidate({ itemId: "i6", description: "  " }),
      candidate({ itemId: "i7", requireAddress: true }),
      candidate({ itemId: "i8", takerDocument: "40503119091", amount: "99.90" }),
    ]);
    expect(batch.items.map((item) => item.itemId)).toEqual(["i1", "i8"]);
    expect(batch.totalCents).toBe(15000 + 9990);
    expect(batch.excluded.map((item) => [item.itemId, item.reason])).toEqual([
      ["i2", "already_active"],
      ["i3", "issuer_not_ready"],
      ["i4", "invalid_document"],
      ["i5", "zero_amount"],
      ["i6", "missing_description"],
      ["i7", "missing_address"],
    ]);
    expect(batch.excluded[1].detail).toBe("Certificado vencido.");
  });
});
