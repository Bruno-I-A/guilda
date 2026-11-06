import "server-only";

export type WhatsAppConfig = Readonly<{
  appSecret?: string;
  webhookVerifyToken?: string;
}>;

function optionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * Segredos globais do app Meta. Tokens de cada número ficam cifrados no
 * banco; nenhum deles é exposto ao browser ou incluído em logs.
 */
export function getWhatsAppConfig(): WhatsAppConfig {
  return {
    appSecret: optionalEnv(process.env.WHATSAPP_APP_SECRET),
    webhookVerifyToken: optionalEnv(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
  };
}

export function isWhatsAppWebhookConfigured(): boolean {
  const config = getWhatsAppConfig();
  return Boolean(config.appSecret && config.webhookVerifyToken);
}
