import { describe, expect, test } from "vitest";
import type { ClientNfseFreeNoteView, ClientNfseIssuerView, ClientNfseNoteView } from "./loaders";
import { batchOutcome, deskScore, issuerDesk, issuerMonthNotes, matchesDeskFilter, matchesDeskQuery, matchesIssuer, matchesNoteFilter, portalReadIsStale, summarizeNotes } from "./presentation";

// Só os campos usados pelo resumo; os demais pertencem aos formulários.
const fixed = (status?: string, amount = "100.10") => ({ modelId: "model", amount, takerName: "Fixo", takerDocument: "11111111111", invoice: status ? { id: `f-${status}`, status } : null }) as ClientNfseNoteView;
const free = (status: string, amount = "200.20", id = `l-${status}`) => ({ amount, takerName: "Avulso", takerDocument: "22222222222", invoice: { id, status } }) as ClientNfseFreeNoteView;
const predicted = (amount = "150.00") => ({ amount, takerName: "Maria Prevista", takerDocument: "40503119091" });
const issuer = (overrides: Partial<Record<keyof ClientNfseIssuerView, unknown>> = {}) =>
  ({ id: "i", name: "Clínica Exemplo", cnpj: "12345678000190", active: true, problem: null, notes: [], freeNotes: [], takers: [], forecast: { notes: [], skipped: [], portalReadAt: null }, ...overrides }) as unknown as ClientNfseIssuerView;
const withForecast = (...notes: ReturnType<typeof predicted>[]) => ({ forecast: { notes, skipped: [], portalReadAt: null } });

describe("painel de emissão", () => {
  test("soma fixas e avulsas emitidas, sem incluir pendentes, falhas ou canceladas no valor emitido", () => {
    const notes = [fixed("issued"), free("issued"), fixed(), free("failed"), free("cancelled"), free("queued")];
    expect(summarizeNotes(notes)).toEqual({ total: 6, issued: 2, issuedCents: 30030, pending: 1, failed: 1, working: true });
  });
  test("a empresa que só tem fixa emitida não fica vazia", () => {
    const notes = issuerMonthNotes({ notes: [fixed("issued")], freeNotes: [] });
    expect(summarizeNotes(notes)).toMatchObject({ total: 1, issued: 1, issuedCents: 10010 });
  });
  test("avulsa na fila ou cancelando mantém a atualização automática", () => {
    expect(summarizeNotes([free("queued")]).working).toBe(true);
    expect(summarizeNotes([free("cancel_requested")]).working).toBe(true);
    expect(summarizeNotes([free("failed")]).working).toBe(false);
  });
  test("cancelada fixa pode ser reemitida; avulsa cancelada não vira pendência", () => {
    expect(matchesNoteFilter(fixed("cancelled"), "pending")).toBe(true);
    expect(matchesNoteFilter(free("cancelled"), "pending")).toBe(false);
    expect(matchesNoteFilter(fixed("cancelled"), "cancelled")).toBe(true);
    expect(matchesNoteFilter(fixed("failed"), "pending")).toBe(false);
  });
  test("encontra empresa por nome sem acento e por CNPJ formatado", () => {
    const company = { name: "Clínica Exemplo", cnpj: "12345678000190" };
    expect(matchesIssuer(company, "clinica")).toBe(true);
    expect(matchesIssuer(company, "12.345.678/0001-90")).toBe(true);
    expect(matchesIssuer(company, "outra")).toBe(false);
  });
});

describe("busca da Mesa do mês", () => {
  test("acha a empresa pelo cliente: prevista, tomador ou nota do mês, por nome ou documento", () => {
    expect(matchesDeskQuery(issuer(withForecast(predicted())), "maria")).toBe(true);
    expect(matchesDeskQuery(issuer(withForecast(predicted())), "405.031")).toBe(true);
    expect(matchesDeskQuery(issuer({ takers: [{ name: "Padaria Pão", document: "33000167000101" }] }), "pao")).toBe(true);
    expect(matchesDeskQuery(issuer({ freeNotes: [free("issued")] }), "avulso")).toBe(true);
    expect(matchesDeskQuery(issuer(withForecast(predicted())), "ninguém")).toBe(false);
  });
});

describe("grupos da Mesa do mês", () => {
  test("erro vem antes de tudo, mesmo com previstas e emitidas", () => {
    expect(issuerDesk(issuer({ freeNotes: [free("failed"), free("issued")], ...withForecast(predicted()) })).group).toBe("resolve");
  });
  test("empresa bloqueada só cobra quando tem nota esperando", () => {
    expect(issuerDesk(issuer({ problem: "Certificado vencido.", ...withForecast(predicted()) }))).toMatchObject({ group: "resolve", blocked: true });
    expect(issuerDesk(issuer({ problem: "Certificado vencido." }))).toMatchObject({ group: "quiet", blocked: false });
  });
  test("prevista e nota padrão em aberto contam como previstas, com o valor somado", () => {
    expect(issuerDesk(issuer({ notes: [fixed()], ...withForecast(predicted()) }))).toMatchObject({ group: "forecast", forecast: 2, forecastCents: 25010 });
  });
  test("depois vêm em andamento, emitidas e quem não tem nada no mês", () => {
    expect(issuerDesk(issuer({ freeNotes: [free("queued"), free("issued")] })).group).toBe("working");
    expect(issuerDesk(issuer({ freeNotes: [free("issued")] })).group).toBe("issued");
    expect(issuerDesk(issuer({ freeNotes: [free("cancelled")] })).group).toBe("quiet");
    expect(issuerDesk(issuer()).group).toBe("quiet");
  });
  test("o placar conta notas e empresas, e empresa sem previsão não vira pendência", () => {
    const desks = [issuer({ freeNotes: [free("failed")], ...withForecast(predicted()) }), issuer(withForecast(predicted(), predicted())), issuer({ problem: "x", ...withForecast(predicted()) }), issuer({ freeNotes: [free("issued", "100.00")] }), issuer()].map(issuerDesk);
    expect(deskScore(desks)).toEqual({
      resolve: { count: 2, companies: 2 },
      forecast: { count: 4, companies: 3 },
      working: { count: 0, companies: 0 },
      issued: { count: 1, companies: 1, cents: 10000 },
    });
  });
  test("o filtro mostra toda empresa com a situação, mesmo agrupada em outro lugar", () => {
    const desk = issuerDesk(issuer({ freeNotes: [free("failed"), free("issued")], ...withForecast(predicted()) }));
    expect(matchesDeskFilter(desk, null)).toBe(true);
    expect(matchesDeskFilter(desk, "resolve")).toBe(true);
    expect(matchesDeskFilter(desk, "forecast")).toBe(true);
    expect(matchesDeskFilter(desk, "issued")).toBe(true);
    expect(matchesDeskFilter(desk, "working")).toBe(false);
  });
});

describe("fim do lote", () => {
  test("conta o que saiu, o que deu erro e o que falta, inclusive nota que a tela ainda não recebeu", () => {
    const issuers = [issuer({ freeNotes: [free("issued", "1.00", "a"), free("failed", "1.00", "b"), free("queued", "1.00", "c"), free("issued", "1.00", "fora")] })];
    expect(batchOutcome(new Set(["a", "b", "c", "novo"]), issuers)).toEqual({ issued: 1, failed: 1, waiting: 2, total: 4 });
  });
});

describe("leitura do Portal", () => {
  const now = new Date("2026-12-05T12:00:00Z");
  test("é antiga sem leitura ou depois de um dia", () => {
    expect(portalReadIsStale(null, now)).toBe(true);
    expect(portalReadIsStale("2026-12-04T11:00:00Z", now)).toBe(true);
    expect(portalReadIsStale("2026-12-04T13:00:00Z", now)).toBe(false);
  });
});
