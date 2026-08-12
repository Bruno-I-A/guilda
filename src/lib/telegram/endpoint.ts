export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  if (!value || typeof value !== "object") return false;
  const updateId = (value as Record<string, unknown>).update_id;
  return (
    typeof updateId === "number" &&
    Number.isSafeInteger(updateId) &&
    updateId >= 0
  );
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  replyMarkup?: InlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
  parseMode?: "HTML";
}

export interface TelegramApi {
  sendMessage(
    chatId: number | string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<void>;
  answerCallbackQuery(
    callbackQueryId: string,
    options?: { text?: string; showAlert?: boolean },
  ): Promise<void>;
}

type TelegramApiEnvelope = {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
};

/** Cliente HTTP mínimo da Bot API. O token permanece exclusivamente no servidor. */
export function createTelegramApi(botToken: string): TelegramApi {
  const call = async (method: string, body: Record<string, unknown>): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(botToken)}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as TelegramApiEnvelope | null;
      if (response.ok && payload?.ok) return;
      const retryAfter = payload?.parameters?.retry_after;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 3) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10, Math.max(1, retryAfter ?? attempt)) * 1000),
        );
        continue;
      }
      throw new Error(
        `Telegram Bot API (${method}): ${payload?.description ?? response.statusText}`,
      );
    }
  };

  return {
    sendMessage: (chatId, text, options) =>
      call("sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: options?.disableWebPagePreview ?? true,
        ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
        ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      }),
    answerCallbackQuery: (callbackQueryId, options) =>
      call("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        ...(options?.text ? { text: options.text } : {}),
        ...(options?.showAlert ? { show_alert: true } : {}),
      }),
  };
}

export type BotCommand =
  | "start"
  | "minhas"
  | "hoje"
  | "atrasadas"
  | "aprovar"
  | "ranking"
  | "perfil"
  | "fechamentos"
  | "bloqueados"
  | "campanhas"
  | "informativo"
  | "rejeitar"
  | "cancelar"
  | "ajuda";

const KNOWN_COMMANDS = new Set<BotCommand>([
  "start",
  "minhas",
  "hoje",
  "atrasadas",
  "aprovar",
  "ranking",
  "perfil",
  "fechamentos",
  "bloqueados",
  "campanhas",
  "informativo",
  "rejeitar",
  "cancelar",
  "ajuda",
]);

/** Aceita `/comando`, `/comando@MeuBot` e um argumento opcional. */
export function parseBotCommand(
  text: string,
): { command: BotCommand; argument?: string } | null {
  const match = text.trim().match(/^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  const command = match[1].toLocaleLowerCase("en-US") as BotCommand;
  if (!KNOWN_COMMANDS.has(command)) return null;
  const argument = match[2]?.trim();
  return { command, ...(argument ? { argument } : {}) };
}

export const TASK_CALLBACK_ACTIONS = [
  "start",
  "submit",
  "complete",
  "approve",
  "reject",
  "cancel",
] as const;
export type TaskCallbackAction = (typeof TASK_CALLBACK_ACTIONS)[number];

const CALLBACK_CODES: Record<TaskCallbackAction, string> = {
  start: "s",
  submit: "u",
  complete: "c",
  approve: "a",
  reject: "r",
  cancel: "x",
};
const CALLBACK_ACTIONS = new Map(
  Object.entries(CALLBACK_CODES).map(([action, code]) => [code, action as TaskCallbackAction]),
);

function uuidToBase64Url(uuid: string): string {
  const hex = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("UUID de tarefa inválido");
  return Buffer.from(hex, "hex").toString("base64url");
}

function base64UrlToUuid(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const hex = Buffer.from(value, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 26 bytes, confortavelmente abaixo do limite de 64 bytes do Telegram. */
export function encodeTaskCallback(action: TaskCallbackAction, taskId: string): string {
  return `t:${CALLBACK_CODES[action]}:${uuidToBase64Url(taskId)}`;
}

export function parseTaskCallback(
  data: string,
): { action: TaskCallbackAction; taskId: string } | null {
  const match = data.match(/^t:([sucarx]):([A-Za-z0-9_-]{22})$/);
  if (!match) return null;
  const action = CALLBACK_ACTIONS.get(match[1]);
  const taskId = base64UrlToUuid(match[2]);
  return action && taskId ? { action, taskId } : null;
}

export type DraftCallbackAction = "confirm" | "cancel";

export function encodeDraftCallback(
  action: DraftCallbackAction,
  draftId: string,
): string {
  return `i:${action === "confirm" ? "c" : "x"}:${uuidToBase64Url(draftId)}`;
}

export function parseDraftCallback(
  data: string,
): { action: DraftCallbackAction; draftId: string } | null {
  const match = data.match(/^i:([cx]):([A-Za-z0-9_-]{22})$/);
  if (!match) return null;
  const draftId = base64UrlToUuid(match[2]);
  if (!draftId) return null;
  return { action: match[1] === "c" ? "confirm" : "cancel", draftId };
}
