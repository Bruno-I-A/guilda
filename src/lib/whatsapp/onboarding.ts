import "server-only";

import {
  getEmbeddedSignupClientConfig,
  getWhatsAppConfig,
  type EmbeddedSignupClientConfig,
} from "./config";
import {
  activateWhatsAppChannel,
  loadWhatsAppChannelAccess,
  persistPendingWhatsAppChannel,
  type WhatsAppChannelSummary,
} from "./channel-repository";
import {
  exchangeEmbeddedSignupCode,
  resolveEmbeddedSignupWabaId,
  resolveCoexistencePhone,
  subscribeWhatsAppWebhook,
  type MetaServerConfig,
} from "./meta-client";
import { isWhatsAppTokenVaultConfigured } from "./token-vault";

type OnboardingServerConfig = MetaServerConfig &
  Readonly<{
    webhookCallbackUrl: string;
    webhookVerifyToken: string;
  }>;

export class WhatsAppOnboardingActivationError extends Error {
  constructor(
    readonly channel: WhatsAppChannelSummary,
    options?: ErrorOptions,
  ) {
    super("Canal salvo, mas a assinatura do webhook falhou.", options);
    this.name = "WhatsAppOnboardingActivationError";
  }
}

function serverConfig(): OnboardingServerConfig | null {
  const config = getWhatsAppConfig();
  return config.appId &&
    config.appSecret &&
    config.webhookCallbackUrl &&
    config.webhookVerifyToken
    ? {
        appId: config.appId,
        appSecret: config.appSecret,
        graphApiVersion: config.graphApiVersion,
        webhookCallbackUrl: config.webhookCallbackUrl,
        webhookVerifyToken: config.webhookVerifyToken,
      }
    : null;
}

/** Só libera o popup quando todo o caminho de volta está configurado. */
export function getReadyEmbeddedSignupConfig(): EmbeddedSignupClientConfig | null {
  const config = getWhatsAppConfig();
  const clientConfig = getEmbeddedSignupClientConfig();
  return clientConfig &&
    config.appSecret &&
    config.webhookCallbackUrl &&
    config.webhookVerifyToken &&
    isWhatsAppTokenVaultConfigured()
    ? clientConfig
    : null;
}

export async function completeEmbeddedSignup(input: {
  orgId: string;
  userId: string;
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
}): Promise<WhatsAppChannelSummary> {
  const config = serverConfig();
  if (!config || !getReadyEmbeddedSignupConfig()) {
    throw new Error("Onboarding do WhatsApp não configurado.");
  }
  const accessToken = await exchangeEmbeddedSignupCode(input.code, config);
  const wabaId =
    input.wabaId ?? (await resolveEmbeddedSignupWabaId(accessToken, config));
  const phone = await resolveCoexistencePhone(
    {
      wabaId,
      ...(input.phoneNumberId ? { phoneNumberId: input.phoneNumberId } : {}),
      accessToken,
    },
    config,
  );
  const channel = await persistPendingWhatsAppChannel({
    orgId: input.orgId,
    userId: input.userId,
    wabaId,
    phone,
    accessToken,
  });
  try {
    await subscribeWhatsAppWebhook(
      {
        wabaId,
        accessToken,
        overrideCallbackUrl: config.webhookCallbackUrl,
        verifyToken: config.webhookVerifyToken,
      },
      config,
    );
  } catch (error) {
    throw new WhatsAppOnboardingActivationError(channel, { cause: error });
  }
  const active = await activateWhatsAppChannel(input.orgId, channel.id);
  if (!active) throw new Error("Canal do WhatsApp não encontrado apó onboarding.");
  return active;
}

export async function retryWhatsAppChannelActivation(input: {
  orgId: string;
  channelId: string;
}): Promise<WhatsAppChannelSummary | null> {
  const config = serverConfig();
  if (!config || !getReadyEmbeddedSignupConfig()) {
    throw new Error("Onboarding do WhatsApp não configurado.");
  }
  const access = await loadWhatsAppChannelAccess(input);
  if (!access) return null;
  await subscribeWhatsAppWebhook(
    {
      wabaId: access.channel.wabaId,
      accessToken: access.accessToken,
      overrideCallbackUrl: config.webhookCallbackUrl,
      verifyToken: config.webhookVerifyToken,
    },
    config,
  );
  return activateWhatsAppChannel(input.orgId, input.channelId);
}
