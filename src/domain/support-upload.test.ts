import { expect, test } from "vitest";

import { SUPPORT_UPLOAD_MAX_FILES, validateSupportCaption, validateSupportUpload } from "./support-upload";

test("permite selecionar um lote pequeno de arquivos", () => {
  expect(SUPPORT_UPLOAD_MAX_FILES).toBe(10);
});

test("aceita imagem e documentos usuais com nome limpo", () => {
  expect(validateSupportUpload({ name: "pasta\\balanço.pdf", type: "application/pdf", size: 1024 })).toEqual({
    ok: true,
    value: { kind: "document", mimeType: "application/pdf", filename: "balanço.pdf" },
  });
  expect(validateSupportUpload({ name: "foto.JPG", type: "image/jpeg", size: 100 })).toMatchObject({ ok: true, value: { kind: "image" } });
  expect(validateSupportUpload({ name: "planilha.xlsx", type: "", size: 100 })).toMatchObject({ ok: true, value: { kind: "document" } });
});

test("recusa tipo incoerente, executável, arquivo vazio e tamanho excessivo", () => {
  expect(validateSupportUpload({ name: "balanço.pdf", type: "text/html", size: 100 }).ok).toBe(false);
  expect(validateSupportUpload({ name: "programa.exe", type: "application/octet-stream", size: 100 }).ok).toBe(false);
  expect(validateSupportUpload({ name: "foto.png", type: "image/png", size: 0 }).ok).toBe(false);
  expect(validateSupportUpload({ name: "foto.png", type: "image/png", size: 5 * 1024 * 1024 + 1 }).ok).toBe(false);
  expect(validateSupportUpload({ name: "arquivo.pdf", type: "application/pdf", size: 20 * 1024 * 1024 + 1 }).ok).toBe(false);
});

test("a legenda da mídia respeita o limite da Meta", () => {
  expect(validateSupportCaption("  Veja o arquivo  ")).toBe("Veja o arquivo");
  expect(validateSupportCaption("a".repeat(1025))).toBeNull();
});
