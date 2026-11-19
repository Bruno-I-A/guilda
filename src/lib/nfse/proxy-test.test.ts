import { beforeEach, describe, expect, test, vi } from "vitest";

import { clearProxyTestRequests, listProxyTestTargets, saveProxyStatus, storedNsuByKey } from "./credentials-repository";
import { runProxyTests } from "./proxy-test";
import { type HttpTransport, NfseTransientError } from "./sefin-client";
import { testAdnBatchBody } from "./testing/adn";
import { TEST_ACCESS_KEY, testNfseXml } from "./testing/nfse-xml";

vi.mock("server-only", () => ({}));
vi.mock("./credentials-repository", () => ({
  listProxyTestTargets: vi.fn(),
  saveProxyStatus: vi.fn(),
  clearProxyTestRequests: vi.fn(),
  storedNsuByKey: vi.fn(),
}));

const ORG = "org-1";
// O prestador das notas de teste.
const PRESTADOR = "11222333000181";
const json = (status: number, body: string) => ({ status, body: Buffer.from(body), contentType: "application/json" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(storedNsuByKey).mockResolvedValue(new Map());
});

describe("teste de procuração no serviço fiscal", () => {
  test("sem pedido, não chama o Sistema Nacional nem limpa nada", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([]);
    const office = vi.fn<HttpTransport>();
    expect(await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] })).toBe(0);
    expect(office).not.toHaveBeenCalled();
    expect(clearProxyTestRequests).not.toHaveBeenCalled();
  });

  test("confirma lendo a partir da nota mais antiga guardada e mede a sequência", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([{ clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: 41 }]);
    vi.mocked(storedNsuByKey).mockResolvedValue(new Map([[TEST_ACCESS_KEY, 41]]));
    const urls: string[] = [];
    const office: HttpTransport = async (req) => {
      urls.push(req.url);
      return json(200, testAdnBatchBody([{ nsu: 41, xml: testNfseXml() }]));
    };

    expect(await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] })).toBe(1);

    expect(urls).toEqual([`https://adn.nfse.gov.br/contribuintes/DFe/40?lote=true&cnpjConsulta=${PRESTADOR}`]);
    expect(storedNsuByKey).toHaveBeenCalledWith(ORG, "a", [TEST_ACCESS_KEY]);
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "confirmed", sameSequence: true }));
    expect(clearProxyTestRequests).toHaveBeenCalledWith(ORG, expect.any(Date));
  });

  test("a mesma nota com outro NSU fica medida como sequência diferente", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([{ clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: 41 }]);
    vi.mocked(storedNsuByKey).mockResolvedValue(new Map([[TEST_ACCESS_KEY, 41]]));
    const office: HttpTransport = async () => json(200, testAdnBatchBody([{ nsu: 9041, xml: testNfseXml() }]));
    await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] });
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "confirmed", sameSequence: false }));
  });

  test("sem nota guardada para comparar, confirma sem medir; nenhum documento também confirma", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([{ clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: null }]);
    const urls: string[] = [];
    const office: HttpTransport = async (req) => (urls.push(req.url), json(200, testAdnBatchBody([])));
    await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] });
    expect(urls[0]).toContain("/DFe/0?");
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "confirmed", sameSequence: null }));
  });

  test("E2245 e 403 são procuração recusada, com o código", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([
      { clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: null },
      { clientId: "b", cnpj: "33000167000101", oldestStoredNsu: null },
    ]);
    const responses = [
      json(400, JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E2245", Descricao: "Não há procuração" }] })),
      json(403, "{}"),
    ];
    await runProxyTests(ORG, async () => responses.shift()!, "producao", { retryDelaysMs: [0, 0] });
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "invalid", code: "E2245", message: "E2245 — Não há procuração" }));
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "b", expect.objectContaining({ status: "invalid", code: "403" }));
  });

  test("queda de rede e lote em formato estranho viram falha técnica, nunca recusa", async () => {
    vi.mocked(listProxyTestTargets).mockResolvedValue([
      { clientId: "a", cnpj: PRESTADOR, oldestStoredNsu: null },
      { clientId: "b", cnpj: "33000167000101", oldestStoredNsu: null },
    ]);
    const office: HttpTransport = async (req) => {
      if (req.url.includes(PRESTADOR)) throw new NfseTransientError("O Sistema Nacional fechou a conexão no meio do pedido (ECONNRESET).");
      return json(200, "{}");
    };
    await runProxyTests(ORG, office, "producao", { retryDelaysMs: [0, 0] });
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "technical_failure", sameSequence: null }));
    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "b", expect.objectContaining({ status: "technical_failure" }));
  });
});
