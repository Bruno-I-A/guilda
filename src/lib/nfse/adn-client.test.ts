import { describe, expect, test } from "vitest";

import { AdnRejectionError, fetchAdnBatch } from "./adn-client";
import type { HttpRequest, HttpResponse } from "./sefin-client";
import { NfseTransientError } from "./sefin-client";
import { testAdnBatchBody } from "./testing/adn";
import { gzipBase64 } from "./xml";

function fake(responses: HttpResponse[]) {
  const calls: HttpRequest[] = [];
  return {
    calls,
    transport: async (req: HttpRequest) => {
      calls.push(req);
      const next = responses.shift();
      if (!next) throw new Error("sem resposta preparada");
      return next;
    },
  };
}

const json = (status: number, body: string): HttpResponse => ({ status, body: Buffer.from(body), contentType: "application/json" });

const CNPJ = "33000167000101";

describe("distribuição do ADN para contribuintes", () => {
  test("pede o lote a partir do NSU, com o CNPJ consultado, e descompacta os XML", async () => {
    const { calls, transport } = fake([json(200, testAdnBatchBody([{ nsu: 5, xml: "<NFSe/>" }, { nsu: 6, xml: "<evento/>" }]))]);
    const batch = await fetchAdnBatch(transport, "producao", { fromNsu: 5, cnpj: CNPJ });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: "https://adn.nfse.gov.br/contribuintes/DFe/5?lote=true&cnpjConsulta=33000167000101",
    });
    expect(batch).toEqual({ documents: [{ nsu: 5, xml: "<NFSe/>" }, { nsu: 6, xml: "<evento/>" }], done: false });
  });

  test("a homologação usa o endereço da produção restrita", async () => {
    const { calls, transport } = fake([json(200, testAdnBatchBody([]))]);
    await fetchAdnBatch(transport, "restrita", { fromNsu: 0, cnpj: CNPJ });
    expect(calls[0].url).toBe(
      "https://adn.producaorestrita.nfse.gov.br/contribuintes/DFe/0?lote=true&cnpjConsulta=33000167000101",
    );
  });

  test("nenhum documento encerra a leitura", async () => {
    const { transport } = fake([json(200, testAdnBatchBody([])), json(404, testAdnBatchBody([]))]);
    expect(await fetchAdnBatch(transport, "producao", { fromNsu: 9, cnpj: CNPJ })).toEqual({ documents: [], done: true });
    expect(await fetchAdnBatch(transport, "producao", { fromNsu: 9, cnpj: CNPJ })).toEqual({ documents: [], done: true });
  });

  test("200 com contrato desconhecido nao marca leitura completa", async () => {
    const { transport } = fake([json(200, "{}"), json(200, JSON.stringify({ StatusProcessamento: "OK", LoteDFe: null }))]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(AdnRejectionError);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(AdnRejectionError);
  });

  test("instabilidade é transitória; recusa vem com o motivo", async () => {
    const { transport } = fake([
      json(503, ""),
      json(403, "{}"),
      json(400, JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E2230", Descricao: "CNPJ sem relação" }] })),
    ]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(NfseTransientError);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(/certificado/);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(AdnRejectionError);
  });

  test("a recusa traz código e descrição do Sistema Nacional", async () => {
    const body = JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E2230", Descricao: "CNPJ sem relação" }] });
    const { transport } = fake([json(400, body)]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow("E2230 — CNPJ sem relação");
  });

  test("429, 408 e status 0 também são transitórios", async () => {
    const { transport } = fake([json(429, ""), json(408, ""), { status: 0, body: Buffer.alloc(0), contentType: null }]);
    for (let i = 0; i < 3; i += 1) {
      await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(NfseTransientError);
    }
  });

  test("falha de rede do transporte chega como veio, sem ser engolida", async () => {
    const transport = async () => {
      throw new NfseTransientError("Tempo esgotado falando com o Sistema Nacional.");
    };
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(/Tempo esgotado/);
  });

  test("os nomes dos campos valem em qualquer combinação de maiúsculas e minúsculas", async () => {
    const body = JSON.stringify({
      statusprocessamento: "DOCUMENTOS_LOCALIZADOS",
      lotedfe: [{ nsu: 3, arquivoXml: gzipBase64("<NFSe/>") }, { NSU: "4", ARQUIVOXML: gzipBase64("<evento/>") }],
    });
    const { transport } = fake([json(200, body)]);
    expect(await fetchAdnBatch(transport, "producao", { fromNsu: 3, cnpj: CNPJ })).toEqual({
      documents: [{ nsu: 3, xml: "<NFSe/>" }, { nsu: 4, xml: "<evento/>" }],
      done: false,
    });
  });

  test("a recusa em minúsculas também é reconhecida", async () => {
    const body = JSON.stringify({ statusprocessamento: "REJEICAO", erros: [{ codigo: "E1", descricao: "Motivo qualquer" }] });
    const { transport } = fake([json(200, body)]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow("E1 — Motivo qualquer");
  });

  test("documento que não descompacta derruba o lote inteiro, sem pular nota", async () => {
    const body = JSON.stringify({
      StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
      LoteDFe: [
        { NSU: 7, ArquivoXml: gzipBase64("<NFSe/>") },
        { NSU: 8, ArquivoXml: "isso-nao-e-gzip-nem-base64" },
        { NSU: 9, ArquivoXml: gzipBase64("<evento/>") },
      ],
    });
    const { transport } = fake([json(200, body), json(200, body)]);
    const attempt = fetchAdnBatch(transport, "producao", { fromNsu: 7, cnpj: CNPJ });
    await expect(attempt).rejects.toThrow(AdnRejectionError);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 7, cnpj: CNPJ })).rejects.toThrow(/NSU 8/);
  });

  test("item sem NSU válido ou sem XML derruba o lote, sem pular nota", async () => {
    const xml = gzipBase64("<NFSe/>");
    const bad: unknown[] = [
      { ArquivoXml: xml },
      { NSU: null, ArquivoXml: xml },
      { NSU: "", ArquivoXml: xml },
      { NSU: "abc", ArquivoXml: xml },
      { NSU: 1.5, ArquivoXml: xml },
      { NSU: -2, ArquivoXml: xml },
      { NSU: 3 },
      { NSU: 3, ArquivoXml: null },
      { NSU: 3, ArquivoXml: 42 },
      "texto solto",
      null,
    ];
    const { transport } = fake(
      bad.map((item) => json(200, JSON.stringify({ StatusProcessamento: "DOCUMENTOS_LOCALIZADOS", LoteDFe: [{ NSU: 1, ArquivoXml: xml }, item] }))),
    );
    for (let i = 0; i < bad.length; i += 1) {
      await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(/sem NSU ou sem XML/);
    }
  });

  test("lote que não é lista não é lido como vazio", async () => {
    const { transport } = fake([json(200, JSON.stringify({ StatusProcessamento: "DOCUMENTOS_LOCALIZADOS", LoteDFe: "estranho" }))]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(AdnRejectionError);
  });

  test("a mensagem da recusa não carrega o corpo cru da resposta", async () => {
    const raw = {
      StatusProcessamento: "REJEICAO",
      Detalhe: "SEGREDO-DO-CORPO",
      Erros: [{ Codigo: "E9", Descricao: "Motivo curto", Xml: "<NFSe>SEGREDO-NO-XML</NFSe>" }],
    };
    const { transport } = fake([json(400, JSON.stringify(raw)), json(422, "<html>SEGREDO-DO-CORPO</html>"), json(401, "SEGREDO-DO-CORPO")]);
    for (let i = 0; i < 3; i += 1) {
      const error = await fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AdnRejectionError);
      const message = (error as Error).message;
      expect(message).not.toContain("SEGREDO");
      expect(message).not.toContain("<");
      expect(message).not.toContain("{");
    }
  });

  test("recusa sem detalhe cita só o status HTTP", async () => {
    const { transport } = fake([json(422, "{}")]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow("(HTTP 422)");
  });

  test("descrições longas são cortadas, cada uma e o total", async () => {
    const long = "x".repeat(900);
    const one = JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E1", Descricao: long }] });
    const many = JSON.stringify({
      StatusProcessamento: "REJEICAO",
      Erros: Array.from({ length: 10 }, (_, index) => ({ Codigo: `E${index}`, Descricao: "y".repeat(190) })),
    });
    const { transport } = fake([json(400, one), json(400, many)]);
    const first = await fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ }).catch((caught: unknown) => caught);
    expect((first as Error).message.length).toBeLessThanOrEqual(260);
    const second = await fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ }).catch((caught: unknown) => caught);
    expect((second as Error).message.length).toBeLessThanOrEqual(500);
  });

  test("404 que não é JSON (endereço errado, proxy) é recusa, não fim da leitura", async () => {
    const { transport } = fake([json(404, "<html>Not Found</html>")]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(AdnRejectionError);
  });

  test("404 com rejeição declarada não é fim da leitura", async () => {
    const { transport } = fake([json(404, JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E7", Descricao: "Empresa desconhecida" }] }))]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow("E7 — Empresa desconhecida");
  });

  test("200 que não é JSON é instabilidade, não fim da leitura", async () => {
    const { transport } = fake([json(200, "<html>manutenção</html>")]);
    await expect(fetchAdnBatch(transport, "producao", { fromNsu: 1, cnpj: CNPJ })).rejects.toThrow(NfseTransientError);
  });

  test("NSU e CNPJ inválidos falham antes de chamar o transporte", async () => {
    const { calls, transport } = fake([]);
    const invalid: { fromNsu: number; cnpj: string }[] = [
      { fromNsu: -1, cnpj: CNPJ },
      { fromNsu: 1.5, cnpj: CNPJ },
      { fromNsu: Number.NaN, cnpj: CNPJ },
      { fromNsu: Number.POSITIVE_INFINITY, cnpj: CNPJ },
      { fromNsu: Number.MAX_SAFE_INTEGER + 1, cnpj: CNPJ },
      { fromNsu: 1, cnpj: "" },
      { fromNsu: 1, cnpj: "3300016700010" },
      { fromNsu: 1, cnpj: "330001670001011" },
      { fromNsu: 1, cnpj: "33.000.167/0001-01" },
      { fromNsu: 1, cnpj: "3300016700010a" },
      { fromNsu: 1, cnpj: "33000167000101&lote=false" },
    ];
    for (const input of invalid) {
      await expect(fetchAdnBatch(transport, "producao", input)).rejects.toThrow(/NSU|CNPJ/);
    }
    expect(calls).toHaveLength(0);
  });
});
