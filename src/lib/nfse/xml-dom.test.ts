import { afterEach, describe, expect, test, vi } from "vitest";

import { parseXmlRoot, read } from "./xml-dom";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("leitura do XML", () => {
  test("XML malformado vira null sem escrever nada no console", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseXmlRoot("<NFSe><infNFSe><nNFSe>12</infNFSe>")).toBeNull();
    expect(parseXmlRoot("<NFSe><a>1</a></NFSe><b/>")).toBeNull();
    // Nível "error": sem o onError, o xmldom seguiria e devolveria a árvore.
    expect(parseXmlRoot("<NFSe><nNFSe>&foo;</nNFSe></NFSe>")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("XML válido com prefixo de namespace: read acha o texto", () => {
    const root = parseXmlRoot(
      '<ns:NFSe xmlns:ns="http://www.sped.fazenda.gov.br/nfse"><ns:infNFSe><ns:nNFSe> 123 </ns:nNFSe></ns:infNFSe></ns:NFSe>',
    );
    expect(read(root, "infNFSe/nNFSe")).toBe("123");
  });
});
