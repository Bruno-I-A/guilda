import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";

import { buildDanfseZip, parseDanfseRequest, tokenMatches } from "./danfse-zip";

const KEY_A = "1".repeat(50);
const KEY_B = "2".repeat(50);

describe("pedido de PDFs", () => {
  test("aceita lista de chaves válidas com nomes seguros", () => {
    expect(parseDanfseRequest({ items: [{ accessKey: KEY_A, fileName: "000001-padaria.pdf" }] })).toEqual([
      { accessKey: KEY_A, fileName: "000001-padaria.pdf" },
    ]);
  });
  test("recusa chave fora do formato, nome com caminho e lista vazia", () => {
    expect(parseDanfseRequest({ items: [{ accessKey: "123", fileName: "a.pdf" }] })).toBeNull();
    expect(parseDanfseRequest({ items: [{ accessKey: KEY_A, fileName: "../a.pdf" }] })).toBeNull();
    expect(parseDanfseRequest({ items: [] })).toBeNull();
  });
});

describe("zip", () => {
  test("junta os PDFs e lista as falhas num LEIA-ME", async () => {
    const { zip, failures } = await buildDanfseZip(
      [
        { accessKey: KEY_A, fileName: "a.pdf" },
        { accessKey: KEY_B, fileName: "b.pdf" },
      ],
      async (key) => {
        if (key === KEY_B) throw new Error("DANFSe indisponível");
        return Buffer.from("%PDF-A");
      },
    );
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["LEIA-ME.txt", "a.pdf"]);
    expect(strFromU8(files["a.pdf"])).toBe("%PDF-A");
    expect(strFromU8(files["LEIA-ME.txt"])).toContain("b.pdf: DANFSe indisponível");
    expect(failures).toHaveLength(1);
  });
});

describe("token interno", () => {
  const token = "x".repeat(40);
  test("confere só o Bearer exato", () => {
    expect(tokenMatches(token, `Bearer ${token}`)).toBe(true);
    expect(tokenMatches(token, `Bearer ${token}y`)).toBe(false);
    expect(tokenMatches(token, undefined)).toBe(false);
  });
  test("token curto nunca confere", () => {
    expect(tokenMatches("curto", "Bearer curto")).toBe(false);
  });
});
