import "server-only";

import type { EmbeddedSignupClientConfig } from "./embedded-signup";

export type { EmbeddedSignupClientConfig } from "./embedded-signup";

export type WhatsAppConfig = Readonly<{
  appId?: string;
  appSecret?: string;
  embeddedSignupConfigId?: string;
  graphApiVersion: string;
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
  const configuredVersion = optionalEnv(process.env.WHATSAPP_GRAPH_API_VERSION);
  return {
    appId: optionalEnv(process.env.WHATSAPP_APP_ID),
    appSecret: optionalEnv(process.env.WHATSAPP_APP_SECRET),
    embeddedSignupConfigId: optionalEnv(
      process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
    ),
    graphApiVersion:
      configuredVersion && /^v\d+\.\d+$/.test(configuredVersion)
        ? configuredVersion
        : "v24.0",
    webhookVerifyToken: optionalEnv(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
  };
}

export function isWhatsAppWebhookConfigured(): boolean {
  const config = getWhatsAppConfig();
  return Boolean(config.appSecret && config.webhookVerifyToken);
}

/** Somente dados públicos necessários para inicializar o SDK no browser. */
export function getEmbeddedSignupClientConfig(): EmbeddedSignupClientConfig | null {
  const config = getWhatsAppConfig();
  if (!config.appId || !config.embeddedSignupConfigId) return null;
  return {
    appId: config.appId,
    configId: config.embeddedSignupConfigId,
    graphApiVersion: config.graphApiVersion,
    featureType: "whatsapp_business_app_onboarding",
    sessionInfoVersion: "3",
  };
}
