import { describe, expect, test } from "vitest";

import {
  certificateState,
  cnpjRootMatches,
  emissionMonthRange,
  emissionRangeLabel,
  isXmlRoutineDue,
  lastScheduledRun,
  XML_ROUTINE_DEFAULTS,
  xmlCompanyFolder,
  xmlNoteFileName,
} from "./nfse-xml";

const at = (iso: string) => new Date(iso);

describe("agenda da rotina de XML", () => {
  test("todo dia às 06:00 em Brasília", () => {
    expect(lastScheduledRun(XML_ROUTINE_DEFAULTS, at("2026-10-19T12:00:00-03:00"))).toEqual(at("2026-10-19T06:00:00-03:00"));
    expect(lastScheduledRun(XML_ROUTINE_DEFAULTS, at("2026-10-19T05:59:00-03:00"))).toEqual(at("2026-10-18T06:00:00-03:00"));
    // Virada de mês e de ano.
    expect(lastScheduledRun(XML_ROUTINE_DEFAULTS, at("2027-01-01T02:00:00-03:00"))).toEqual(at("2026-12-31T06:00:00-03:00"));
  });

  test("só no dia 5 de cada mês, às 08:30", () => {
    const monthly = { enabled: true, frequency: "monthly" as const, dayOfMonth: 5, time: "08:30" };
    expect(lastScheduledRun(monthly, at("2026-10-19T12:00:00-03:00"))).toEqual(at("2026-10-05T08:30:00-03:00"));
    expect(lastScheduledRun(monthly, at("2026-10-05T08:29:00-03:00"))).toEqual(at("2026-09-05T08:30:00-03:00"));
    expect(lastScheduledRun(monthly, at("2026-01-03T00:00:00-03:00"))).toEqual(at("2025-12-05T08:30:00-03:00"));
  });

  test("está na hora quando a última rodada é anterior ao último horário agendado", () => {
    const now = at("2026-10-19T06:01:00-03:00");
    const base = { schedule: XML_ROUTINE_DEFAULTS, runRequestedAt: null, now };
    expect(isXmlRoutineDue({ ...base, lastRunStartedAt: null })).toBe(true);
    expect(isXmlRoutineDue({ ...base, lastRunStartedAt: at("2026-10-18T06:00:05-03:00") })).toBe(true);
    expect(isXmlRoutineDue({ ...base, lastRunStartedAt: at("2026-10-19T06:00:05-03:00") })).toBe(false);
  });

  test("desligada não roda sozinha, mas 'rodar agora' roda", () => {
    const schedule = { ...XML_ROUTINE_DEFAULTS, enabled: false };
    const now = at("2026-10-19T12:00:00-03:00");
    const lastRunStartedAt = at("2026-10-01T06:00:00-03:00");
    expect(isXmlRoutineDue({ schedule, lastRunStartedAt, runRequestedAt: null, now })).toBe(false);
    expect(isXmlRoutineDue({ schedule, lastRunStartedAt, runRequestedAt: at("2026-10-19T11:59:00-03:00"), now })).toBe(true);
    // Pedido já atendido (a rodada começou depois dele) não roda de novo.
    expect(
      isXmlRoutineDue({ schedule, lastRunStartedAt: at("2026-10-19T11:59:30-03:00"), runRequestedAt: at("2026-10-19T11:59:00-03:00"), now }),
    ).toBe(false);
  });
});

describe("mês de emissão", () => {
  test("setembro vai de 01/09 00:00 a 01/10 00:00, em Brasília", () => {
    const range = emissionMonthRange(2026, 9);
    expect(range.start).toEqual(at("2026-09-01T00:00:00-03:00"));
    expect(range.end).toEqual(at("2026-10-01T00:00:00-03:00"));
    expect(at("2026-09-30T23:59:59-03:00") < range.end).toBe(true);
    expect(at("2026-10-01T00:00:00-03:00") < range.end).toBe(false);
    expect(emissionMonthRange(2026, 12).end).toEqual(at("2027-01-01T00:00:00-03:00"));
  });

  test("rótulo do botão", () => {
    expect(emissionRangeLabel(2026, 9)).toBe("emitidas de 01/09 a 30/09");
    expect(emissionRangeLabel(2028, 2)).toBe("emitidas de 01/02 a 29/02");
  });
});

describe("nomes no arquivo", () => {
  test("pasta da empresa: nome sem acento + raiz do CNPJ", () => {
    expect(xmlCompanyFolder("Padaria Pão & Cia Ltda", "33000167000101")).toBe("padaria-pao-cia-ltda-33000167");
    expect(xmlCompanyFolder("  ", null)).toBe("empresa");
  });

  test("nome longo cortado logo depois de um separador não deixa hífen duplo", () => {
    // 59 letras + separador + mais texto: o corte em 60 cai exatamente no hífen.
    const name = `${"a".repeat(59)} bbb`;
    expect(xmlCompanyFolder(name, "33000167000101")).toBe(`${"a".repeat(59)}-33000167`);
    expect(xmlCompanyFolder(name, null)).toBe("a".repeat(59));
  });

  test("arquivo da nota: número com seis dígitos, ou o NSU sem número", () => {
    expect(xmlNoteFileName("123", 9)).toBe("000123.xml");
    expect(xmlNoteFileName(null, 9)).toBe("nsu-9.xml");
  });
});

describe("certificado da empresa", () => {
  const now = at("2026-10-19T12:00:00-03:00");
  test("situações", () => {
    expect(certificateState({ status: null, validUntil: null, now }).state).toBe("missing");
    expect(certificateState({ status: "pending", validUntil: null, now }).state).toBe("pending");
    expect(certificateState({ status: "invalid", validUntil: null, now }).state).toBe("invalid");
    expect(certificateState({ status: "valid", validUntil: at("2027-03-19T00:00:00-03:00"), now }).state).toBe("valid");
    expect(certificateState({ status: "valid", validUntil: at("2026-11-01T00:00:00-03:00"), now })).toEqual({ state: "expiring", daysLeft: 12 });
    expect(certificateState({ status: "valid", validUntil: at("2026-10-01T00:00:00-03:00"), now }).state).toBe("expired");
  });

  test("raiz do CNPJ", () => {
    expect(cnpjRootMatches("33000167000101", "33000167000282")).toBe(true);
    expect(cnpjRootMatches("33000167000101", "11222333000181")).toBe(false);
  });
});
