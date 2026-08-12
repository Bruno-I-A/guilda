export type TelegramPreferenceKey =
  | "tasks"
  | "approvals"
  | "deadlines"
  | "xp"
  | "closings"
  | "campaigns"
  | "daily_summary";

export interface TelegramNotificationButton {
  text: string;
  url?: string;
  callbackData?: string;
}

/** Payload pequeno e versionado, persistido no outbox antes do envio. */
export interface TelegramNotificationPayload extends Record<string, unknown> {
  version: 1;
  text: string;
  preference: TelegramPreferenceKey;
  keyboard?: TelegramNotificationButton[][];
}

export function isTelegramNotificationPayload(
  value: unknown,
): value is TelegramNotificationPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (
    payload.version !== 1 ||
    typeof payload.text !== "string" ||
    payload.text.length === 0 ||
    payload.text.length > 4096 ||
    ![
      "tasks",
      "approvals",
      "deadlines",
      "xp",
      "closings",
      "campaigns",
      "daily_summary",
    ].includes(String(payload.preference))
  ) {
    return false;
  }

  if (payload.keyboard === undefined) return true;
  if (!Array.isArray(payload.keyboard) || payload.keyboard.length > 8) return false;
  return payload.keyboard.every(
    (row) =>
      Array.isArray(row) &&
      row.length > 0 &&
      row.length <= 8 &&
      row.every(
        (button) =>
          typeof button === "object" &&
          button !== null &&
          typeof (button as TelegramNotificationButton).text === "string" &&
          ((typeof (button as TelegramNotificationButton).url === "string" &&
            (button as TelegramNotificationButton).callbackData === undefined) ||
            (typeof (button as TelegramNotificationButton).callbackData === "string" &&
              (button as TelegramNotificationButton).url === undefined)),
      ),
  );
}

export function appUrl(path: string, baseUrl?: string): string {
  if (!baseUrl) return path;
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export function taskUrl(taskId: string, baseUrl?: string): string {
  return appUrl(`/tasks/${taskId}`, baseUrl);
}

export function dueDateLabel(dueDate: Date | null): string {
  if (!dueDate) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(dueDate);
}
