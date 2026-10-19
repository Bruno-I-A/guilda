import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";

import { buildXmlArchive } from "./xml-archive";

const note = (fileName: string, cancellation: string | null = null) => ({ fileName, xml: `<NFSe>${fileName}</NFSe>`, cancellation });

describe("arquivo de XML para baixar", () => {
  test("mês inteiro: pasta por empresa, canceladas à parte e LEIA-ME", () => {
    const archive = buildXmlArchive({
      baseName: "nfse-prestadas-2026-09",
      rangeLabel: "emitidas de 01/09 a 30/09",
      singleCompany: false,
      companies: [{ folder: "padaria-33000167", notes: [note("000107.xml"), note("000108.xml", "<evento/>")] }],
      missing: [{ companyName: "Mercado", reason: "certificado vencido" }],
    });
    expect(archive.kind).toBe("zip");
    expect(archive.fileName).toBe("nfse-prestadas-2026-09.zip");
    const files = unzipSync(archive.body);
    expect(Object.keys(files).sort()).toEqual([
      "LEIA-ME.txt",
      "padaria-33000167/000107.xml",
      "padaria-33000167/canceladas/000108-cancelamento.xml",
      "padaria-33000167/canceladas/000108.xml",
    ]);
    expect(strFromU8(files["LEIA-ME.txt"])).toContain("Mercado: certificado vencido");
  });

  test("uma empresa com uma nota não cancelada: o próprio XML", () => {
    const archive = buildXmlArchive({
      baseName: "nfse-prestadas-2026-09",
      rangeLabel: "emitidas de 01/09 a 30/09",
      singleCompany: true,
      companies: [{ folder: "padaria-33000167", notes: [note("000107.xml")] }],
      missing: [],
    });
    expect(archive).toMatchObject({ kind: "xml", fileName: "padaria-33000167-000107.xml" });
    expect(strFromU8(archive.body)).toBe("<NFSe>000107.xml</NFSe>");
  });

  test("uma empresa com cancelada ou com mais notas: .zip com o nome dela", () => {
    const archive = buildXmlArchive({
      baseName: "nfse-prestadas-2026-09",
      rangeLabel: "emitidas de 01/09 a 30/09",
      singleCompany: true,
      companies: [{ folder: "padaria-33000167", notes: [note("000107.xml", "<evento/>")] }],
      missing: [],
    });
    expect(archive).toMatchObject({ kind: "zip", fileName: "nfse-prestadas-2026-09-padaria-33000167.zip" });
  });

  test("nada no período: .zip só com o LEIA-ME", () => {
    const archive = buildXmlArchive({ baseName: "nfse-prestadas-2026-09", rangeLabel: "emitidas de 01/09 a 30/09", singleCompany: false, companies: [], missing: [] });
    expect(Object.keys(unzipSync(archive.body))).toEqual(["LEIA-ME.txt"]);
  });
});
