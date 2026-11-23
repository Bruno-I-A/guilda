import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";

import { firstPdfPages, pickTurnAttachment, turnMessageText } from "./support-attachment";

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([200, 200]).drawText(`pagina ${i + 1}`);
  return doc.save();
}

describe("texto do turno com arquivo", () => {
  test("mantém a legenda e o nome do arquivo, que antes viravam só \"Documento\"", () => {
    expect(turnMessageText({ text: null, messageType: "document", content: { filename: "guia-inss-10-2026.pdf", caption: "pode recalcular?" } })).toBe(
      'Documento "guia-inss-10-2026.pdf": pode recalcular?',
    );
    expect(turnMessageText({ text: null, messageType: "image", content: { caption: "segue o comprovante" } })).toBe("Imagem: segue o comprovante");
    expect(turnMessageText({ text: null, messageType: "image", content: {} })).toBe("Imagem");
    expect(turnMessageText({ text: "oi", messageType: "text", content: {} })).toBe("oi");
  });
});

describe("arquivo que a IA lê no turno", () => {
  test("o último PDF ou foto do turno, com id da Meta", () => {
    const messages = [
      { id: "m1", messageType: "image", content: { id: "111", mime_type: "image/jpeg" } },
      { id: "m2", messageType: "text", content: {} },
      { id: "m3", messageType: "document", content: { id: "222", mime_type: "application/pdf" } },
    ];
    expect(pickTurnAttachment(messages)).toEqual({ messageId: "m3", kind: "pdf", mediaId: "222", mimeType: "application/pdf" });
    expect(pickTurnAttachment(messages.slice(0, 2))).toEqual({ messageId: "m1", kind: "image", mediaId: "111", mimeType: "image/jpeg" });
  });

  test("ignora planilha, áudio, figurinha e mídia sem id", () => {
    expect(
      pickTurnAttachment([
        { id: "a", messageType: "document", content: { id: "1", mime_type: "application/vnd.ms-excel" } },
        { id: "b", messageType: "audio", content: { id: "2", mime_type: "audio/ogg" } },
        { id: "c", messageType: "sticker", content: { id: "3", mime_type: "image/webp" } },
        { id: "d", messageType: "image", content: { mime_type: "image/png" } },
      ]),
    ).toBeNull();
  });
});

describe("PDF cortado nas primeiras páginas", () => {
  test("três páginas viram duas; duas ficam como estão", async () => {
    const three = await firstPdfPages(await pdfWithPages(3), 2);
    expect(three).toMatchObject({ pages: 2, totalPages: 3 });
    expect((await PDFDocument.load(three!.data)).getPageCount()).toBe(2);
    expect(await firstPdfPages(await pdfWithPages(2), 2)).toMatchObject({ pages: 2, totalPages: 2 });
  });

  test("arquivo que não é PDF não vai para a IA", async () => {
    expect(await firstPdfPages(new TextEncoder().encode("não sou pdf"), 2)).toBeNull();
  });
});
