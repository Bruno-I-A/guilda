import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { AGENT_IMAGE_TYPES, AGENT_PDF_TYPE, firstPdfPages } from "@/domain/support-attachment";
import { AUDIO_MAX_BYTES, audioBaseMime, transcriptionFileName } from "@/domain/support-audio";
import { readMissionAttachment, type MissionAttachment } from "@/lib/ai/mission-attachment";
import { transcribeAudio, transcriptionConfig } from "@/lib/support/transcription";

import { loadWhatsAppChannelAccess } from "./channel-repository";
import { getWhatsAppConfig } from "./config";
import { downloadWhatsAppMedia } from "./meta-client";

/**
 * Áudio, foto ou PDF de um integrante vira o texto do pedido (2026-11-24):
 * áudio pela transcrição da OpenAI (a mesma do Atendimento), foto e PDF pela
 * leitura da Anthropic. O arquivo não fica guardado; só o texto segue, para a
 * mesma prévia da mensagem escrita.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_PAGES = 3;
const PDF_TYPES: ReadonlySet<string> = new Set([AGENT_PDF_TYPE]);

export type MediaReading =
  | Readonly<{ ok: true; text: string; kind: "audio" | "image" | "pdf" }>
  | Readonly<{ ok: false; message: string }>;

type Deps = Readonly<{
  fetchImpl?: typeof fetch;
  readAttachment?: typeof readMissionAttachment;
}>;

export async function readMemberMedia(
  input: { orgId: string; messageType: string; mediaId: string; mimeType: string | null; caption: string | null },
  deps: Deps = {},
): Promise<MediaReading> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readAttachment = deps.readAttachment ?? readMissionAttachment;
  const kind = input.messageType === "audio"
    ? "audio"
    : input.messageType === "image"
      ? "image"
      : input.messageType === "document" && input.mimeType === AGENT_PDF_TYPE ? "pdf" : null;
  if (!kind) return { ok: false, message: "Por aqui eu leio texto, áudio, foto e PDF. Mande o pedido num desses formatos." };
  const transcription = transcriptionConfig();
  if (kind === "audio" && !transcription.apiKey) {
    return { ok: false, message: "Ainda não leio áudio neste servidor. Escreva o pedido, por favor." };
  }

  const channel = await withOrgTx(input.orgId, (tx) => tx.query.supportWhatsAppChannels.findFirst({
    where: and(eq(schema.supportWhatsAppChannels.orgId, input.orgId), eq(schema.supportWhatsAppChannels.status, "active")),
    orderBy: [desc(schema.supportWhatsAppChannels.updatedAt)],
    columns: { id: true },
  }));
  const access = channel ? await loadWhatsAppChannelAccess({ orgId: input.orgId, channelId: channel.id }) : null;
  if (!access?.channel.phoneNumberId) return { ok: false, message: "Não consegui baixar o arquivo agora. Tente de novo ou escreva o pedido." };

  try {
    const media = await downloadWhatsAppMedia(
      {
        mediaId: input.mediaId,
        phoneNumberId: access.channel.phoneNumberId,
        accessToken: access.accessToken,
        allowedMimeTypes: kind === "audio" ? null : kind === "pdf" ? PDF_TYPES : AGENT_IMAGE_TYPES,
        maxBytes: kind === "audio" ? AUDIO_MAX_BYTES : kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES,
      },
      { graphApiVersion: getWhatsAppConfig().graphApiVersion },
      fetchImpl,
    );
    if (kind === "audio") {
      const mimeType = audioBaseMime(media.mimeType) ?? audioBaseMime(input.mimeType);
      const fileName = mimeType ? transcriptionFileName(mimeType) : null;
      if (!mimeType || !fileName) return { ok: false, message: "Não consegui ouvir esse formato de áudio. Grave de novo pelo WhatsApp ou escreva o pedido." };
      const text = await transcribeAudio({ bytes: media.bytes, mimeType, fileName }, { apiKey: transcription.apiKey!, model: transcription.model }, fetchImpl);
      return { ok: true, kind, text };
    }
    let attachment: MissionAttachment;
    if (kind === "pdf") {
      const pdf = await firstPdfPages(media.bytes, PDF_PAGES);
      if (!pdf) return { ok: false, message: "Não consegui abrir esse PDF. Mande uma foto da página ou escreva o pedido." };
      attachment = { kind: "pdf", data: Buffer.from(pdf.data).toString("base64") };
    } else {
      attachment = { kind: "image", data: Buffer.from(media.bytes).toString("base64"), mimeType: media.mimeType as Extract<MissionAttachment, { kind: "image" }>["mimeType"] };
    }
    const text = await readAttachment({ attachment, caption: input.caption });
    return { ok: true, kind, text };
  } catch (error) {
    console.error("Falha ao ler arquivo de integrante no WhatsApp", {
      orgId: input.orgId,
      kind,
      error: error instanceof Error ? error.message.slice(0, 200) : "erro desconhecido",
    });
    return { ok: false, message: "Não consegui ler o arquivo. Tente mandar de novo ou escreva o pedido." };
  }
}
