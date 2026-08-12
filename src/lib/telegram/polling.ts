import "server-only";

import { isTelegramUpdate, type TelegramUpdate } from "./endpoint";

type TelegramEnvelope<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

async function callTelegram<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const payload = (await response.json().catch(() => null)) as TelegramEnvelope<T> | null;
  if (!response.ok || payload?.ok !== true || payload.result === undefined) {
    throw new Error(
      `Telegram Bot API (${method}): ${payload?.description ?? response.statusText}`,
    );
  }
  return payload.result;
}

/** Remove um webhook antigo antes de ativar o long polling, sem perder updates. */
export async function disableTelegramWebhook(botToken: string): Promise<void> {
  await callTelegram<boolean>(
    botToken,
    "deleteWebhook",
    { drop_pending_updates: false },
    10_000,
  );
}

/** Remove do cliente Telegram o menu legado de comandos operacionais. */
export async function deleteTelegramCommands(botToken: string): Promise<void> {
  await callTelegram<boolean>(botToken, "deleteMyCommands", {}, 10_000);
}

/** Busca o próximo lote de updates com long polling da Bot API. */
export async function getTelegramUpdates(
  botToken: string,
  offset?: number,
  timeoutSeconds = 25,
): Promise<TelegramUpdate[]> {
  const timeout = Math.min(50, Math.max(0, Math.trunc(timeoutSeconds)));
  const result = await callTelegram<unknown[]>(
    botToken,
    "getUpdates",
    {
      ...(offset === undefined ? {} : { offset }),
      timeout,
      allowed_updates: ["message", "callback_query"],
    },
    (timeout + 10) * 1000,
  );
  if (!Array.isArray(result) || !result.every(isTelegramUpdate)) {
    throw new Error("Telegram Bot API (getUpdates): lote de updates inválido");
  }
  return result;
}
