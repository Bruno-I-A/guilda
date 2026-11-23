import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { AUDIO_MAX_BYTES, audioBaseMime, transcriptionFileName } from "@/domain/support-audio";
import { loadWhatsAppChannelAccess } from "@/lib/whatsapp/channel-repository";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { downloadWhatsAppMedia } from "@/lib/whatsapp/meta-client";

/**
 * Transcrição dos áudios recebidos (2026-11-23, pedido do Bruno): todo áudio de
 * cliente vira texto pela OpenAI, como no Scharff (`gpt-4o-mini-transcribe`,
 * com o vocabulário contábil). Sem OPENAI_API_KEY, nada sai e o áudio só se ouve.
 */

const DEFAULT_MODEL = "gpt-4o-mini-transcribe";
const TIMEOUT_MS = 60_000;
const MAX_TEXT = 24_000;
const MAX_ATTEMPTS = 3;
/** A Meta guarda a mídia por um tempo: áudio mais velho que isso não se busca mais. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PROMPT =
  "Transcreva em português do Brasil. Contexto: atendimento de escritório de contabilidade. " +
  "Preserve termos como DAS, DCTFWeb, eSocial, Simples Nacional, Lucro Presumido, ICMS, ISS, " +
  "INSS, CNPJ, CPF, folha de pagamento, pró-labore, FGTS, parcelamento e nota fiscal.";

export type TranscriptionStatus = "pending" | "processing" | "done" | "failed" | "unavailable";

export function transcriptionConfig(): { apiKey: string | null; model: string } {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || null,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function isTranscriptionEnabled(): boolean {
  return transcriptionConfig().apiKey !== null;
}

/** Chama a OpenAI. Erro da API vira exceção com status e mensagem, nunca com a chave. */
export async function transcribeAudio(
  input: { bytes: ArrayBuffer; mimeType: string; fileName: string },
  config: { apiKey: string; model: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName);
  form.set("model", config.model);
  form.set("language", "pt");
  form.set("prompt", PROMPT);
  form.set("response_format", "json");
  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { text?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok) {
    const message = typeof body?.error?.message === "string" ? body.error.message.slice(0, 300) : "sem detalhe";
    throw new Error(`OpenAI ${response.status}: ${message}`);
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("A OpenAI respondeu sem texto.");
  return text.slice(0, MAX_TEXT);
}

type Pending = { messageId: string; channelId: string; mediaId: string; mimeType: string | null };

/** Áudios de cliente sem transcrição pronta, recentes o bastante para a Meta ainda ter o arquivo. */
async function findPending(tx: OrgTx, orgId: string, now: Date, limit: number): Promise<Pending[]> {
  const m = schema.supportMessages;
  const t = schema.supportMessageTranscriptions;
  const rows = await tx
    .select({ messageId: m.id, channelId: m.channelId, content: m.content })
    .from(m)
    .leftJoin(t, and(eq(t.orgId, m.orgId), eq(t.messageId, m.id)))
    .where(
      and(
        eq(m.orgId, orgId),
        eq(m.direction, "inbound"),
        eq(m.messageType, "audio"),
        sql`${m.occurredAt} > ${new Date(now.getTime() - MAX_AGE_MS).toISOString()}::timestamptz`,
        sql`(${t.id} IS NULL OR ${t.status} = 'pending' OR (${t.status} = 'failed' AND ${t.attempts} < ${MAX_ATTEMPTS} AND ${t.updatedAt} < ${new Date(now.getTime() - 2 * 60_000).toISOString()}::timestamptz) OR (${t.status} = 'processing' AND ${t.updatedAt} < ${new Date(now.getTime() - 5 * 60_000).toISOString()}::timestamptz))`,
      ),
    )
    .orderBy(asc(m.occurredAt))
    .limit(limit);
  return rows.flatMap((row) => {
    const mediaId = row.content.id;
    if (typeof mediaId !== "string" || !/^\d{1,32}$/.test(mediaId)) return [];
    return [{ messageId: row.messageId, channelId: row.channelId, mediaId, mimeType: typeof row.content.mime_type === "string" ? row.content.mime_type : null }];
  });
}

/**
 * Reserva a mensagem: a linha "processing" impede que outro processo transcreva
 * junto. Só retoma "processing" esquecido (processo que caiu) depois de 5 minutos.
 */
async function claim(orgId: string, messageId: string, model: string, now: Date): Promise<boolean> {
  return withOrgTx(orgId, async (tx) => {
    const t = schema.supportMessageTranscriptions;
    await tx.insert(t).values({ orgId, messageId, status: "pending", model }).onConflictDoNothing();
    const stale = new Date(now.getTime() - 5 * 60_000).toISOString();
    const claimed = await tx
      .update(t)
      .set({ status: "processing", attempts: sql`${t.attempts} + 1`, error: null, model, updatedAt: new Date() })
      .where(
        and(
          eq(t.orgId, orgId),
          eq(t.messageId, messageId),
          sql`(${t.status} = 'pending' OR (${t.status} = 'failed' AND ${t.attempts} < ${MAX_ATTEMPTS}) OR (${t.status} = 'processing' AND ${t.updatedAt} < ${stale}::timestamptz))`,
        ),
      )
      .returning({ id: t.id });
    return claimed.length > 0;
  });
}

async function finish(orgId: string, messageId: string, result: { status: "done"; text: string } | { status: "failed" | "unavailable"; error: string }) {
  await withOrgTx(orgId, (tx) =>
    tx
      .update(schema.supportMessageTranscriptions)
      .set({
        status: result.status,
        text: result.status === "done" ? result.text : null,
        error: result.status === "done" ? null : result.error.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.supportMessageTranscriptions.orgId, orgId), eq(schema.supportMessageTranscriptions.messageId, messageId))),
  );
}

async function transcribeOne(orgId: string, item: Pending, config: { apiKey: string; model: string }, fetchImpl: typeof fetch) {
  const access = await loadWhatsAppChannelAccess({ orgId, channelId: item.channelId });
  if (!access?.channel.phoneNumberId) return finish(orgId, item.messageId, { status: "failed", error: "Canal do WhatsApp sem acesso." });
  try {
    const media = await downloadWhatsAppMedia(
      { mediaId: item.mediaId, phoneNumberId: access.channel.phoneNumberId, accessToken: access.accessToken, allowedMimeTypes: null, maxBytes: AUDIO_MAX_BYTES },
      { graphApiVersion: getWhatsAppConfig().graphApiVersion },
      fetchImpl,
    );
    const mimeType = audioBaseMime(media.mimeType) ?? audioBaseMime(item.mimeType);
    const fileName = mimeType ? transcriptionFileName(mimeType) : null;
    if (!mimeType || !fileName) return finish(orgId, item.messageId, { status: "unavailable", error: `Formato de áudio que a transcrição não lê (${media.mimeType}).` });
    const text = await transcribeAudio({ bytes: media.bytes, mimeType, fileName }, config, fetchImpl);
    return finish(orgId, item.messageId, { status: "done", text });
  } catch (error) {
    return finish(orgId, item.messageId, { status: "failed", error: error instanceof Error ? error.message : "Falha desconhecida na transcrição." });
  }
}

export async function runSupportTranscriptionCycle(input: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {}): Promise<{ transcribed: number }> {
  const { apiKey, model } = transcriptionConfig();
  if (!apiKey) return { transcribed: 0 };
  const now = input.now ?? new Date();
  const organizations = await db.select({ id: schema.organization.id }).from(schema.organization).orderBy(asc(schema.organization.id));
  let transcribed = 0;
  for (const { id: orgId } of organizations) {
    const pending = await withOrgTx(orgId, (tx) => findPending(tx, orgId, now, input.limit ?? 5));
    for (const item of pending) {
      if (!(await claim(orgId, item.messageId, model, now))) continue;
      await transcribeOne(orgId, item, { apiKey, model }, input.fetchImpl ?? fetch);
      transcribed += 1;
    }
  }
  return { transcribed };
}

/** Transcrições das mensagens pedidas, para a conversa e para o turno da IA. */
export async function loadTranscriptions(
  tx: OrgTx,
  orgId: string,
  messageIds: readonly string[],
): Promise<Map<string, { status: TranscriptionStatus; text: string | null }>> {
  if (messageIds.length === 0) return new Map();
  const t = schema.supportMessageTranscriptions;
  const rows = await tx
    .select({ messageId: t.messageId, status: t.status, text: t.text })
    .from(t)
    .where(and(eq(t.orgId, orgId), inArray(t.messageId, [...messageIds])));
  return new Map(rows.map((row) => [row.messageId, { status: row.status as TranscriptionStatus, text: row.text }]));
}
