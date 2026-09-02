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
  | "task_clan_created"
  | "task_deadline"
  | "task_overdue"
  | "task_awaiting_approval"
  | "task_completed"
  | "task_approved"
  | "task_rejected"
  | "task_cancelled"
  | "task_transferred"
  | "task_transferred_in"
  | "task_transferred_out"
  | "xp_earned"
  | "closing_deadline"
  | "closing_blocked"
  | "campaign_progress"
  | "daily_summary";

/** Payload persistível na outbox; nenhuma credencial deve ser incluída. */
export type TelegramOutboxPayload = Readonly<{
  text: string;
  replyMarkup?: import("./endpoint").InlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
}>;
