import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { AUDIO_MAX_BYTES, audioBaseMime } from "@/domain/support-audio";
import { DOCUMENT_MAX_BYTES, documentResponseHeaders } from "@/domain/support-media";
import { requireMemberContext } from "@/lib/action-context";
import {
  loadSupportMediaReference,
  loadSupportViewer,
} from "@/lib/support/inbox";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { downloadWhatsAppImage, downloadWhatsAppMedia, MetaGraphError } from "@/lib/whatsapp/meta-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ messageId: z.uuid() });

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Foto ou documento do WhatsApp com sessão, tenant e visibilidade da conversa
 * conferidos. Documento (2026-11-23): PDF abre no navegador; o resto baixa.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return plain(400, "Arquivo inválido.");

  const member = await requireMemberContext();
  if (!member.ok) return plain(401, member.error);

  const reference = await withOrgTx(member.orgId, async (tx) => {
    const viewer = await loadSupportViewer(tx, {
      orgId: member.orgId,
      userId: member.userId,
      role: member.role,
    });
    return loadSupportMediaReference(tx, {
      orgId: member.orgId,
      viewer,
      messageId: parsed.data.messageId,
    });
  });
  if (!reference) return plain(404, "Arquivo não encontrado.");

  const access = await loadWhatsAppChannelAccess({
    orgId: member.orgId,
    channelId: reference.channelId,
  });
  if (!access || access.channel.status !== "active") {
    return plain(503, "WhatsApp indisponível.");
  }
  const media = {
    mediaId: reference.mediaId,
    phoneNumberId: access.channel.phoneNumberId,
    accessToken: access.accessToken,
  };
  const config = { graphApiVersion: getWhatsAppConfig().graphApiVersion };

  try {
    if (reference.kind === "audio") {
      // Áudio (2026-11-23): só tipos audio/*, servidos como áudio para o player da conversa.
      const audio = await downloadWhatsAppMedia({ ...media, allowedMimeTypes: null, maxBytes: AUDIO_MAX_BYTES }, config);
      const mimeType = audioBaseMime(audio.mimeType);
      if (!mimeType) return plain(415, "Formato de áudio desconhecido.");
      return new Response(audio.bytes, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": "inline",
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (reference.kind === "document") {
      const document = await downloadWhatsAppMedia({ ...media, allowedMimeTypes: null, maxBytes: DOCUMENT_MAX_BYTES }, config);
      return new Response(document.bytes, {
        status: 200,
        headers: documentResponseHeaders({ filename: reference.filename, mimeType: document.mimeType }),
      });
    }
    const image = await downloadWhatsAppImage(media, config);
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof MetaGraphError && error.httpStatus === 413) {
      return plain(413, "Arquivo grande demais para baixar pela Guilda (mais de 25 MB). Abra no WhatsApp do escritório.");
    }
    console.error("Falha ao abrir arquivo do WhatsApp", {
      error: error instanceof Error ? error.message : "erro desconhecido",
    });
    return plain(502, "O arquivo não está mais disponível na Meta.");
  }
}
