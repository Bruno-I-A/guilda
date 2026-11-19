import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";

import { XML_ROUTINE_DEFAULTS } from "@/domain/nfse-xml";

import { resetCursorForMode, saveProxyStatus } from "./credentials-repository";
import { createMtlsTransport, type HttpTransport, networkErrorMessage, NfseTransientError } from "./sefin-client";
import { testAdnBatchBody } from "./testing/adn";
import { createTestCertificate } from "./testing/certificate";
import { loadVaultKey, type VaultKey } from "./vault";
import { sealCertificate } from "./vault-browser";
import { runXmlRoutineCycle, serviceVaultTick } from "./xml-cycle";
import {
  listPendingCertificates,
  listRoutineClients,
  loadXmlRoutineState,
  markXmlRoutineRun,
  publishVaultKey,
  saveAdnError,
  saveAdnProgress,
  saveCertificateCheck,
} from "./xml-repository";
import { runXmlRoutine } from "./xml-routine";

vi.mock("server-only", () => ({}));
vi.mock("./xml-repository", () => ({
  publishVaultKey: vi.fn(),
  listPendingCertificates: vi.fn(),
  saveCertificateCheck: vi.fn(),
  loadXmlRoutineState: vi.fn(),
  markXmlRoutineRun: vi.fn(),
  listRoutineClients: vi.fn(),
  saveAdnProgress: vi.fn(),
  saveAdnError: vi.fn(),
}));
vi.mock("./credentials-repository", () => ({
  resetCursorForMode: vi.fn(),
  saveProxyStatus: vi.fn(),
}));
// Só o transporte é falso: nenhuma chamada de rede de verdade.
vi.mock("./sefin-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sefin-client")>()),
  createMtlsTransport: vi.fn(),
}));
// A rodada real, espionada para ver o keepSince que ela recebe.
vi.mock("./xml-routine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./xml-routine")>();
  return { ...actual, runXmlRoutine: vi.fn(actual.runXmlRoutine) };
});

const ORG = "org-1";
const PASSWORD = "senha-secreta-da-padaria";

function testVaultKey(): VaultKey {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return loadVaultKey(Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64"));
}

// Gerados uma vez: o RSA do node-forge é lento.
const vault = testVaultKey();
const otherVault = testVaultKey();
const cert = createTestCertificate({ commonName: "PADARIA LTDA:33000167000101", password: PASSWORD });

function seal(key: VaultKey = vault) {
  return sealCertificate({ publicKeySpki: key.publicKeySpki, keyId: key.keyId, pfx: Buffer.from(cert.pfxBase64, "base64"), password: PASSWORD });
}

/**
 * ADN falso: para cada CNPJ, o primeiro pedido devolve o documento seguinte
 * ao NSU do caminho (como o ADN de verdade) e o segundo, nenhum. Duas
 * leituras (dois lotes) por empresa.
 */
function fakeAdn() {
  const calls = new Map<string, number>();
  const transport: HttpTransport = async (req) => {
    const url = new URL(req.url);
    const afterNsu = Number(url.pathname.split("/").pop());
    const cnpj = url.searchParams.get("cnpjConsulta") ?? "";
    const count = (calls.get(cnpj) ?? 0) + 1;
    calls.set(cnpj, count);
    const body = testAdnBatchBody(count === 1 ? [{ nsu: afterNsu + 1, xml: "<outro/>" }] : []);
    return { status: 200, body: Buffer.from(body), contentType: "application/json" };
  };
  return transport;
}

let adn: HttpTransport = fakeAdn();
let consoleSpies: MockInstance[] = [];

/** Tudo o que foi escrito no console, para conferir que a senha não aparece. */
function consoleText(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls.flat())
    .map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ""}` : typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  adn = fakeAdn();
  consoleSpies = (["log", "error", "warn"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  vi.mocked(createMtlsTransport).mockImplementation(() => adn);
});

afterEach(() => {
  expect(consoleText()).not.toContain(PASSWORD);
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("cofre no ciclo do serviço fiscal", () => {
  test("publica a chave e grava a conferência de cada pendente com a wrappedKey do envio", async () => {
    const valid = await seal();
    const otherCnpj = await seal();
    vi.mocked(listPendingCertificates).mockResolvedValue([
      { id: "cert-1", clientCnpj: "33000167000282", envelope: valid },
      { id: "cert-2", clientCnpj: "11222333000181", envelope: otherCnpj },
    ]);

    await serviceVaultTick(ORG, vault);

    expect(publishVaultKey).toHaveBeenCalledWith(ORG, { keyId: vault.keyId, publicKeySpki: vault.publicKeySpki });
    expect(vi.mocked(saveCertificateCheck).mock.calls).toEqual([
      [
        ORG,
        {
          id: "cert-1",
          wrappedKey: valid.wrappedKey,
          result: { status: "valid", cnpj: "33000167000101", validUntil: new Date("2027-01-01T00:00:00Z") },
          now: expect.any(Date),
        },
      ],
      [
        ORG,
        {
          id: "cert-2",
          wrappedKey: otherCnpj.wrappedKey,
          result: { status: "invalid", message: expect.stringContaining("outro CNPJ") },
          now: expect.any(Date),
        },
      ],
    ]);
    expect(consoleSpies[0].mock.calls).toEqual([["Certificado cert-1: valid."], ["Certificado cert-2: invalid."]]);
  });
});

describe("rodada da rotina de XML no serviço fiscal", () => {
  beforeEach(() => {
    vi.mocked(loadXmlRoutineState).mockResolvedValue({
      schedule: XML_ROUTINE_DEFAULTS,
      keepSince: "2026-09-01",
      runRequestedAt: null,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
    });
  });

  test("marca início e fim, abre o certificado uma vez por empresa e guarda a partir do dia de Brasília", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "certificate", readMode: null, envelope: await seal() },
      { clientId: "b", cnpj: "33000167000282", lastNsu: 10, historyFromNsu: null, mode: "certificate", readMode: null, envelope: await seal() },
    ]);

    await runXmlRoutineCycle(ORG, vault, "producao");

    const marks = vi.mocked(markXmlRoutineRun).mock.calls.map(([, mark]) => Object.keys(mark));
    expect(marks).toEqual([["startedAt"], ["finishedAt"]]);
    // Dois lotes por empresa, um transporte (um certificado aberto) por empresa.
    expect(createMtlsTransport).toHaveBeenCalledTimes(2);
    expect(createMtlsTransport).toHaveBeenCalledWith(expect.objectContaining({ privateKeyPem: cert.privateKeyPem }));
    expect(vi.mocked(runXmlRoutine).mock.calls[0][1].keepSince).toEqual(new Date("2026-09-01T03:00:00Z"));
    expect(vi.mocked(saveAdnProgress).mock.calls.map(([, p]) => [p.clientId, p.lastNsu, p.finished])).toEqual([
      ["a", 1, false],
      ["a", 1, true],
      ["b", 11, false],
      ["b", 11, true],
    ]);
    expect(saveAdnError).not.toHaveBeenCalled();
    expect(consoleSpies[0].mock.calls).toEqual([["Rotina de XML: 2 empresa(s), 0 com erro."]]);
  });

  test("sem 'guardar a partir de', a rodada guarda tudo", async () => {
    vi.mocked(loadXmlRoutineState).mockResolvedValue({
      schedule: XML_ROUTINE_DEFAULTS,
      keepSince: null,
      runRequestedAt: null,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
    });
    vi.mocked(listRoutineClients).mockResolvedValue([]);

    await runXmlRoutineCycle(ORG, vault, "producao");

    expect(vi.mocked(runXmlRoutine).mock.calls[0][1].keepSince).toBeNull();
    expect(consoleSpies[0].mock.calls).toEqual([["Rotina de XML: 0 empresa(s), 0 com erro."]]);
  });

  test("envelope de outra chave fica como erro da empresa e não para a outra", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "certificate", readMode: null, envelope: await seal(otherVault) },
      { clientId: "b", cnpj: "33000167000282", lastNsu: 10, historyFromNsu: null, mode: "certificate", readMode: null, envelope: await seal() },
    ]);

    await runXmlRoutineCycle(ORG, vault, "producao");

    expect(saveAdnError).toHaveBeenCalledTimes(1);
    expect(saveAdnError).toHaveBeenCalledWith(ORG, "a", expect.stringContaining("outra chave"), expect.any(Date));
    expect(vi.mocked(saveAdnError).mock.calls[0][2]).not.toContain(PASSWORD);
    expect(createMtlsTransport).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveAdnProgress).mock.calls.map(([, p]) => p.clientId)).toEqual(["b", "b"]);
    expect(vi.mocked(markXmlRoutineRun).mock.calls.map(([, mark]) => Object.keys(mark))).toEqual([["startedAt"], ["finishedAt"]]);
    expect(consoleSpies[0].mock.calls).toEqual([["Rotina de XML: 2 empresa(s), 1 com erro."]]);
  });

  test("rodada que quebra antes do fim não marca o fim (isXmlRoutineDue a trata como interrompida)", async () => {
    vi.mocked(listRoutineClients).mockRejectedValue(new Error("banco caiu"));

    await expect(runXmlRoutineCycle(ORG, vault, "producao")).rejects.toThrow("banco caiu");

    expect(vi.mocked(markXmlRoutineRun).mock.calls.map(([, mark]) => Object.keys(mark))).toEqual([["startedAt"]]);
  });

  test("conexão derrubada no meio da leitura é tentada de novo e a empresa termina sem erro", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "certificate", readMode: null, envelope: await seal() },
    ]);
    const real = fakeAdn();
    let dropped = false;
    adn = async (req) => {
      if (!dropped) {
        dropped = true;
        throw new NfseTransientError(networkErrorMessage(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })));
      }
      return real(req);
    };

    await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0] });

    expect(saveAdnError).not.toHaveBeenCalled();
    expect(vi.mocked(saveAdnProgress).mock.calls.map(([, p]) => [p.clientId, p.lastNsu, p.finished])).toEqual([
      ["a", 1, false],
      ["a", 1, true],
    ]);
  });

  test("queda que se repete vira erro em português e avisa que a próxima leitura continua", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "certificate", readMode: null, envelope: await seal() },
    ]);
    let attempts = 0;
    adn = async () => {
      attempts += 1;
      throw new NfseTransientError(networkErrorMessage(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })));
    };

    await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0] });

    expect(attempts).toBe(3);
    expect(saveAdnError).toHaveBeenCalledWith(
      ORG,
      "a",
      "O Sistema Nacional fechou a conexão no meio do pedido (ECONNRESET). A próxima leitura continua de onde parou.",
      expect.any(Date),
    );
  });

  test("empresa por procuração lê com o A1 do escritório, sem abrir certificado, e recomeça do zero na troca", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 50, historyFromNsu: null, mode: "proxy", readMode: null, envelope: null },
    ]);
    const urls: string[] = [];
    const real = fakeAdn();
    const office: HttpTransport = async (req) => {
      urls.push(req.url);
      return real(req);
    };

    await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office });

    expect(createMtlsTransport).not.toHaveBeenCalled();
    expect(resetCursorForMode).toHaveBeenCalledWith(ORG, "a", "proxy", expect.any(Date));
    // Zerado: pede depois do NSU 0, não do 50, com o CNPJ da empresa.
    expect(urls[0]).toBe("https://adn.nfse.gov.br/contribuintes/DFe/0?lote=true&cnpjConsulta=33000167000101");
    expect(saveAdnError).not.toHaveBeenCalled();
  });

  test("cursor já construído com a mesma credencial continua de onde parou", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 50, historyFromNsu: null, mode: "proxy", readMode: "proxy", envelope: null },
    ]);
    const urls: string[] = [];
    const real = fakeAdn();
    await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office: async (req) => (urls.push(req.url), real(req)) });
    expect(resetCursorForMode).not.toHaveBeenCalled();
    expect(urls[0]).toContain("/DFe/50?");
  });

  test("procuração recusada (E2245) vira selo e erro da empresa", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "proxy", readMode: "proxy", envelope: null },
    ]);
    const office: HttpTransport = async () => ({
      status: 400,
      body: Buffer.from(JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E2245", Descricao: "Não há procuração da inscrição X para a Y" }] })),
      contentType: "application/json",
    });

    await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office });

    expect(saveProxyStatus).toHaveBeenCalledWith(ORG, "a", expect.objectContaining({ status: "invalid", code: "E2245" }));
    expect(saveAdnError).toHaveBeenCalledWith(ORG, "a", expect.stringContaining("Procuração recusada"), expect.any(Date));
  });

  test("por procuração, lote em formato estranho é erro da empresa, não procuração recusada", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "proxy", readMode: "proxy", envelope: null },
    ]);
    const office: HttpTransport = async () => ({ status: 200, body: Buffer.from("{}"), contentType: "application/json" });

    await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office });

    expect(saveProxyStatus).not.toHaveBeenCalled();
    expect(saveAdnError).toHaveBeenCalledWith(ORG, "a", expect.stringContaining("formato inesperado"), expect.any(Date));
  });

  test("por procuração sem o A1 do escritório, a empresa fica com erro claro", async () => {
    vi.mocked(listRoutineClients).mockResolvedValue([
      { clientId: "a", cnpj: "33000167000101", lastNsu: 0, historyFromNsu: null, mode: "proxy", readMode: "proxy", envelope: null },
    ]);

    await runXmlRoutineCycle(ORG, vault, "producao", { retryDelaysMs: [0, 0], office: null });

    expect(saveAdnError).toHaveBeenCalledWith(ORG, "a", expect.stringContaining("A1 do escritório"), expect.any(Date));
  });
});
