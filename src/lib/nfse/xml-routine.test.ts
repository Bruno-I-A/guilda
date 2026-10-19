import { describe, expect, test, vi } from "vitest";

import type { AdnBatch } from "./adn-client";
import { testEventXml } from "./testing/adn";
import { TEST_ACCESS_KEY, testNfseXml } from "./testing/nfse-xml";
import { type ClientProgress, runXmlRoutine, type XmlRoutineClient, type XmlRoutineDeps } from "./xml-routine";

const PRESTADOR = "11222333000181";

function deps(batches: Record<string, AdnBatch[]>, overrides: { keepSince?: Date | null } = {}) {
  const saved: ClientProgress[] = [];
  const errors: { clientId: string; message: string }[] = [];
  return {
    saved,
    errors,
    deps: {
      keepSince: overrides.keepSince ?? null,
      fetchBatch: vi.fn<XmlRoutineDeps["fetchBatch"]>(async (client) => {
        const next = batches[client.clientId]?.shift();
        if (!next) throw new Error("Sistema Nacional não respondeu.");
        return next;
      }),
      saveProgress: async (progress: ClientProgress) => {
        saved.push(progress);
      },
      saveError: async (clientId: string, message: string) => {
        errors.push({ clientId, message });
      },
    },
  };
}

describe("rodada da rotina de XML", () => {
  test("guarda as prestadas e os cancelamentos, lote a lote, e encerra no lote vazio", async () => {
    const { saved, deps: d } = deps({
      a: [
        {
          documents: [
            { nsu: 1, xml: testNfseXml() },
            { nsu: 2, xml: "<outro/>" },
          ],
          done: false,
        },
        { documents: [{ nsu: 3, xml: testEventXml(TEST_ACCESS_KEY) }], done: false },
        { documents: [], done: true },
      ],
    });
    const results = await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], d);
    expect(results).toEqual([{ clientId: "a", ok: true }]);
    expect(d.fetchBatch.mock.calls.map((call) => call[1])).toEqual([1, 3, 4]);
    expect(saved.map((p) => [p.issued.length, p.cancellations.length, p.lastNsu, p.finished])).toEqual([
      [1, 0, 2, false],
      [0, 1, 3, false],
      [0, 0, 3, true],
    ]);
    expect(saved[0].issued[0]).toMatchObject({ accessKey: TEST_ACCESS_KEY, nsu: 1, nfseNumber: "107" });
    expect(saved[1].cancellations[0]).toMatchObject({ accessKey: TEST_ACCESS_KEY, nsu: 3 });
  });

  test("a nota guardada leva só os campos do cadastro, sem o 'kind' da leitura", async () => {
    const { saved, deps: d } = deps({
      a: [{ documents: [{ nsu: 1, xml: testNfseXml() }], done: false }, { documents: [], done: true }],
    });
    await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], d);
    expect(Object.keys(saved[0].issued[0]).sort()).toEqual([
      "accessKey",
      "competence",
      "issuedAt",
      "nfseNumber",
      "nsu",
      "xml",
    ]);
  });

  test("'guardar a partir de' deixa de fora a nota anterior, mas avança o NSU", async () => {
    const { saved, deps: d } = deps(
      { a: [{ documents: [{ nsu: 1, xml: testNfseXml() }], done: false }, { documents: [], done: true }] },
      { keepSince: new Date("2026-11-01T00:00:00-03:00") },
    );
    await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], d);
    expect(saved[0]).toMatchObject({ issued: [], lastNsu: 1 });
  });

  test("uma empresa que falha não para as outras", async () => {
    const { errors, deps: d } = deps({ b: [{ documents: [], done: true }] });
    const results = await runXmlRoutine(
      [
        { clientId: "a", cnpj: PRESTADOR, lastNsu: 0 },
        { clientId: "b", cnpj: PRESTADOR, lastNsu: 7 },
      ],
      d,
    );
    expect(results).toEqual([
      { clientId: "a", ok: false, message: "Sistema Nacional não respondeu." },
      { clientId: "b", ok: true },
    ]);
    expect(errors).toEqual([{ clientId: "a", message: "Sistema Nacional não respondeu." }]);
  });

  test("lote que não avança o NSU é erro, não laço infinito", async () => {
    const { errors, deps: d } = deps({ a: [{ documents: [{ nsu: 5, xml: "<x/>" }], done: false }] });
    await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 5 }], d);
    expect(errors[0].message).toMatch(/NSU/);
  });

  test("lote sem documentos mas sem 'done' é tratado como fim, não como erro", async () => {
    const { saved, errors, deps: d } = deps({ a: [{ documents: [], done: false }] });
    const results = await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 3 }], d);
    expect(results).toEqual([{ clientId: "a", ok: true }]);
    expect(errors).toEqual([]);
    expect(saved).toEqual([{ clientId: "a", issued: [], cancellations: [], lastNsu: 3, finished: true }]);
  });

  test("teto de lotes: para na rodada, grava cada lote sem 'finished' e deixa o resto para a próxima", async () => {
    const { saved, errors, deps: d } = deps({});
    // Empresa que sempre tem documentos novos.
    const endless = {
      ...d,
      maxBatchesPerClient: 2,
      fetchBatch: vi.fn(async (_client: XmlRoutineClient, fromNsu: number): Promise<AdnBatch> => ({
        documents: [{ nsu: fromNsu, xml: "<outro/>" }],
        done: false,
      })),
    };
    const results = await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], endless);
    expect(results).toEqual([{ clientId: "a", ok: true }]);
    expect(endless.fetchBatch).toHaveBeenCalledTimes(2);
    expect(saved.map((p) => [p.lastNsu, p.finished])).toEqual([
      [1, false],
      [2, false],
    ]);
    expect(errors).toEqual([]);
  });

  test("saveError que falha não derruba a rodada: segue para a próxima empresa e avisa no resultado", async () => {
    const { deps: d } = deps({ b: [{ documents: [], done: true }] });
    const results = await runXmlRoutine(
      [
        { clientId: "a", cnpj: PRESTADOR, lastNsu: 0 },
        { clientId: "b", cnpj: PRESTADOR, lastNsu: 0 },
      ],
      {
        ...d,
        saveError: async () => {
          throw new Error("banco caiu");
        },
      },
    );
    expect(results).toEqual([
      { clientId: "a", ok: false, message: "Sistema Nacional não respondeu. (e o erro não foi gravado)" },
      { clientId: "b", ok: true },
    ]);
  });

  test("a mensagem de erro gravada é cortada em 500 caracteres", async () => {
    const { errors, deps: d } = deps({});
    const results = await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], {
      ...d,
      fetchBatch: async () => {
        throw new Error(`Falha ${"x".repeat(2000)}`);
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toHaveLength(500);
    expect(errors[0].message.startsWith("Falha xxx")).toBe(true);
    expect(results[0].message).toBe(errors[0].message);
  });

  test("nota e cancelamento dela no mesmo lote vão juntos no mesmo progresso", async () => {
    const { saved, deps: d } = deps({
      a: [
        {
          documents: [
            { nsu: 1, xml: testNfseXml() },
            { nsu: 2, xml: testEventXml(TEST_ACCESS_KEY) },
          ],
          done: false,
        },
        { documents: [], done: true },
      ],
    });
    await runXmlRoutine([{ clientId: "a", cnpj: PRESTADOR, lastNsu: 0 }], d);
    expect(saved).toHaveLength(2);
    expect(saved[0].issued.map((n) => [n.accessKey, n.nsu])).toEqual([[TEST_ACCESS_KEY, 1]]);
    expect(saved[0].cancellations.map((c) => [c.accessKey, c.nsu])).toEqual([[TEST_ACCESS_KEY, 2]]);
    expect(saved[0].lastNsu).toBe(2);
  });
});
