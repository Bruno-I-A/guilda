import { PageSizes, PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";

import { readDanfse } from "./danfse-data";
import { renderDanfsePdf } from "./danfse-pdf";
import { testNfseXml } from "./testing/nfse-xml";

async function pages(pdf: Uint8Array) {
  const document = await PDFDocument.load(pdf);
  return document.getPages().map((page) => page.getSize());
}

describe("PDF do DANFSe", () => {
  test("sai numa página A4 só", async () => {
    const pdf = await renderDanfsePdf(readDanfse(testNfseXml()));
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(await pages(pdf)).toEqual([{ width: PageSizes.A4[0], height: PageSizes.A4[1] }]);
  });

  test("descrição longa e caractere fora do WinAnsi não quebram a página", async () => {
    const description = `${"Honorários → serviços contábeis do mês ✓ ".repeat(48)}fim`.slice(0, 2000);
    const danfse = readDanfse(testNfseXml({ environment: 2, description }));
    expect(await pages(await renderDanfsePdf(danfse))).toHaveLength(1);
  });
});
