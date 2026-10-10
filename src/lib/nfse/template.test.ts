import { describe, expect, test } from "vitest";

import { parseNfseTemplate } from "./template";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { nfseIssueTimestamp, nfseToday } from "./time";
import { escapeXml, firstElementText, gunzipBase64, gzipBase64 } from "./xml";

describe("modelo da nota", () => {
  test("aceita o modelo completo e recusa campo fora do formato", () => {
    expect(parseNfseTemplate(TEST_TEMPLATE)?.cityCode).toBe("4314902");
    expect(parseNfseTemplate({ ...TEST_TEMPLATE, cityCode: "431490" })).toBeNull();
    expect(parseNfseTemplate({ ...TEST_TEMPLATE, totalTaxes: { kind: "simples", percent: "6.5" } })).toBeNull();
    expect(parseNfseTemplate(null)).toBeNull();
  });
});

describe("utilitários de XML", () => {
  test("escapa os cinco caracteres reservados", () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  });
  test("gzip + base64 vai e volta", () => {
    expect(gunzipBase64(gzipBase64("<a>ç</a>"))).toBe("<a>ç</a>");
  });
  test("lê o texto de um elemento com ou sem prefixo", () => {
    expect(firstElementText("<x><ns:nNFSe>42</ns:nNFSe></x>", "nNFSe")).toBe("42");
    expect(firstElementText("<x/>", "nNFSe")).toBeNull();
  });
});

describe("horário da emissão", () => {
  test("dhEmi em Brasília, um minuto antes, com fuso -03:00", () => {
    expect(nfseIssueTimestamp(new Date("2026-10-01T02:30:30Z"))).toBe("2026-09-30T23:29:30-03:00");
  });
  test("hoje no fuso da Guilda", () => {
    expect(nfseToday(new Date("2026-10-01T02:30:00Z"))).toBe("2026-09-30");
  });
});
