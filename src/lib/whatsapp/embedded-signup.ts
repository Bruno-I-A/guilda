export type EmbeddedSignupClientConfig = Readonly<{
  appId: string;
  configId: string;
  graphApiVersion: string;
  featureType: "whatsapp_business_app_onboarding";
  sessionInfoVersion: "3";
}>;

export type EmbeddedSignupSessionInfo = Readonly<{
  type: "WA_EMBEDDED_SIGNUP";
  event: "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
  data: Readonly<{
    waba_id: string;
    phone_number_id?: string;
  }>;
}>;

const META_ID = /^\d{1,32}$/;

/** Aceita apenas mensagens HTTPS do domínio real da Meta. */
export function isTrustedFacebookOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"))
    );
  } catch {
    return false;
  }
}

/**
 * A janela recebe outros postMessages do SDK. Só o evento final, com os IDs
 * mínimos validados, pode seguir para o servidor.
 */
export function parseEmbeddedSignupMessage(
  value: unknown,
): EmbeddedSignupSessionInfo | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.type !== "WA_EMBEDDED_SIGNUP") return null;
  if (
    record.event !== "FINISH" &&
    record.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
  ) {
    return null;
  }
  if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  if (typeof data.waba_id !== "string" || !META_ID.test(data.waba_id)) return null;
  if (
    data.phone_number_id !== undefined &&
    (typeof data.phone_number_id !== "string" || !META_ID.test(data.phone_number_id))
  ) {
    return null;
  }
  return {
    type: "WA_EMBEDDED_SIGNUP",
    event: record.event,
    data: {
      waba_id: data.waba_id,
      ...(typeof data.phone_number_id === "string"
        ? { phone_number_id: data.phone_number_id }
        : {}),
    },
  };
}

/** Payload público recomendado pelo exemplo Tech Provider oficial da Meta. */
export function embeddedSignupLoginOptions(config: EmbeddedSignupClientConfig) {
  return {
    config_id: config.configId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      featureType: config.featureType,
      sessionInfoVersion: config.sessionInfoVersion,
    },
  } as const;
}
