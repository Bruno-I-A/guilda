import { gunzipSync, gzipSync } from "node:zlib";

export const NFSE_NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
export const NFSE_LAYOUT_VERSION = "1.01";
export const NFSE_APP_VERSION = "Guilda-1.0";
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Elemento simples; campo opcional ausente não gera nada. */
export function element(name: string, value: string | undefined | null): string {
  return value === undefined || value === null ? "" : `<${name}>${escapeXml(value)}</${name}>`;
}

export function gzipBase64(xml: string): string {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function gunzipBase64(value: string): string {
  return gunzipSync(Buffer.from(value, "base64")).toString("utf8");
}

/** Texto do primeiro elemento com esse nome local, com ou sem prefixo. */
export function firstElementText(xml: string, localName: string): string | null {
  const match = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${localName}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z_][\\w.-]*:)?${localName}>`,
  ).exec(xml);
  return match ? match[1].trim() : null;
}
