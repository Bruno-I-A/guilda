import { describe, expect, test } from "vitest";

import { documentFilename, documentResponseHeaders } from "./support-media";

describe("nome do documento recebido", () => {
  test("usa o nome que veio do WhatsApp, sem pasta nem caractere de controle", () => {
    expect(documentFilename({ filename: "guia-inss-10-2026.pdf" }, "application/pdf")).toBe("guia-inss-10-2026.pdf");
    expect(documentFilename({ filename: "../../etc/passwd" }, "text/plain")).toBe("passwd");
    expect(documentFilename({ filename: "C:\\Users\\x\\nota\u0000.xml" }, "text/xml")).toBe("nota.xml");
  });

  test("sem nome, um genérico com a extensão do PDF", () => {
    expect(documentFilename({}, "application/pdf")).toBe("documento.pdf");
    expect(documentFilename({ filename: "   " }, "application/zip")).toBe("documento");
  });
});

describe("resposta do download", () => {
  test("PDF abre no navegador", () => {
    const headers = documentResponseHeaders({ filename: "guia.pdf", mimeType: "application/pdf" });
    expect(headers["Content-Type"]).toBe("application/pdf");
    expect(headers["Content-Disposition"]).toMatch(/^inline; /);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  test("qualquer outro tipo é sempre baixado e nunca roda como página da Guilda", () => {
    for (const mimeType of ["text/html", "image/svg+xml", "text/xml", "application/vnd.ms-excel"]) {
      const headers = documentResponseHeaders({ filename: "arquivo", mimeType });
      expect(headers["Content-Type"]).toBe("application/octet-stream");
      expect(headers["Content-Disposition"]).toMatch(/^attachment; /);
      expect(headers["Content-Security-Policy"]).toBe("sandbox");
    }
  });

  test("nome com acento e aspas vai codificado, com versão sem acento para navegador antigo", () => {
    const disposition = documentResponseHeaders({ filename: 'Relatório "final".pdf', mimeType: "application/pdf" })["Content-Disposition"];
    expect(disposition).toBe(`inline; filename="Relatorio final.pdf"; filename*=UTF-8''Relat%C3%B3rio%20%22final%22.pdf`);
  });
});
