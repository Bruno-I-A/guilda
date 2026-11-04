import { describe, expect, test } from "vitest";

import { buildMonthForecast, forecastTextNeedsReview, modelRowsCoveredByForecast, type ForecastSource } from "./forecast";

const DECEMBER = { year: 2026, month: 12 };
const source = (accessKey: string, overrides: Partial<ForecastSource> = {}): ForecastSource => ({
  accessKey,
  takerDocument: "40503119091",
  takerName: "João",
  address: null,
  amountCents: 15000,
  description: "Atendimentos 10/2026",
  issuedAt: new Date("2026-11-10T12:00:00Z"),
  service: null,
  ...overrides,
});
const forecast = (sources: ForecastSource[], rest: Partial<Parameters<typeof buildMonthForecast>[0]> = {}) =>
  buildMonthForecast({ period: DECEMBER, sources, claims: [], standing: [], skipped: new Set(), ...rest });
const keys = (notes: { sourceAccessKey: string }[]) => notes.map((note) => note.sourceAccessKey);

describe("texto da nota prevista", () => {
  test("troca o mês que acompanhava a emissão, anterior ou o próprio", () => {
    expect(forecast([source("a")]).notes[0].description).toBe("Atendimentos 11/2026");
    expect(forecast([source("a", { description: "Aluguel 11/2026" })]).notes[0].description).toBe("Aluguel 12/2026");
  });

  test("texto sem data fica igual e não pede conferência", () => {
    const [note] = forecast([source("a", { description: "Consultoria mensal" })]).notes;
    expect(note).toMatchObject({ description: "Consultoria mensal", textNeedsReview: false });
  });

  test("data que não deu para trocar pede conferência", () => {
    expect(forecast([source("a", { description: "Atendimentos de novembro" })]).notes[0].textNeedsReview).toBe(true);
    expect(forecastTextNeedsReview("Parcela de out/2026")).toBe(true);
    expect(forecastTextNeedsReview("Referente a 08/2026 e {mes}")).toBe(true);
    expect(forecastTextNeedsReview("MARÇO de 2026")).toBe(true);
    expect(forecastTextNeedsReview("Atendimentos de {mes}")).toBe(false);
    expect(forecastTextNeedsReview("Contrato 123/45678 de serviço")).toBe(false);
  });
});

describe("o que sai da previsão", () => {
  test("três notas para a mesma pessoa continuam sendo três previstas", () => {
    expect(keys(forecast([source("a"), source("b"), source("c")]).notes)).toHaveLength(3);
  });

  test("a nota que veio da previsão resolve só a própria origem", () => {
    const { notes } = forecast([source("a"), source("b")], { claims: [{ takerDocument: "40503119091", amountCents: 15000, sourceAccessKey: "b" }] });
    expect(keys(notes)).toEqual(["a"]);
  });

  test("nota sem origem para a pessoa abate uma, preferindo a de mesmo valor", () => {
    const sources = [source("a", { amountCents: 10000 }), source("b", { amountCents: 25000 })];
    const { notes } = forecast(sources, { claims: [{ takerDocument: "40503119091", amountCents: 25000, sourceAccessKey: null }] });
    expect(keys(notes)).toEqual(["a"]);
  });

  test("valor diferente também abate: a nota da pessoa já saiu, com valor novo", () => {
    const { notes } = forecast([source("a")], { claims: [{ takerDocument: "40503119091", amountCents: 99900, sourceAccessKey: null }] });
    expect(notes).toEqual([]);
  });

  test("nota para outra pessoa não abate", () => {
    const { notes } = forecast([source("a")], { claims: [{ takerDocument: "33000167000101", amountCents: 15000, sourceAccessKey: null }] });
    expect(keys(notes)).toEqual(["a"]);
  });

  test("nota padrão em aberto ocupa o lugar de uma prevista da pessoa, sem levar a de valor exato", () => {
    const sources = [source("a", { amountCents: 10000 }), source("b", { amountCents: 25000 })];
    const { notes } = forecast(sources, { standing: ["40503119091"], claims: [{ takerDocument: "40503119091", amountCents: 25000, sourceAccessKey: null }] });
    expect(notes).toEqual([]);
    expect(keys(forecast(sources, { standing: ["40503119091"] }).notes)).toHaveLength(1);
  });

  test("não emitir este mês tira da conta e fica à mão para desfazer", () => {
    const { notes, skipped } = forecast([source("a"), source("b")], { skipped: new Set(["a"]) });
    expect(keys(notes)).toEqual(["b"]);
    expect(keys(skipped)).toEqual(["a"]);
  });

  test("nota sem origem não gasta a prevista que a pessoa pulou", () => {
    const { notes, skipped } = forecast([source("a"), source("b")], { skipped: new Set(["a"]), claims: [{ takerDocument: "40503119091", amountCents: 15000, sourceAccessKey: null }] });
    expect(notes).toEqual([]);
    expect(keys(skipped)).toEqual(["a"]);
  });
});

describe("nota padrão coberta pela previsão", () => {
  const row = (itemId: string | null, takerDocument = "40503119091", issuerId = "i") => ({ itemId, takerDocument, issuerId });
  test("sai da tela uma nota padrão sem ajuste para cada prevista da pessoa", () => {
    const rows = [row(null), row(null), row(null, "33000167000101")];
    expect(modelRowsCoveredByForecast(rows, [{ issuerId: "i", takerDocument: "40503119091" }])).toEqual([rows[0]]);
  });
  test("a ajustada neste mês fica, e outra empresa não conta", () => {
    expect(modelRowsCoveredByForecast([row("item"), row(null, "40503119091", "outra")], [{ issuerId: "i", takerDocument: "40503119091" }])).toEqual([]);
  });
});
