import { describe, expect, test } from "vitest";

import type { ClientNfseIssuerView } from "./loaders";
import { matchesCompanyFilter, matchesCompanyQuery, matchesIssuer, summarizeNotes } from "./presentation";

const note = (status: string, amount = "200.20") => ({ amount, takerName: "Maria Tomadora", takerDocument: "40503119091", invoice: { status } }) as ClientNfseIssuerView["notes"][number];
const company = (overrides: Partial<ClientNfseIssuerView> = {}) => ({ name: "Clínica Exemplo", cnpj: "12345678000190", takers: [], notes: [], ...overrides }) as ClientNfseIssuerView;

describe("resumo da empresa no mês", () => {
  test("soma só o valor das emitidas; cancelada não conta em nada", () => {
    expect(summarizeNotes([note("issued"), note("issued", "100.10"), note("failed"), note("queued"), note("cancel_requested"), note("cancelled")])).toEqual({ issued: 2, issuedCents: 30030, failed: 1, working: 2 });
  });
});

describe("filtros", () => {
  test("sem filtro, toda empresa aparece", () => {
    expect(matchesCompanyFilter([], null)).toBe(true);
  });
  test("mostra a empresa com aquela situação", () => {
    const notes = [note("failed"), note("issued")];
    expect(matchesCompanyFilter(notes, "failed")).toBe(true);
    expect(matchesCompanyFilter(notes, "issued")).toBe(true);
    expect(matchesCompanyFilter(notes, "working")).toBe(false);
    expect(matchesCompanyFilter(notes, "none")).toBe(false);
  });
  test("só cancelada conta como sem nota", () => {
    expect(matchesCompanyFilter([], "none")).toBe(true);
    expect(matchesCompanyFilter([note("cancelled")], "none")).toBe(true);
  });
});

describe("busca", () => {
  test("encontra empresa por nome sem acento e por CNPJ formatado", () => {
    const issuer = { name: "Clínica Exemplo", cnpj: "12345678000190" };
    expect(matchesIssuer(issuer, "clinica")).toBe(true);
    expect(matchesIssuer(issuer, "12.345.678/0001-90")).toBe(true);
    expect(matchesIssuer(issuer, "outra")).toBe(false);
  });
  test("acha a empresa pelo cliente: nota do mês ou tomador, por nome ou documento", () => {
    expect(matchesCompanyQuery(company({ notes: [note("issued")] }), "maria")).toBe(true);
    expect(matchesCompanyQuery(company({ notes: [note("issued")] }), "405.031")).toBe(true);
    expect(matchesCompanyQuery(company({ takers: [{ name: "Padaria Pão", document: "33000167000101" }] as ClientNfseIssuerView["takers"] }), "pao")).toBe(true);
    expect(matchesCompanyQuery(company({ notes: [note("issued")] }), "ninguém")).toBe(false);
  });
});
