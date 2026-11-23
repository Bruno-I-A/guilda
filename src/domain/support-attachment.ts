/**
 * Arquivos que o agente lê no teste (2026-11-23, pedido do Bruno): o cliente
 * manda o PDF da guia e pede "recalcula?" sem dizer do que é. A IA lê a foto
 * ou as primeiras páginas do PDF para saber o assunto e encaminhar certo.
 * Puro: o download fica em src/lib/support/agent/attachment.ts.
 */
import { PDFDocument } from "pdf-lib";

import { audioTurnText } from "./support-audio";
import { messageLabel } from "./support-inbox";

/** Tipos de foto que a IA lê; figurinha (sticker) não entra. */
export const AGENT_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const AGENT_PDF_TYPE = "application/pdf";

export type TurnAttachment = { messageId: string; kind: "image" | "pdf"; mediaId: string; mimeType: string };

type TurnMessage = { id: string; messageType: string; content: Record<string, unknown> };

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Texto da mensagem para a IA. Foto e documento chegam sem texto: a legenda e o
 * nome do arquivo moram no conteúdo e viravam só "Documento".
 */
export function turnMessageText(message: {
  text: string | null;
  messageType: string;
  content: Record<string, unknown>;
  /** Texto do áudio recebido, quando a transcrição terminou (2026-11-23). */
  transcript?: string | null;
}): string {
  if (message.text === null && message.messageType === "audio") return audioTurnText(message.transcript);
  if (message.text !== null || (message.messageType !== "document" && message.messageType !== "image")) return messageLabel(message);
  const filename = message.messageType === "document" ? str(message.content.filename, 120) : null;
  const caption = str(message.content.caption, 1000);
  return `${messageLabel(message)}${filename ? ` "${filename}"` : ""}${caption ? `: ${caption}` : ""}`;
}

/** O último arquivo legível do turno: um só, para o custo não crescer com quem manda vários. */
export function pickTurnAttachment(messages: readonly TurnMessage[]): TurnAttachment | null {
  for (const message of [...messages].reverse()) {
    const mediaId = str(message.content.id, 32);
    const mimeType = str(message.content.mime_type, 100)?.split(";")[0]?.trim().toLowerCase() ?? null;
    if (!mediaId || !/^\d{1,32}$/.test(mediaId) || !mimeType) continue;
    if (message.messageType === "image" && AGENT_IMAGE_TYPES.has(mimeType)) return { messageId: message.id, kind: "image", mediaId, mimeType };
    if (message.messageType === "document" && mimeType === AGENT_PDF_TYPE) return { messageId: message.id, kind: "pdf", mediaId, mimeType };
  }
  return null;
}

/**
 * As primeiras páginas do PDF num PDF novo. null quando o arquivo não abre
 * (corrompido, protegido por senha): nesse caso a IA segue só com o texto.
 */
export async function firstPdfPages(
  bytes: ArrayBuffer | Uint8Array,
  maxPages: number,
): Promise<{ data: Uint8Array; pages: number; totalPages: number } | null> {
  try {
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    const totalPages = source.getPageCount();
    if (totalPages === 0) return null;
    if (totalPages <= maxPages) return { data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), pages: totalPages, totalPages };
    const trimmed = await PDFDocument.create();
    const copied = await trimmed.copyPages(source, Array.from({ length: maxPages }, (_, index) => index));
    for (const page of copied) trimmed.addPage(page);
    return { data: await trimmed.save(), pages: maxPages, totalPages };
  } catch {
    return null;
  }
}
