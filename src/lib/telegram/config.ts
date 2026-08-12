import "server-only";

import { createHash } from "node:crypto";

export type TelegramConfig = Readonly<{
  botToken?: string;
  botUsername?: string;
  webhookSecret?: string;
}>;

function optionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * Configuração avaliada em runtime. TELEGRAM_BOT_TOKEN é deliberadamente
 * opcional para que build, testes e ambientes sem integração continuem ativos.
 */
export function getTelegramConfig(): TelegramConfig {
  const botToken = optionalEnv(process.env.TELEGRAM_BOT_TOKEN);
  const explicitWebhookSecret = optionalEnv(process.env.TELEGRAM_WEBHOOK_SECRET);
  const appSecret = optionalEnv(process.env.BETTER_AUTH_SECRET);
  return {
    botToken,
    botUsername: optionalEnv(process.env.TELEGRAM_BOT_USERNAME)?.replace(/^@/, ""),
    webhookSecret:
      explicitWebhookSecret ??
      (botToken && appSecret
        ? createHash("sha256")
            .update(`guilda:telegram:webhook:${appSecret}:${botToken}`)
            .digest("hex")
        : undefined),
  };
}

export function isTelegramConfigured(): boolean {
  return Boolean(getTelegramConfig().botToken);
}
