import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import { SUPPORT_UPLOAD_BODY_MAX_BYTES, validateSupportCaption, validateSupportUpload } from "@/domain/support-upload";
import { requireMemberContext } from "@/lib/action-context";
import { checkSupportMediaReply, loadSupportViewer, sendSupportMedia } from "@/lib/support/inbox";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { MetaGraphError, uploadWhatsAppMedia } from "@/lib/whatsapp/meta-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ conversationId: z.uuid() });
const requestIdSchema = z.uuid();

function json(status: number, error?: string): Response {
  return Response.json(error ? { ok: false, error } : { ok: true }, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Lê o multipart com teto mesmo quando o cliente não manda Content-Length. */
async function boundedFormData(request: Request): Promise<FormData | null> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data") || !request.body) return null;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > SUPPORT_UPLOAD_BODY_MAX_BYTES) throw new RangeError("large");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > SUPPORT_UPLOAD_BODY_MAX_BYTES) {
      await reader.cancel();
      throw new RangeError("large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: bytes.buffer,
  }).formData();
}

/** Envio humano: checa a conversa antes e depois de falar com a Meta. */
export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return json(400, "Conversa inválida.");
  if (request.headers.get("origin") !== new URL(request.url).origin) return json(403, "Origem inválida.");

  const member = await requireMemberContext();
  if (!member.ok) return json(401, member.error);

  let form: FormData | null;
  try {
    form = await boundedFormData(request);
  } catch (error) {
    return error instanceof RangeError ? json(413, "O arquivo deve ter até 20 MB.") : json(400, "Não foi possível ler o arquivo.");
  }
  if (!form) return json(400, "Envie um arquivo.");
  const file = form.get("file");
  const requestId = requestIdSchema.safeParse(form.get("requestId"));
  const rawCaption = form.get("caption");
  if (!(file instanceof File) || !requestId.success || typeof rawCaption !== "string") return json(400, "Arquivo inválido.");
  const spec = validateSupportUpload(file);
  if (!spec.ok) return json(400, spec.error);
  const caption = validateSupportCaption(rawCaption);
  if (caption === null) return json(400, "Legenda muito longa (até 1024 caracteres).");

  const base = { orgId: member.orgId, conversationId: parsed.data.conversationId, requestId: requestId.data };
  const permit = await withOrgTx(member.orgId, async (tx) => {
    const viewer = await loadSupportViewer(tx, { orgId: member.orgId, userId: member.userId, role: member.role });
    return checkSupportMediaReply(tx, { ...base, viewer, now: new Date() });
  });
  if (!permit.ok) return json(409, permit.error);
  if (permit.data?.alreadyQueued) return json(200);

  const access = await loadWhatsAppChannelAccess({ orgId: member.orgId, channelId: permit.data!.channelId });
  if (!access?.channel.phoneNumberId || access.channel.status !== "active") return json(503, "WhatsApp indisponível.");
  let mediaId: string;
  try {
    mediaId = await uploadWhatsAppMedia({
      phoneNumberId: access.channel.phoneNumberId,
      accessToken: access.accessToken,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: spec.value.mimeType,
      fileName: spec.value.filename,
    }, { graphApiVersion: getWhatsAppConfig().graphApiVersion });
  } catch (error) {
    if (error instanceof MetaGraphError) return json(error.httpStatus === 413 ? 413 : 502, error.httpStatus === 413 ? "Arquivo grande demais para o WhatsApp." : "O WhatsApp recusou o arquivo. Confira o formato e tente novamente.");
    console.error("Falha no upload da mídia do Atendimento", error instanceof Error ? error.message : "erro desconhecido");
    return json(502, "Não foi possível enviar o arquivo ao WhatsApp.");
  }

  const result = await withOrgTx(member.orgId, async (tx) => {
    const viewer = await loadSupportViewer(tx, { orgId: member.orgId, userId: member.userId, role: member.role });
    return sendSupportMedia(tx, {
      ...base, viewer, now: new Date(), mediaId,
      kind: spec.value.kind, mimeType: spec.value.mimeType, filename: spec.value.filename, caption,
    });
  });
  if (!result.ok) return json(409, result.error);
  revalidatePath("/atendimento");
  return json(200);
}
