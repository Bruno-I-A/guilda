import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createFiscalHttpHandler } from "./fiscal-http";

const TOKEN = "t".repeat(40);
const KEY_A = "1".repeat(50);
const KEY_B = "2".repeat(50);

let server: Server | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function serve(buildPdf: ((accessKey: string) => Promise<Uint8Array>) | null): Promise<string> {
  server = createServer(createFiscalHttpHandler({ environment: "producao", token: TOKEN, buildPdf }));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function post(base: string, path: string, items: unknown[], token = TOKEN) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

const pdfOf = async (key: string) => {
  if (key === KEY_B) throw new Error("Consulta da nota falhou: HTTP 404.");
  return new TextEncoder().encode(`%PDF-${key.slice(0, 1)}`);
};

describe("porta HTTP do serviço fiscal", () => {
  test("uma nota: o PDF direto", async () => {
    const base = await serve(pdfOf);
    const res = await post(base, "/danfse.pdf", [{ accessKey: KEY_A, fileName: "000107-padaria.pdf" }]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1");
  });

  test("uma nota que não monta: 502 com o motivo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = await serve(pdfOf);
    const res = await post(base, "/danfse.pdf", [{ accessKey: KEY_B, fileName: "b.pdf" }]);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Consulta da nota falhou: HTTP 404.");
  });

  test("o PDF avulso recusa mais de uma nota", async () => {
    const base = await serve(pdfOf);
    const res = await post(base, "/danfse.pdf", [
      { accessKey: KEY_A, fileName: "a.pdf" },
      { accessKey: KEY_A, fileName: "c.pdf" },
    ]);
    expect(res.status).toBe(400);
  });

  test("várias notas: o .zip, com LEIA-ME das que falharem", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = await serve(pdfOf);
    const res = await post(base, "/danfse.zip", [
      { accessKey: KEY_A, fileName: "a.pdf" },
      { accessKey: KEY_B, fileName: "b.pdf" },
    ]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["LEIA-ME.txt", "a.pdf"]);
    expect(strFromU8(files["LEIA-ME.txt"])).toContain("b.pdf: Consulta da nota falhou");
  });

  test("sem o token certo, nada; sem certificado, 503", async () => {
    let base = await serve(pdfOf);
    expect((await post(base, "/danfse.pdf", [{ accessKey: KEY_A, fileName: "a.pdf" }], "x".repeat(40))).status).toBe(401);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/outra`, { method: "POST" })).status).toBe(404);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    base = await serve(null);
    expect((await post(base, "/danfse.zip", [{ accessKey: KEY_A, fileName: "a.pdf" }])).status).toBe(503);
  });
});
