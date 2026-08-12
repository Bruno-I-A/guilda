import { timingSafeEqual } from "node:crypto";

import {
  isTelegramUpdate,
  type TelegramUpdate,
} from "@/lib/telegram/endpoint";
import { getTelegramConfig } from "@/lib/telegram/config";
import { dispatchTelegramUpdate } from "@/lib/telegram/update-processor";

export const runtime = "nodejs";

const MAX_UPDATE_BYTES = 1_000_000;

function sameSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export async function POST(request: Request): Promise<Response> {
  const { botToken, webhookSecret } = getTelegramConfig();
  if (!botToken || !webhookSecret) {
    return Response.json({ ok: false, error: "Telegram indisponível" }, { status: 503 });
  }
  if (
    !sameSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
      webhookSecret,
    )
  ) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPDATE_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (Buffer.byteLength(text, "utf8") > MAX_UPDATE_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }

  let update: TelegramUpdate | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    update = isTelegramUpdate(parsed) ? parsed : null;
  } catch {
    // resposta abaixo
  }
  if (!update) return Response.json({ ok: false }, { status: 400 });

  const updateId = String(update.update_id);
  try {
    const result = await dispatchTelegramUpdate(botToken, update);
    return Response.json({ ok: true, ...(result === "duplicate" ? { duplicate: true } : {}) });
  } catch (error) {
    console.error("Falha ao processar update do Telegram", {
      updateId,
      error: error instanceof Error ? error.message : "erro desconhecido",
    });
    return Response.json({ ok: false }, { status: 500 });
  }
}
