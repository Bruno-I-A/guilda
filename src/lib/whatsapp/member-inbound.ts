/**
 * Mensagens que um integrante manda ao WhatsApp do escritório (2026-11-24).
 *
 * O Atendimento lê o mesmo webhook, mas aqui interessa o que a pessoa quer da
 * Guilda: um texto (pedido de missão, código de confirmação), um áudio, foto
 * ou PDF com o pedido, ou um toque em botão. O botão chega de dois jeitos:
 * resposta rápida de modelo (`type: button`, com o `payload` que mandamos) e
 * resposta de mensagem interativa (`interactive.button_reply.id`).
 */

type JsonRecord = Record<string, unknown>;

/** Arquivo que o integrante mandou (2026-11-24): fica na Meta; aqui só o id. */
export type MemberMedia = Readonly<{
  id: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}>;

export type MemberInbound = Readonly<{
  externalId: string;
  from: string;
  occurredAt: Date;
  messageType: string;
  kind: "text" | "button" | "media" | "other";
  text?: string;
  buttonId?: string;
  media?: MemberMedia;
}>;

/** O que a Guilda lê de arquivo: áudio (transcrição), foto e PDF (leitura pela IA). */
const MEDIA_TYPES = new Set(["audio", "image", "document"]);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asString(value: unknown, max = 255): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

function occurredAt(value: unknown): Date {
  const seconds = typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : NaN;
  const date = Number.isSafeInteger(seconds) ? new Date(seconds * 1000) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function parseMemberInbound(payload: JsonRecord): MemberInbound[] {
  if (!Array.isArray(payload.messages)) return [];
  const result: MemberInbound[] = [];
  for (const value of payload.messages) {
    const message = asRecord(value);
    const externalId = asString(message?.id);
    const from = asString(message?.from, 32);
    if (!message || !externalId || !from || !/^\d{1,32}$/.test(from)) continue;
    const messageType = asString(message.type, 40) ?? "unknown";
    const base = { externalId, from, occurredAt: occurredAt(message.timestamp), messageType };
    if (messageType === "text") {
      const text = asString(asRecord(message.text)?.body, 4_000);
      result.push(text ? { ...base, kind: "text", text } : { ...base, kind: "other" });
    } else if (messageType === "button") {
      const button = asRecord(message.button);
      const buttonId = asString(button?.payload);
      result.push(buttonId ? { ...base, kind: "button", buttonId, ...(asString(button?.text, 40) ? { text: asString(button?.text, 40) } : {}) } : { ...base, kind: "other" });
    } else if (messageType === "interactive") {
      const reply = asRecord(asRecord(message.interactive)?.button_reply);
      const buttonId = asString(reply?.id);
      result.push(buttonId ? { ...base, kind: "button", buttonId, ...(asString(reply?.title, 40) ? { text: asString(reply?.title, 40) } : {}) } : { ...base, kind: "other" });
    } else if (MEDIA_TYPES.has(messageType)) {
      const content = asRecord(message[messageType]);
      const id = asString(content?.id, 64);
      if (!id || !/^\d{1,32}$/.test(id)) {
        result.push({ ...base, kind: "other" });
        continue;
      }
      const mimeType = asString(content?.mime_type, 120);
      const caption = asString(content?.caption, 2_000);
      const filename = asString(content?.filename, 255);
      result.push({
        ...base,
        kind: "media",
        media: { id, ...(mimeType ? { mimeType } : {}), ...(caption ? { caption } : {}), ...(filename ? { filename } : {}) },
      });
    } else {
      result.push({ ...base, kind: "other" });
    }
  }
  return result;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type MemberButton =
  | Readonly<{ type: "task"; action: "start" | "approve"; taskId: string }>
  | Readonly<{ type: "draft"; decision: "confirm" | "cancel"; draftId: string }>
  | Readonly<{ type: "mission"; decision: "confirm" | "cancel"; draftId: string }>;

/** O id do botão volta do celular: nada além destes formatos é aceito. */
export function parseMemberButton(id: string | undefined | null): MemberButton | null {
  if (!id) return null;
  const task = new RegExp(`^task:(start|approve):(${UUID})$`, "i").exec(id);
  if (task) return { type: "task", action: task[1].toLowerCase() as "start" | "approve", taskId: task[2].toLowerCase() };
  const draft = new RegExp(`^draft:(confirm|cancel):(${UUID})$`, "i").exec(id);
  if (draft) return { type: "draft", decision: draft[1].toLowerCase() as "confirm" | "cancel", draftId: draft[2].toLowerCase() };
  const mission = new RegExp(`^mission:(confirm|cancel):(${UUID})$`, "i").exec(id);
  if (mission) return { type: "mission", decision: mission[1].toLowerCase() as "confirm" | "cancel", draftId: mission[2].toLowerCase() };
  return null;
}

/** Botão da prévia de missão avulsa (quem não lidera clã). */
export function missionButtonId(decision: "confirm" | "cancel", draftId: string): string {
  return `mission:${decision}:${draftId}`;
}

export function draftButtonId(decision: "confirm" | "cancel", draftId: string): string {
  return `draft:${decision}:${draftId}`;
}
