import { describe, expect, test } from "vitest";

import { parseNfseTemplate } from "./template";
import { TEST_TEMPLATE } from "./testing/fixtures";
import { nfseIssueDate, nfseIssueTimestamp, nfseToday } from "./time";
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
  test("competência é o dia do dhEmi, mesmo na virada da meia-noite", () => {
    // 00:00:30 em Brasília: o dhEmi cai às 23:59:30 do dia anterior, e a competência acompanha.
    expect(nfseIssueDate(new Date("2026-10-08T03:00:30Z"))).toBe("2026-10-07");
    expect(nfseIssueDate(new Date("2026-10-08T13:08:47Z"))).toBe("2026-10-08");
  });
});

describe("regras do modelo que o Sistema Nacional cobra", () => {
  test("ME/EPP precisa do percentual do Simples, não de 'não informar' (E0712)", async () => {
    const { nfseTemplateRulesSchema } = await import("./template");
    expect(nfseTemplateRulesSchema.safeParse({ ...TEST_TEMPLATE, totalTaxes: { kind: "none" } }).success).toBe(false);
    expect(nfseTemplateRulesSchema.safeParse(TEST_TEMPLATE).success).toBe(true);
  });

  test("MEI não usa o percentual do Simples e não optante ainda não é suportado", async () => {
    const { nfseTemplateRulesSchema } = await import("./template");
    expect(nfseTemplateRulesSchema.safeParse({ ...TEST_TEMPLATE, taxRegime: { opSimpNac: "2", regEspTrib: "0" } }).success).toBe(false);
    expect(nfseTemplateRulesSchema.safeParse({ ...TEST_TEMPLATE, taxRegime: { opSimpNac: "1", regEspTrib: "0" }, totalTaxes: { kind: "none" } }).success).toBe(false);
  });
});
