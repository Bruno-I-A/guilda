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

let cachedUsername:
  | { botToken: string; username: string }
  | undefined;
let usernameRequest:
  | { botToken: string; promise: Promise<string | null> }
  | undefined;

/** Resolve o @username via getMe quando ele não foi informado no ambiente. */
export async function getTelegramBotUsername(): Promise<string | null> {
  const config = getTelegramConfig();
  if (config.botUsername && /^[A-Za-z0-9_]{5,32}$/.test(config.botUsername)) {
    return config.botUsername;
  }
  if (!config.botToken) return null;
  if (cachedUsername?.botToken === config.botToken) return cachedUsername.username;

  if (usernameRequest?.botToken !== config.botToken) {
    usernameRequest = {
      botToken: config.botToken,
      promise: fetch(
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
        .catch(() => null),
    };
  }

  const request = usernameRequest;
  const username = await request.promise;
  if (username) cachedUsername = { botToken: config.botToken, username };
  // Uma falha transitória não deve desativar o botão até o processo reiniciar.
  if (usernameRequest === request) usernameRequest = undefined;
  return username;
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
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;
  const registered = response.ok && body?.ok === true;
  if (!registered) {
    console.error("Telegram rejeitou o registro do webhook", {
      status: response.status,
      description: body?.description ?? "resposta inválida",
      webhookUrl,
    });
  }
  return registered;
}
