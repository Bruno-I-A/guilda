import { timingSafeEqual } from "node:crypto";

import {
  type TelegramUpdate,
} from "@/lib/telegram/endpoint";
import { getTelegramConfig } from "@/lib/telegram/config";
import { createTelegramClient } from "@/lib/telegram/client";
import { processTelegramUpdate } from "@/lib/telegram/handlers";
import {
  claimTelegramUpdate,
  markTelegramUpdateFailed,
  markTelegramUpdateProcessed,
} from "@/lib/telegram/endpoint-repository";

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

function parseUpdate(value: unknown): TelegramUpdate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.update_id !== "number" ||
    !Number.isSafeInteger(candidate.update_id) ||
    candidate.update_id < 0
  ) {
    return null;
  }
  return value as TelegramUpdate;
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
    update = parseUpdate(JSON.parse(text));
  } catch {
    // resposta abaixo
  }
  if (!update) return Response.json({ ok: false }, { status: 400 });

  const updateId = String(update.update_id);
  const claimed = await claimTelegramUpdate(updateId);
  if (!claimed) return Response.json({ ok: true, duplicate: true });

  try {
    await processTelegramUpdate(createTelegramClient(botToken), update);
    await markTelegramUpdateProcessed(updateId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Falha ao processar update do Telegram", {
      updateId,
      error: error instanceof Error ? error.message : "erro desconhecido",
    });
    await markTelegramUpdateFailed(updateId, error).catch(() => undefined);
    return Response.json({ ok: false }, { status: 500 });
  }
}
