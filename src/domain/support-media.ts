/**
 * Documento recebido no Atendimento (2026-11-23, pedido do Bruno): a conversa
 * mostra o arquivo para baixar. Só o PDF abre no navegador; qualquer outro tipo
 * é sempre baixado, para arquivo de cliente nunca rodar como página da Guilda.
 */

/** Acima disso o download pela Guilda pesaria no servidor; abre-se no WhatsApp do escritório. */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/** O nome que veio do WhatsApp, sem pasta nem caractere de controle. */
export function documentFilename(content: Record<string, unknown>, mimeType: string | null): string {
  const raw = typeof content.filename === "string" ? content.filename : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 150);
  if (clean) return clean;
  return mimeType === "application/pdf" ? "documento.pdf" : "documento";
}

function asciiFallback(filename: string): string {
  const ascii = filename
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/["\\]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return ascii || "documento";
}

export function documentResponseHeaders(input: { filename: string; mimeType: string }): Record<string, string> {
  const pdf = input.mimeType === "application/pdf";
  const encoded = encodeURIComponent(input.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    "Content-Type": pdf ? "application/pdf" : "application/octet-stream",
    "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename="${asciiFallback(input.filename)}"; filename*=UTF-8''${encoded}`,
    // O leitor de PDF do Chrome não abre com sandbox; os outros tipos nunca são exibidos.
    ...(pdf ? {} : { "Content-Security-Policy": "sandbox" }),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
