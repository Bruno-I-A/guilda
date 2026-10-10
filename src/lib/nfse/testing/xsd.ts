import { readFileSync } from "node:fs";
import path from "node:path";
import { validateXML } from "xmllint-wasm";

const XSD_DIR = path.resolve(process.cwd(), "src/lib/nfse/xsd/1.01");
const SHARED = [
  "tiposComplexos_v1.01.xsd",
  "tiposSimples_v1.01.xsd",
  "tiposEventos_v1.01.xsd",
  "xmldsig-core-schema.xsd",
];

/**
 * Os arquivos oficiais trazem BOM e o xmldsig traz um DOCTYPE com DTD
 * externa; o validador em WebAssembly não busca nada na rede. Nenhum dos
 * dois usa entidades, então retirar o DOCTYPE não muda o esquema.
 *
 * O padrão da série da DPS vem escrito como "^0{0,4}\d{1,5}$". Em expressão
 * regular de XSD o padrão já é ancorado e ^/$ são caracteres literais; o
 * libxml2 segue a especificação e recusaria toda série. Tiramos as âncoras
 * ao carregar, sem mexer no arquivo oficial.
 */
function readXsd(fileName: string): string {
  return readFileSync(path.join(XSD_DIR, fileName), "utf8")
    .replace(/^﻿/, "")
    .replace(/<!DOCTYPE[\s\S]*?\]>/, "")
    .replace(/(<xs:pattern value=")\^([^"]*)\$(")/g, "$1$2$3");
}

export async function nfseXsdErrors(
  xml: string,
  rootXsd: "DPS_v1.01.xsd" | "pedRegEvento_v1.01.xsd",
): Promise<string[]> {
  const result = await validateXML({
    xml: [{ fileName: "documento.xml", contents: xml }],
    schema: [{ fileName: rootXsd, contents: readXsd(rootXsd) }],
    preload: SHARED.map((fileName) => ({ fileName, contents: readXsd(fileName) })),
  });
  return result.errors.map((error) => error.message);
}
