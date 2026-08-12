import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const TELEGRAM_LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Gera um segredo forte apropriado para o parâmetro `/start` do bot. */
export function generateTelegramLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** O segredo em claro nunca é persistido; somente este digest é salvo. */
export function hashTelegramLinkToken(rawToken: string): string {
  if (!rawToken) throw new Error("Token de vínculo do Telegram vazio");
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function telegramLinkTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + TELEGRAM_LINK_TOKEN_TTL_MS);
}
