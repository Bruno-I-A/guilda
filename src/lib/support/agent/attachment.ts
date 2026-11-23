import "server-only";

import { AGENT_IMAGE_TYPES, AGENT_PDF_TYPE, firstPdfPages, type TurnAttachment } from "@/domain/support-attachment";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { downloadWhatsAppMedia, MetaGraphError } from "@/lib/whatsapp/meta-client";

import type { AnexoParaClassificacao, ImagemParaClassificacao } from "../triage/classificacao";

/**
 * Baixa da Meta o arquivo do turno do teste do agente (2026-11-23) e o prepara
 * para a IA: foto inteira, PDF só nas primeiras páginas. Qualquer falha vira
 * "pulado" com o motivo, e a IA segue só com o texto, como antes.
 */

/** Páginas do PDF que a IA lê: guia e boleto cabem nelas (pedido do Bruno). */
export const AGENT_PDF_MAX_PAGES = 2;
/** Limite da Anthropic por imagem. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_TYPES: ReadonlySet<string> = new Set([AGENT_PDF_TYPE]);

export type AttachmentRecord = {
  kind: "image" | "pdf";
  status: "read" | "skipped";
  reason?: string;
  pages?: number;
  totalPages?: number;
};

export async function loadAgentAttachment(
  input: { orgId: string; channelId: string; attachment: TurnAttachment },
  fetchImpl: typeof fetch = fetch,
): Promise<{ anexo: AnexoParaClassificacao | null; record: AttachmentRecord }> {
  const kind = input.attachment.kind;
  const skip = (reason: string) => ({ anexo: null, record: { kind, status: "skipped" as const, reason } });
  try {
    const access = await loadWhatsAppChannelAccess({ orgId: input.orgId, channelId: input.channelId });
    if (!access?.channel.phoneNumberId) return skip("canal_sem_acesso");
    const media = await downloadWhatsAppMedia(
      {
        mediaId: input.attachment.mediaId,
        phoneNumberId: access.channel.phoneNumberId,
        accessToken: access.accessToken,
        allowedMimeTypes: kind === "pdf" ? PDF_TYPES : AGENT_IMAGE_TYPES,
        maxBytes: kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES,
      },
      { graphApiVersion: getWhatsAppConfig().graphApiVersion },
      fetchImpl,
    );
    if (kind === "image") {
      return {
        anexo: { tipo: "imagem", data: Buffer.from(media.bytes).toString("base64"), tipoMime: media.mimeType as ImagemParaClassificacao["tipoMime"] },
        record: { kind, status: "read" },
      };
    }
    const pdf = await firstPdfPages(media.bytes, AGENT_PDF_MAX_PAGES);
    if (!pdf) return skip("pdf_ilegivel");
    return {
      anexo: { tipo: "pdf", data: Buffer.from(pdf.data).toString("base64") },
      record: { kind, status: "read", pages: pdf.pages, totalPages: pdf.totalPages },
    };
  } catch (error) {
    // Arquivo grande demais, tipo recusado ou Meta fora do ar: nada disso trava o turno.
    return skip(error instanceof MetaGraphError ? `meta_${error.httpStatus}` : "falha_download");
  }
}
