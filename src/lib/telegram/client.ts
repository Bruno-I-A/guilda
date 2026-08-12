import "server-only";

import { getTelegramConfig } from "./config";
import { createTelegramApi, type TelegramApi } from "./endpoint";

/** Construtor explícito, útil para injeção de credenciais em jobs/testes. */
export const createTelegramClient = createTelegramApi;

/** Retorna null quando a integração ainda não foi configurada. */
export function getTelegramClient(): TelegramApi | null {
  const { botToken } = getTelegramConfig();
  return botToken ? createTelegramClient(botToken) : null;
}

export function requireTelegramClient(): TelegramApi {
  const client = getTelegramClient();
  if (!client) throw new Error("TELEGRAM_BOT_TOKEN não definido");
  return client;
}

let resolvedUsername: Promise<string | null> | undefined;

/** Resolve o @username via getMe quando ele não foi informado no ambiente. */
export function getTelegramBotUsername(): Promise<string | null> {
  const config = getTelegramConfig();
  if (config.botUsername && /^[A-Za-z0-9_]{5,32}$/.test(config.botUsername)) {
    return Promise.resolve(config.botUsername);
  }
  if (!config.botToken) return Promise.resolve(null);
  resolvedUsername ??= fetch(
    `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/getMe`,
    { cache: "no-store", signal: AbortSignal.timeout(5_000) },
  )
    .then(async (response) => {
      const body = (await response.json()) as {
        ok?: boolean;
        result?: { username?: unknown };
      };
      const username = body.ok ? body.result?.username : null;
      return typeof username === "string" && /^[A-Za-z0-9_]{5,32}$/.test(username)
        ? username
        : null;
    })
    .catch(() => null);
  return resolvedUsername;
}

/** Registra idempotentemente o webhook usando o domínio público da Guilda. */
export async function ensureTelegramWebhook(): Promise<boolean> {
  const config = getTelegramConfig();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!config.botToken || !config.webhookSecret || !appUrl) return false;
  const webhookUrl = new URL("/api/telegram/webhook", appUrl).toString();
  if (new URL(webhookUrl).protocol !== "https:" && process.env.NODE_ENV === "production") {
    return false;
  }
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/setWebhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: config.webhookSecret,
        allowed_updates: ["message", "callback_query"],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
  return response.ok && body?.ok === true;
}
