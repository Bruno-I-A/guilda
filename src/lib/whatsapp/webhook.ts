import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type SanitizedWhatsAppChange = Readonly<{
  phoneNumberId: string;
  field: string;
  payload: JsonRecord;
}>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function boundedJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return value.slice(0, 20_000);
  if (depth >= 6) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, 500)
      .map((item) => boundedJson(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  const record = asRecord(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 100)
      .map(([key, item]) => [key.slice(0, 100), boundedJson(item, depth + 1)])
      .filter((entry) => entry[1] !== undefined),
  );
}

function pickBounded(record: JsonRecord, keys: readonly string[]): JsonRecord {
  return Object.fromEntries(
    keys
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, boundedJson(record[key])])
      .filter((entry) => entry[1] !== undefined),
  );
}

/**
 * Persiste apenas os blocos necessários ao atendimento. Campos desconhecidos
 * no envelope (incluindo configuração da conta) não entram na fila.
 */
function sanitizeValue(value: JsonRecord): JsonRecord {
  return pickBounded(value, [
    "messaging_product",
    "metadata",
    "contacts",
    "messages",
    "message_echoes",
    "statuses",
    "errors",
    "history",
    "state_sync",
  ]);
}

function sameUtf8(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  const match = signatureHeader?.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return sameUtf8(match[1].toLowerCase(), expected);
}

export function verifyMetaChallenge(
  params: URLSearchParams,
  verifyToken: string,
): string | null {
  const mode = params.get("hub.mode");
  const receivedToken = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (
    mode !== "subscribe" ||
    !receivedToken ||
    !challenge ||
    !sameUtf8(receivedToken, verifyToken)
  ) {
    return null;
  }
  return challenge;
}

export function parseWhatsAppWebhook(rawBody: string): SanitizedWhatsAppChange[] | null {
  let root: JsonRecord | null = null;
  try {
    root = asRecord(JSON.parse(rawBody));
  } catch {
    return null;
  }
  if (root?.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) {
    return null;
  }

  const result: SanitizedWhatsAppChange[] = [];
  for (const entryValue of root.entry.slice(0, 100)) {
    const entry = asRecord(entryValue);
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const changeValue of entry.changes.slice(0, 100)) {
      const change = asRecord(changeValue);
      const value = asRecord(change?.value);
      const metadata = asRecord(value?.metadata);
      const phoneNumberId = metadata?.phone_number_id;
      const field = change?.field;
      if (
        !value ||
        typeof phoneNumberId !== "string" ||
        !/^[0-9]{1,32}$/.test(phoneNumberId) ||
        typeof field !== "string" ||
        !/^[a-z0-9_]{1,64}$/.test(field)
      ) {
        continue;
      }
      result.push({ phoneNumberId, field, payload: sanitizeValue(value) });
    }
  }
  return result;
}

export function webhookChangeFingerprint(rawBody: string, index: number): string {
  return createHash("sha256")
    .update("guilda:whatsapp:webhook:v1\0", "utf8")
    .update(String(index), "utf8")
    .update("\0", "utf8")
    .update(rawBody, "utf8")
    .digest("hex");
}
