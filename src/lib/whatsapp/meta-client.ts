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
  error?: { code?: number; type?: string; message?: string; error_user_msg?: string };
};

export class MetaGraphError extends Error {
  constructor(
    readonly operation:
      | "exchange_code"
      | "resolve_waba"
      | "list_phones"
      | "subscribe_webhook"
      | "send_message"
      | "upload_media"
      | "send_template"
      | "get_template"
      | "create_template"
      | "get_media_url"
      | "download_media",
    readonly httpStatus: number,
    readonly graphCode?: number,
    readonly graphType?: string,
    /** Explicação curta da Meta, sem token ou resposta bruta. */
    readonly graphMessage?: string,
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
  const message = String(error?.error_user_msg ?? error?.message ?? "")
    .replace(/(?:access[_ -]?token|bearer)\s+[^\s,]+/gi, "")
    .slice(0, 300)
    .trim() || undefined;
  return new MetaGraphError(operation, response.status, error?.code, error?.type, message);
}

/** Texto seguro e acionável para o administrador; não entrega payload nem credencial. */
export function describeWhatsAppTemplateError(error: unknown): string {
  if (!(error instanceof MetaGraphError)) return "Não foi possível preparar o modelo da Meta.";
  if (error.graphCode === 200 || error.httpStatus === 403) {
    return "A Meta negou a permissão de gerenciar modelos. Reconecte o WhatsApp do escritório em Atendimento para conceder whatsapp_business_management e tente novamente.";
  }
  if (error.graphCode === 190) return "O acesso do WhatsApp expirou. Reconecte o número do escritório em Atendimento e tente novamente.";
  if (error.graphCode === 100 || error.graphCode === 131009) {
    return error.graphMessage ? `A Meta recusou um campo do modelo: ${error.graphMessage}` : "A Meta recusou um campo do modelo.";
  }
  if (error.graphCode === 80008) return "A Meta limitou temporariamente a criação de modelos. Aguarde alguns minutos e tente novamente.";
  return error.graphMessage ? `A Meta não criou o modelo: ${error.graphMessage}` : `A Meta não criou o modelo (HTTP ${error.httpStatus}).`;
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
  input: { phoneNumberId: string; accessToken: string; to: string; text: string; replyToMessageId?: string },
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
      ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}),
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

/**
 * Sobe foto, documento ou nota de voz no mesmo número que fará o envio.
 * O navegador nunca recebe o token nem o id do canal.
 */
export async function uploadWhatsAppMedia(
  input: { phoneNumberId: string; accessToken: string; bytes: Uint8Array; mimeType: string; fileName: string },
  config: Pick<MetaServerConfig, "graphApiVersion">,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", input.mimeType);
  form.set("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName);
  const response = await fetchImpl(graphUrl(config, `/${input.phoneNumberId}/media`), {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}` },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await responsePayload(response);
  if (!response.ok || typeof payload.id !== "string" || !/^\d{1,32}$/.test(payload.id)) {
    throw graphError("upload_media", response, payload);
  }
  return payload.id;
}

/** Envia foto ou documento já carregado no mesmo número do WhatsApp. */
export async function sendWhatsAppMedia(
  input: { phoneNumberId: string; accessToken: string; to: string; kind: "image" | "document"; mediaId: string; filename?: string; caption?: string; replyToMessageId?: string },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!/^\d{1,32}$/.test(input.mediaId)) throw new MetaGraphError("send_message", 400);
  const media = {
    id: input.mediaId,
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.kind === "document" && input.filename ? { filename: input.filename } : {}),
  };
  const response = await fetchImpl(graphUrl(config, `/${input.phoneNumberId}/messages`), {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to, ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}), type: input.kind, [input.kind]: media }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  const sent = Array.isArray(payload.messages) ? (payload.messages[0] as { id?: unknown } | undefined) : undefined;
  if (!response.ok || typeof sent?.id !== "string") throw graphError("send_message", response, payload);
  return sent.id;
}

/**
 * Áudio já enviado à Meta: OGG/Opus com `voice: true` chega ao cliente como
 * nota de voz. Sem o campo, a Meta trata como arquivo de áudio comum.
 */
export async function sendWhatsAppAudio(
  input: { phoneNumberId: string; accessToken: string; to: string; mediaId: string; replyToMessageId?: string },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(graphUrl(config, `/${input.phoneNumberId}/messages`), {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to, ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}), type: "audio", audio: { id: input.mediaId, voice: true } }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  const sent = Array.isArray(payload.messages) ? (payload.messages[0] as { id?: unknown } | undefined) : undefined;
  if (!response.ok || typeof sent?.id !== "string") throw graphError("send_message", response, payload);
  return sent.id;
}

export type WhatsAppTemplate = Readonly<{
  id?: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  rejectedReason?: string;
}>;

/**
 * Mensagem com até três botões de resposta (2026-11-24, avisos da Guilda). Só
 * dentro da janela de 24 h; o toque volta pelo webhook com o id do botão.
 */
export async function sendWhatsAppButtons(
  input: { phoneNumberId: string; accessToken: string; to: string; text: string; buttons: readonly { id: string; title: string }[] },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (input.buttons.length < 1 || input.buttons.length > 3) throw new MetaGraphError("send_message", 400);
  const response = await fetchImpl(graphUrl(config, `/${input.phoneNumberId}/messages`), {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: input.text.slice(0, 1024) },
        action: { buttons: input.buttons.map((button) => ({ type: "reply", reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) } })) },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  const sent = Array.isArray(payload.messages) ? (payload.messages[0] as { id?: unknown } | undefined) : undefined;
  if (!response.ok || typeof sent?.id !== "string") throw graphError("send_message", response, payload);
  return sent.id;
}

/** Parâmetro de botão do modelo: a resposta rápida leva o payload; o link, a variável da URL. */
export type WhatsAppTemplateButtonParam =
  | Readonly<{ type: "quick_reply"; index: number; payload: string }>
  | Readonly<{ type: "url"; index: number; text: string }>;

/** Envia um modelo previamente aprovado; é a única saída permitida fora da janela de 24 h. */
export async function sendWhatsAppTemplate(
  input: { phoneNumberId: string; accessToken: string; to: string; name: string; language: string; bodyParams: string[]; buttons?: readonly WhatsAppTemplateButtonParam[] },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = graphUrl(config, `/${input.phoneNumberId}/messages`);
  const buttonComponents = (input.buttons ?? []).map((button) => ({
    type: "button",
    sub_type: button.type,
    index: String(button.index),
    parameters: [button.type === "quick_reply" ? { type: "payload", payload: button.payload } : { type: "text", text: button.text }],
  }));
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        components: [{ type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text })) }, ...buttonComponents],
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  const sent = Array.isArray(payload.messages) ? (payload.messages[0] as { id?: unknown } | undefined) : undefined;
  if (!response.ok || typeof sent?.id !== "string") throw graphError("send_template", response, payload);
  return sent.id;
}

function parseTemplate(value: unknown): WhatsAppTemplate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.language !== "string" || typeof item.status !== "string") return null;
  return {
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    name: item.name,
    language: item.language,
    status: item.status,
    ...(typeof item.category === "string" ? { category: item.category } : {}),
    ...(typeof item.rejected_reason === "string" ? { rejectedReason: item.rejected_reason } : {}),
  };
}

export async function getWhatsAppTemplate(
  input: { wabaId: string; accessToken: string; name: string },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppTemplate | null> {
  const url = graphUrl(config, `/${input.wabaId}/message_templates`);
  url.search = new URLSearchParams({ name: input.name, limit: "10" }).toString();
  const response = await fetchImpl(url, { method: "GET", headers: { authorization: `Bearer ${input.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const payload = await responsePayload(response);
  if (!response.ok || !Array.isArray(payload.data)) throw graphError("get_template", response, payload);
  // O filtro por nome da Meta não é garantidamente exato: guilda_prazo não
  // pode devolver o guilda_prazo_v3.
  return payload.data.map(parseTemplate).find((template): template is WhatsAppTemplate => template?.name === input.name) ?? null;
}

export type WhatsAppTemplateButtonDefinition =
  | Readonly<{ type: "QUICK_REPLY"; text: string }>
  | Readonly<{ type: "URL"; text: string; url: string; example: string }>;

export async function createWhatsAppUtilityTemplate(
  input: { wabaId: string; accessToken: string; name: string; body: string; examples: readonly string[]; buttons?: readonly WhatsAppTemplateButtonDefinition[] },
  config: MetaServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppTemplate> {
  const url = graphUrl(config, `/${input.wabaId}/message_templates`);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      language: "pt_BR",
      category: "UTILITY",
      // Desde 04/2025 a Meta ignora este campo: se discordar de Utility, aprova
      // como MARKETING mesmo assim. Quem barra o custo é o worker, que não usa
      // modelo classificado como Marketing (`isUsableTemplate`).
      allow_category_change: false,
      components: [
        { type: "BODY", text: input.body, example: { body_text: [input.examples] } },
        ...(input.buttons?.length
          ? [{
              type: "BUTTONS",
              buttons: input.buttons.map((button) => button.type === "URL"
                ? { type: "URL", text: button.text, url: button.url, example: [button.example] }
                : { type: "QUICK_REPLY", text: button.text }),
            }]
          : []),
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responsePayload(response);
  if (!response.ok || typeof payload.id !== "string") throw graphError("create_template", response, payload);
  return {
    id: payload.id,
    name: input.name,
    language: "pt_BR",
    status: typeof payload.status === "string" ? payload.status : "PENDING",
    ...(typeof payload.category === "string" ? { category: payload.category } : {}),
  };
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
  const media = await downloadWhatsAppMedia(
    { ...input, allowedMimeTypes: IMAGE_MIME_TYPES, maxBytes: MAX_IMAGE_BYTES },
    config,
    fetchImpl,
  );
  return { bytes: media.bytes, mimeType: media.mimeType as WhatsAppImage["mimeType"] };
}

/**
 * Baixa uma mídia recebida (foto ou PDF), só dos tipos e até o tamanho que o
 * chamador aceita. Mesmas travas da foto: id numérico, host da Meta, sem
 * redirecionamento e tamanho conferido antes e depois do download.
 */
export async function downloadWhatsAppMedia(
  input: {
    mediaId: string;
    phoneNumberId: string;
    accessToken: string;
    /** null aceita qualquer tipo: documento do cliente, que a rota sempre manda baixar. */
    allowedMimeTypes: ReadonlySet<string> | null;
    maxBytes: number;
  },
  config: Pick<MetaServerConfig, "graphApiVersion">,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const maxBytes = input.maxBytes;
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
  // Grande demais é recusa própria (413): a tela explica em vez de dizer "indisponível".
  if (metadataResponse.ok && typeof fileSize === "number" && fileSize > maxBytes) {
    throw new MetaGraphError("download_media", 413);
  }
  if (
    !metadataResponse.ok ||
    typeof mediaUrlValue !== "string" ||
    typeof mimeType !== "string" ||
    (input.allowedMimeTypes !== null && !input.allowedMimeTypes.has(mimeType)) ||
    typeof fileSize !== "number" ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0
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
    (Number.isFinite(declaredLength) && declaredLength > maxBytes)
  ) {
    throw new MetaGraphError("download_media", mediaResponse.status);
  }
  const bytes = await mediaResponse.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new MetaGraphError("download_media", 413);
  }
  return { bytes, mimeType };
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
