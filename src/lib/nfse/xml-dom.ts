import { DOMParser, type Element } from "@xmldom/xmldom";

/** Primeiro filho com esse nome local (ignora o prefixo de namespace). */
export function child(parent: Element | null, name: string): Element | null {
  for (let node = parent?.firstChild ?? null; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).localName === name) return node as Element;
  }
  return null;
}

/** Caminho de filhos separados por "/": "DPS/infDPS/prest". */
export function at(root: Element | null, path: string): Element | null {
  return path.split("/").reduce<Element | null>((element, name) => child(element, name), root);
}

/** Texto do elemento no caminho, com espaços normalizados; vazio vira null. */
export function read(root: Element | null, path: string): string | null {
  const text = at(root, path)?.textContent?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Elemento raiz; XML inválido vira null (o xmldom lança ParseError em XML malformado). */
export function parseXmlRoot(xml: string): Element | null {
  try {
    return new DOMParser().parseFromString(xml, "text/xml").documentElement as Element | null;
  } catch {
    return null;
  }
}
