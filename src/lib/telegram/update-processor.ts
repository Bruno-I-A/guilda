import "server-only";

import { createTelegramClient } from "./client";
import type { TelegramUpdate } from "./endpoint";
import {
  claimTelegramUpdate,
  markTelegramUpdateFailed,
  markTelegramUpdateProcessed,
} from "./endpoint-repository";
import { processTelegramUpdate } from "./handlers";

export type TelegramUpdateResult = "processed" | "duplicate";

/**
 * Deduplica e processa um update recebido por webhook ou long polling.
 * Falhas ficam marcadas para que a próxima entrega possa tentar novamente.
 */
export async function dispatchTelegramUpdate(
  botToken: string,
  update: TelegramUpdate,
): Promise<TelegramUpdateResult> {
  const updateId = String(update.update_id);
  const claimed = await claimTelegramUpdate(updateId);
  if (!claimed) return "duplicate";

  try {
    await processTelegramUpdate(createTelegramClient(botToken), update);
    await markTelegramUpdateProcessed(updateId);
    return "processed";
  } catch (error) {
    await markTelegramUpdateFailed(updateId, error).catch(() => undefined);
    throw error;
  }
}
