import { describe, expect, test } from "vitest";

import { nfseIssuerTemplateRulesSchema } from "@/lib/nfse/template";
import { testNfseXml } from "@/lib/nfse/testing/nfse-xml";

import { readIssuedNoteFacts } from "./from-xml";
import { freeDpsSeries, nextDpsSeriesAfter, suggestFromIssuedNotes, templateDescription } from "./suggest";

const ACADEMIA = "33000167000101";

/** Uma nota da academia emitida em `processedAt`, para o tomador e o valor dados. */
function note(processedAt: string, overrides: { cpf?: string; name?: string; cents?: number; description?: string; series?: string } = {}) {
  const xml = testNfseXml({
    providerCnpj: ACADEMIA,
    series: overrides.series ?? "1",
    taker: { cnpj: overrides.cpf ?? "40503119091", name: overrides.name ?? "João da Silva", address: null },
    amountCents: overrides.cents ?? 15000,
    description: overrides.description ?? "MENSALIDADE REFERENTE A 09/2026",
  }).replace(/<dhProc>[^<]+<\/dhProc>/, `<dhProc>${processedAt}</dhProc>`);
  return readIssuedNoteFacts(xml)!;
}

describe("o que a nota emitida ensina", () => {
  test("modelo fiscal completo e válido, tomador com CPF, valor e descrição", () => {
    const facts = note("2026-10-15T11:02:31-03:00");
    expect(facts.issuedAt?.toISOString()).toBe("2026-10-15T14:02:31.000Z");
    expect(facts.series).toBe("1");
    expect(facts.taker).toEqual({ document: "40503119091", name: "João da Silva", address: null });
    expect(facts.amountCents).toBe(15000);
    expect(facts.template).toMatchObject({
      cityCode: "4308904",
      municipalRegistration: "12345",
      taxRegime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
      service: { nationalTaxCode: "171901", municipalTaxCode: "001", nbsCode: "113022100" },
      totalTaxes: { kind: "simples", percent: "6.00" },
      ibsCbs: { operationIndicator: "100301", cst: "200", classification: "200052" },
    });
    expect(nfseIssuerTemplateRulesSchema.safeParse(facts.template).success).toBe(true);
  });

  test("XML que não é NFS-e não vira sugestão", () => {
    expect(readIssuedNoteFacts("<x/>")).toBeNull();
    expect(readIssuedNoteFacts("não é xml")).toBeNull();
  });
});

describe("sugestões para o cadastro", () => {
  test("descrição com o mês vira {mes} com a referência certa", () => {
    expect(templateDescription("MENSALIDADE REFERENTE A 09/2026", { year: 2026, month: 10 })).toEqual({ description: "MENSALIDADE REFERENTE A {mes}", reference: "previous" });
    expect(templateDescription("ALUGUEL 10/2026", { year: 2026, month: 10 })).toEqual({ description: "ALUGUEL {mes}", reference: "current" });
    expect(templateDescription("SERVIÇO AVULSO", { year: 2026, month: 10 })).toEqual({ description: "SERVIÇO AVULSO", reference: "previous" });
  });

  test("série livre a partir de 900", () => {
    expect(freeDpsSeries(["1", "70000"])).toBe("900");
    expect(freeDpsSeries(["900", "901", null])).toBe("902");
  });

  test("notas do último mês viram notas padrão; as que já saíram no mês anterior vêm marcadas", () => {
    const suggestion = suggestFromIssuedNotes([
      note("2026-09-10T10:00:00-03:00", { description: "MENSALIDADE REFERENTE A 08/2026" }),
      note("2026-10-10T10:00:00-03:00"),
      note("2026-10-11T10:00:00-03:00", { cpf: "65029267034", name: "Maria Oliveira", cents: 9990, description: "AVALIAÇÃO FÍSICA" }),
      note("2026-10-12T10:00:00-03:00", { series: "900" }),
    ]);
    expect(suggestion.dpsSeries).toBe("901");
    expect(suggestion.basedOn).toMatchObject({ notes: 4, month: "2026-10" });
    expect(suggestion.models.map((model) => [model.takerName, model.amount, model.description, model.reference, model.recurring])).toEqual([
      ["João da Silva", "150.00", "MENSALIDADE REFERENTE A {mes}", "previous", true],
      ["Maria Oliveira", "99.90", "AVALIAÇÃO FÍSICA", "previous", false],
    ]);
  });

  test("o que já está cadastrado não volta como sugestão; sem notas, nada a sugerir", () => {
    const notes = [note("2026-10-10T10:00:00-03:00")];
    expect(suggestFromIssuedNotes(notes, { models: [{ takerDocument: "40503119091", description: "MENSALIDADE REFERENTE A {mes}" }] }).models).toEqual([]);
    expect(suggestFromIssuedNotes([])).toMatchObject({ template: null, dpsSeries: "900", models: [] });
  });
});

describe("série seguinte depois de uma colisão", () => {
  test("pula as séries já usadas e para no fim da faixa", () => {
    expect(nextDpsSeriesAfter("900", [])).toBe("901");
    expect(nextDpsSeriesAfter("900", ["901", "0902", null])).toBe("903");
    expect(nextDpsSeriesAfter("49999", [])).toBeNull();
  });
});
