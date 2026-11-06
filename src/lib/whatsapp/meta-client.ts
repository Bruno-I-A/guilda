import "server-only";

export type MetaServerConfig = Readonly<{
  appId: string;
  appSecret: string;
  graphApiVersion: string;
}>;

export type MetaPhoneNumber = Readonly<{
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  status?: string;
  isOnBusinessApp: boolean;
}>;

type MetaErrorPayload = {
  error?: { code?: number; type?: string };
};

export class MetaGraphError extends Error {
  constructor(
    readonly operation: "exchange_code" | "list_phones" | "subscribe_webhook",
    readonly httpStatus: number,
    readonly graphCode?: number,
    readonly graphType?: string,
  ) {
    super(`Meta Graph API falhou em ${operation}.`);
    this.name = "MetaGraphError";
  }
}

function graphUrl(config: MetaServerConfig, path: string): URL {
  return new URL(`https://graph.facebook.com/${config.graphApiVersion}${path}`);
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function graphError(
  operation: MetaGraphError["operation"],
  response: Response,
  payload: Record<string, unknown>,
): MetaGraphError {
  const error = (payload as MetaErrorPayload).error;
  return new MetaGraphError(operation, response.status, error?.code, error?.type);
}

export async function exchangeEmbeddedSignupCode(
  code: string,
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = graphUrl(config, "/oauth/access_token");
  url.search = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
    redirect_uri: "",
  }).toString();
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  const token = payload.access_token;
  if (!response.ok || typeof token !== "string" || token.length < 10) {
    throw graphError("exchange_code", response, payload);
  }
  return token;
}

export async function resolveCoexistencePhone(
  input: { wabaId: string; phoneNumberId?: string; accessToken: string },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaPhoneNumber> {
  const url = graphUrl(config, `/${input.wabaId}/phone_numbers`);
  url.search = new URLSearchParams({
    fields: "id,display_phone_number,verified_name,status,is_on_biz_app",
    limit: "100",
  }).toString();
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  if (!response.ok || !Array.isArray(payload.data)) {
    throw graphError("list_phones", response, payload);
  }
  const phones = payload.data
    .filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && !Array.isArray(value)),
    )
    .map((phone) => ({
      id: typeof phone.id === "string" ? phone.id : "",
      displayPhoneNumber:
        typeof phone.display_phone_number === "string"
          ? phone.display_phone_number.slice(0, 32)
          : undefined,
      verifiedName:
        typeof phone.verified_name === "string"
          ? phone.verified_name.slice(0, 255)
          : undefined,
      status: typeof phone.status === "string" ? phone.status.slice(0, 64) : undefined,
      isOnBusinessApp: phone.is_on_biz_app === true,
    }))
    .filter((phone) => /^\d{1,32}$/.test(phone.id));

  const candidates = input.phoneNumberId
    ? phones.filter((phone) => phone.id === input.phoneNumberId)
    : phones.filter((phone) => phone.isOnBusinessApp);
  if (candidates.length !== 1 || !candidates[0].isOnBusinessApp) {
    throw new MetaGraphError("list_phones", 409);
  }
  return candidates[0];
}

export async function subscribeWhatsAppWebhook(
  input: { wabaId: string; accessToken: string },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = graphUrl(config, `/${input.wabaId}/subscribed_apps`);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  if (!response.ok || payload.success !== true) {
    throw graphError("subscribe_webhook", response, payload);
  }
}
