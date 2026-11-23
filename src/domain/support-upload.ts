/** Formatos aceitos para envio pelo WhatsApp; limites menores que os da Meta. */
const TYPES = {
  jpg: { mimeType: "image/jpeg", kind: "image", maxBytes: 5 * 1024 * 1024 },
  jpeg: { mimeType: "image/jpeg", kind: "image", maxBytes: 5 * 1024 * 1024 },
  png: { mimeType: "image/png", kind: "image", maxBytes: 5 * 1024 * 1024 },
  pdf: { mimeType: "application/pdf", kind: "document", maxBytes: 20 * 1024 * 1024 },
  doc: { mimeType: "application/msword", kind: "document", maxBytes: 20 * 1024 * 1024 },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document", maxBytes: 20 * 1024 * 1024 },
  xls: { mimeType: "application/vnd.ms-excel", kind: "document", maxBytes: 20 * 1024 * 1024 },
  xlsx: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document", maxBytes: 20 * 1024 * 1024 },
  ppt: { mimeType: "application/vnd.ms-powerpoint", kind: "document", maxBytes: 20 * 1024 * 1024 },
  pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document", maxBytes: 20 * 1024 * 1024 },
  txt: { mimeType: "text/plain", kind: "document", maxBytes: 20 * 1024 * 1024 },
} as const;

export const SUPPORT_UPLOAD_ACCEPT = Object.keys(TYPES).map((extension) => `.${extension}`).join(",");
export const SUPPORT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const SUPPORT_UPLOAD_BODY_MAX_BYTES = SUPPORT_UPLOAD_MAX_BYTES + 512 * 1024;

export type SupportUpload = { kind: "image" | "document"; mimeType: string; filename: string };

export function validateSupportUpload(file: { name: string; type: string; size: number }):
  | { ok: true; value: SupportUpload }
  | { ok: false; error: string } {
  const filename = (file.name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const spec = TYPES[extension as keyof typeof TYPES];
  if (!spec) return { ok: false, error: "Formato não aceito. Envie foto JPG/PNG ou documento PDF, Office ou TXT." };
  if (!filename || filename.length > 150) return { ok: false, error: "Nome do arquivo inválido ou muito longo (até 150 caracteres)." };
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > spec.maxBytes) {
    return { ok: false, error: spec.kind === "image" ? "A foto deve ter até 5 MB." : "O documento deve ter até 20 MB." };
  }
  if (file.type && file.type.toLowerCase() !== spec.mimeType) {
    return { ok: false, error: "O tipo do arquivo não corresponde à extensão." };
  }
  return { ok: true, value: { kind: spec.kind, mimeType: spec.mimeType, filename } };
}

export function validateSupportCaption(value: string): string | null {
  const caption = value.trim();
  return caption.length <= 1024 ? caption : null;
}
