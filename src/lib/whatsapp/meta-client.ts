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
    readonly operation:
      | "exchange_code"
      | "resolve_waba"
      | "list_phones"
      | "subscribe_webhook"
      | "send_message"
      | "get_media_url"
      | "download_media",
    readonly httpStatus: number,
    readonly graphCode?: number,
    readonly graphType?: string,
  ) {
    super(`Meta Graph API falhou em ${operation}.`);
    this.name = "MetaGraphError";
  }
}

function graphUrl(
  config: Pick<MetaServerConfig, "graphApiVersion">,
  path: string,
): URL {
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

/**
 * Descobre o WABA autorizado quando a Meta v5 devolve o code sem publicar o
 * evento WA_EMBEDDED_SIGNUP. Nunca escolhe arbitrariamente entre contas.
 */
export async function resolveEmbeddedSignupWabaId(
  accessToken: string,
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = graphUrl(config, "/debug_token");
  url.search = new URLSearchParams({
    input_token: accessToken,
    access_token: `${config.appId}|${config.appSecret}`,
  }).toString();
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  const data = payload.data;
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data)) {
    throw graphError("resolve_waba", response, payload);
  }

  const granularScopes = (data as Record<string, unknown>).granular_scopes;
  const wabaIds = new Set<string>();
  if (Array.isArray(granularScopes)) {
    for (const value of granularScopes) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const scope = value as Record<string, unknown>;
      if (
        scope.scope !== "whatsapp_business_management" ||
        !Array.isArray(scope.target_ids)
      ) {
        continue;
      }
      for (const targetId of scope.target_ids) {
        if (typeof targetId === "string" && /^\d{1,32}$/.test(targetId)) {
          wabaIds.add(targetId);
        }
      }
    }
  }
  if (wabaIds.size !== 1) {
    throw new MetaGraphError("resolve_waba", 409);
  }
  return [...wabaIds][0];
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

/** Envia texto pela Cloud API e devolve o id da mensagem na Meta (wamid). */
export async function sendWhatsAppText(
  input: { phoneNumberId: string; accessToken: string; to: string; text: string },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = graphUrl(config, `/${input.phoneNumberId}/messages`);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { preview_url: false, body: input.text },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  const sent = Array.isArray(payload.messages) ? (payload.messages[0] as { id?: unknown } | undefined) : undefined;
  if (!response.ok || typeof sent?.id !== "string") {
    throw graphError("send_message", response, payload);
  }
  return sent.id;
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export type WhatsAppImage = Readonly<{
  bytes: ArrayBuffer;
  mimeType: "image/jpeg" | "image/png";
}>;

function isMetaMediaHost(hostname: string): boolean {
  return (
    hostname === "lookaside.fbsbx.com" ||
    hostname.endsWith(".fbsbx.com") ||
    hostname.endsWith(".fbcdn.net") ||
    hostname.endsWith(".facebook.com")
  );
}

/**
 * Resolve a URL temporária da Meta e baixa uma foto recebida. O token fica
 * somente no servidor e a URL retornada pela Graph nunca chega ao navegador.
 */
export async function downloadWhatsAppImage(
  input: {
    mediaId: string;
    phoneNumberId: string;
    accessToken: string;
  },
  config: Pick<MetaServerConfig, "graphApiVersion">,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppImage> {
  if (!/^\d{1,32}$/.test(input.mediaId)) {
    throw new MetaGraphError("get_media_url", 400);
  }
  const metadataUrl = graphUrl(config, `/${input.mediaId}`);
  metadataUrl.search = new URLSearchParams({
    phone_number_id: input.phoneNumberId,
  }).toString();
  const auth = { authorization: `Bearer ${input.accessToken}` };
  const metadataResponse = await fetchImpl(metadataUrl, {
    method: "GET",
    headers: auth,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const metadata = await responsePayload(metadataResponse);
  const mediaUrlValue = metadata.url;
  const mimeType = metadata.mime_type;
  const fileSize = metadata.file_size;
  if (
    !metadataResponse.ok ||
    typeof mediaUrlValue !== "string" ||
    typeof mimeType !== "string" ||
    !IMAGE_MIME_TYPES.has(mimeType) ||
    typeof fileSize !== "number" ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0 ||
    fileSize > MAX_IMAGE_BYTES
  ) {
    throw graphError("get_media_url", metadataResponse, metadata);
  }

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(mediaUrlValue);
  } catch {
    throw new MetaGraphError("download_media", 502);
  }
  if (mediaUrl.protocol !== "https:" || !isMetaMediaHost(mediaUrl.hostname)) {
    throw new MetaGraphError("download_media", 502);
  }

  const mediaResponse = await fetchImpl(mediaUrl, {
    method: "GET",
    headers: auth,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const declaredLength = Number(mediaResponse.headers.get("content-length") ?? "0");
  if (
    !mediaResponse.ok ||
    (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES)
  ) {
    throw new MetaGraphError("download_media", mediaResponse.status);
  }
  const bytes = await mediaResponse.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new MetaGraphError("download_media", 413);
  }
  return { bytes, mimeType: mimeType as WhatsAppImage["mimeType"] };
}

export async function subscribeWhatsAppWebhook(
  input: {
    wabaId: string;
    accessToken: string;
    overrideCallbackUrl: string;
    verifyToken: string;
  },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = graphUrl(config, `/${input.wabaId}/subscribed_apps`);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      override_callback_uri: input.overrideCallbackUrl,
      verify_token: input.verifyToken,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  if (!response.ok || payload.success !== true) {
    throw graphError("subscribe_webhook", response, payload);
  }
}
