export type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  SendMessageOptions,
  TelegramApi,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./endpoint";

export type TelegramNotificationEventType =
  | "task_assigned"
  | "task_deadline"
  | "task_awaiting_approval"
  | "task_approved"
  | "task_rejected"
  | "xp_earned"
  | "closing_deadline"
  | "closing_blocked"
  | "campaign_progress"
  | "daily_summary";

/** Payload persistível na outbox; nenhuma credencial deve ser incluída. */
export type TelegramOutboxPayload = Readonly<{
  text: string;
  parseMode?: "HTML";
  replyMarkup?: import("./endpoint").InlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
}>;
