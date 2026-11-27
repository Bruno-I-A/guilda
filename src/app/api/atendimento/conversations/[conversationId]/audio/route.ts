import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { audioBaseMime } from "@/domain/support-audio";
import { requireMemberContext } from "@/lib/action-context";
import { isSameOriginRequest } from "@/lib/request-security";
import { checkSupportAudioReply, loadSupportViewer, sendSupportAudioReply } from "@/lib/support/inbox";
import { convertToVoiceNote, VOICE_NOTE_MAX_INPUT_BYTES, VoiceNoteError } from "@/lib/support/voice-note";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { MetaGraphError, uploadWhatsAppMedia } from "@/lib/whatsapp/meta-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ conversationId: z.uuid() });

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Nota de voz gravada na conversa (2026-11-23, pedido do Bruno). Confere a
 * mesma régua da resposta em texto ANTES de converter e subir à Meta, converte
 * para OGG/Opus, sobe e só então grava a mensagem e a saída. A chave do envio
 * (requestId) impede a nota em dobro num clique duplo.
 */
export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }): Promise<Response> {
  const member = await requireMemberContext();
  if (!member.ok) return json({ ok: false, error: member.error }, 401);
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Origem da solicitação recusada." }, 403);
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return json({ ok: false, error: "Conversa inválida." }, 400);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Gravação inválida." }, 400);
  }
  const file = form.get("audio");
  const requestId = z.uuid().safeParse(form.get("requestId"));
  const replyToValue = form.get("replyToMessageId");
  const replyToMessageId = replyToValue ? z.uuid().safeParse(replyToValue) : null;
  if (!requestId.success) return json({ ok: false, error: "Recarregue a página e tente de novo." }, 400);
  if (replyToMessageId && !replyToMessageId.success) return json({ ok: false, error: "Mensagem citada inválida." }, 400);
  if (!(file instanceof Blob) || file.size === 0) return json({ ok: false, error: "A gravação veio vazia." }, 400);
  if (file.size > VOICE_NOTE_MAX_INPUT_BYTES) return json({ ok: false, error: "A gravação passou de 10 MB. Grave um áudio mais curto." }, 413);
  if (!audioBaseMime(file.type)) return json({ ok: false, error: "O navegador não gravou em áudio." }, 415);

  const base = { orgId: member.orgId, conversationId: params.data.conversationId, requestId: requestId.data, replyToMessageId: replyToMessageId?.data ?? null };
  const check = await withOrgTx(member.orgId, async (tx) => {
    const viewer = await loadSupportViewer(tx, { orgId: member.orgId, userId: member.userId, role: member.role });
    return checkSupportAudioReply(tx, { ...base, viewer, now: new Date() });
  });
  if (!check.ok) return json(check, 400);
  if (check.data?.duplicate) return json({ ok: true });

  let voiceNote: Uint8Array;
  try {
    voiceNote = await convertToVoiceNote(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    console.error("Falha ao converter nota de voz", { detail: error instanceof VoiceNoteError ? error.detail : error instanceof Error ? error.message : "erro desconhecido" });
    return json({ ok: false, error: error instanceof VoiceNoteError ? error.message : "Não foi possível converter o áudio." }, 422);
  }

  const access = await loadWhatsAppChannelAccess({ orgId: member.orgId, channelId: check.data!.channelId });
  if (!access?.channel.phoneNumberId || access.channel.status !== "active") return json({ ok: false, error: "WhatsApp indisponível." }, 503);
  let mediaId: string;
  try {
    mediaId = await uploadWhatsAppMedia(
      { phoneNumberId: access.channel.phoneNumberId, accessToken: access.accessToken, bytes: voiceNote, mimeType: "audio/ogg", fileName: "nota-de-voz.ogg" },
      { graphApiVersion: getWhatsAppConfig().graphApiVersion },
    );
  } catch (error) {
    console.error("A Meta recusou a nota de voz", {
      status: error instanceof MetaGraphError ? error.httpStatus : null,
      code: error instanceof MetaGraphError ? error.graphCode : null,
    });
    return json({ ok: false, error: "A Meta não aceitou o áudio. Tente de novo." }, 502);
  }

  const result = await withOrgTx(member.orgId, async (tx) => {
    const viewer = await loadSupportViewer(tx, { orgId: member.orgId, userId: member.userId, role: member.role });
    return sendSupportAudioReply(tx, { ...base, viewer, mediaId, now: new Date() });
  });
  if (result.ok) revalidatePath("/atendimento");
  return json(result, result.ok ? 200 : 400);
}
