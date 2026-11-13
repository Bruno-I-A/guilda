import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { requireMemberContext } from "@/lib/action-context";
import {
  loadSupportMediaReference,
  loadSupportViewer,
} from "@/lib/support/inbox";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { downloadWhatsAppImage } from "@/lib/whatsapp/meta-client";

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

/** Foto do WhatsApp com sessão, tenant e visibilidade da conversa conferidos. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return plain(400, "Foto inválida.");

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
  if (!reference) return plain(404, "Foto não encontrada.");

  const access = await loadWhatsAppChannelAccess({
    orgId: member.orgId,
    channelId: reference.channelId,
  });
  if (!access || access.channel.status !== "active") {
    return plain(503, "WhatsApp indisponível.");
  }

  try {
    const image = await downloadWhatsAppImage(
      {
        mediaId: reference.mediaId,
        phoneNumberId: access.channel.phoneNumberId,
        accessToken: access.accessToken,
      },
      {
        graphApiVersion: getWhatsAppConfig().graphApiVersion,
      },
    );
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
    console.error("Falha ao abrir foto do WhatsApp", {
      error: error instanceof Error ? error.message : "erro desconhecido",
    });
    return plain(502, "A foto não está mais disponível na Meta.");
  }
}
