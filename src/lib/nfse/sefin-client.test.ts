import { describe, expect, test } from "vitest";

import {
  createSefinClient,
  NFSE_ENDPOINTS,
  NfseTransientError,
  type HttpRequest,
  type HttpResponse,
} from "./sefin-client";
import { gunzipBase64, gzipBase64 } from "./xml";

const KEY = "4".repeat(50);

function fake(responses: HttpResponse[]) {
  const calls: HttpRequest[] = [];
  const transport = async (req: HttpRequest) => {
    calls.push(req);
    const next = responses.shift();
    if (!next) throw new Error("sem resposta preparada");
    return next;
  };
  return { calls, client: createSefinClient("restrita", transport) };
}

function json(status: number, body: unknown): HttpResponse {
  return { status, body: Buffer.from(JSON.stringify(body)), contentType: "application/json" };
}

describe("cliente do Sistema Nacional", () => {
  test("emite: manda a DPS compactada e lê chave e número", async () => {
    const nfse = gzipBase64("<NFSe><infNFSe><nNFSe>123</nNFSe></infNFSe></NFSe>");
    const { calls, client } = fake([json(201, { chaveAcesso: KEY, nfseXmlGZipB64: nfse })]);
    await expect(client.emit("<DPS/>")).resolves.toEqual({ kind: "issued", accessKey: KEY, nfseNumber: "123" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${NFSE_ENDPOINTS.restrita.sefin}/nfse`);
    expect(gunzipBase64((calls[0].json as { dpsXmlGZipB64: string }).dpsXmlGZipB64)).toBe("<DPS/>");
  });

  test("recusa de regra de negócio vira lista de erros", async () => {
    const { client } = fake([json(400, { erros: [{ Codigo: "E0014", Descricao: "DPS já existe", Complemento: null }] })]);
    await expect(client.emit("<DPS/>")).resolves.toEqual({
      kind: "rejected",
      errors: [{ code: "E0014", message: "DPS já existe" }],
    });
  });

  test("falha de infraestrutura é transitória", async () => {
    const { client } = fake([json(503, {})]);
    await expect(client.emit("<DPS/>")).rejects.toBeInstanceOf(NfseTransientError);
  });

  test("consulta a DPS: 404 é nenhuma nota", async () => {
    const { client } = fake([json(404, {}), json(200, { chaveAcesso: KEY })]);
    await expect(client.findAccessKeyByDps("DPS1")).resolves.toBeNull();
    await expect(client.findAccessKeyByDps("DPS1")).resolves.toBe(KEY);
  });

  test("cancela pelo evento compactado", async () => {
    const { calls, client } = fake([json(201, {}), json(400, { erros: [{ codigo: "E1235", descricao: "Fora do prazo" }] })]);
    await expect(client.cancel(KEY, "<pedRegEvento/>")).resolves.toEqual({ kind: "cancelled" });
    expect(calls[0].url).toBe(`${NFSE_ENDPOINTS.restrita.sefin}/nfse/${KEY}/eventos`);
    expect(Object.keys(calls[0].json as object)).toEqual(["pedidoRegistroEventoXmlGZipB64"]);
    await expect(client.cancel(KEY, "<pedRegEvento/>")).resolves.toEqual({
      kind: "rejected",
      errors: [{ code: "E1235", message: "Fora do prazo" }],
    });
  });

  test("DANFSe só vale se vier PDF", async () => {
    const pdf = Buffer.from("%PDF-1.7");
    const { calls, client } = fake([
      { status: 200, body: pdf, contentType: "application/pdf" },
      json(404, {}),
    ]);
    await expect(client.getDanfse(KEY)).resolves.toEqual(pdf);
    expect(calls[0].url).toBe(`${NFSE_ENDPOINTS.restrita.adn}/danfse/${KEY}`);
    await expect(client.getDanfse(KEY)).rejects.toThrow(/DANFSe/);
  });
});
