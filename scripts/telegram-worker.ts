import "./load-env";

import { setTimeout as delay } from "node:timers/promises";

import { ensureTelegramWebhook } from "../src/lib/telegram/client";
import { getTelegramConfig } from "../src/lib/telegram/config";
import {
  disableTelegramWebhook,
  getTelegramUpdates,
} from "../src/lib/telegram/polling";
import { dispatchTelegramUpdate } from "../src/lib/telegram/update-processor";
import { runTelegramWorkerCycle } from "../src/lib/telegram/worker";

const INTERVAL_MS = 60_000;
const POLLING_RETRY_MS = 5_000;

async function runDeliveryLoop(registerWebhook: boolean) {
  let webhookReady = false;
  while (true) {
    const started = Date.now();
    try {
      if (registerWebhook && !webhookReady) {
        webhookReady = await ensureTelegramWebhook();
        console.log(
          webhookReady
            ? "Webhook do Telegram configurado."
            : "Webhook do Telegram indisponível; nova tentativa em até 1 minuto.",
        );
      }
      await runTelegramWorkerCycle();
    } catch (error) {
      console.error(
        "Falha no ciclo do Telegram worker:",
        error instanceof Error ? error.message : error,
      );
    }
    await delay(Math.max(1_000, INTERVAL_MS - (Date.now() - started)));
  }
}

async function runPollingLoop(botToken: string) {
  let pollingReady = false;
  let offset: number | undefined;

  while (true) {
    try {
      if (!pollingReady) {
        await disableTelegramWebhook(botToken);
        pollingReady = true;
        console.log("Recepção do Telegram configurada por long polling.");
      }

      const updates = await getTelegramUpdates(botToken, offset);
      let processingFailed = false;
      for (const update of updates) {
        try {
          await dispatchTelegramUpdate(botToken, update);
          offset = update.update_id + 1;
        } catch (error) {
          console.error("Falha ao processar update recebido por polling", {
            updateId: update.update_id,
            error: error instanceof Error ? error.message : error,
          });
          processingFailed = true;
          break;
        }
      }
      // Sem avançar o offset, a Bot API mantém o update disponível para retry.
      if (processingFailed) await delay(POLLING_RETRY_MS);
    } catch (error) {
      console.error(
        "Falha ao receber update do Telegram:",
        error instanceof Error ? error.message : error,
      );
      await delay(POLLING_RETRY_MS);
    }
  }
}

async function main() {
  const config = getTelegramConfig();
  if (!config.botToken) {
    console.log("Telegram worker inativo: TELEGRAM_BOT_TOKEN não definido.");
    while (true) await delay(60 * 60 * 1000);
  }

  console.log(`Telegram worker iniciado em modo ${config.updateMode}.`);
  if (config.updateMode === "webhook") {
    await runDeliveryLoop(true);
    return;
  }
  await Promise.all([runDeliveryLoop(false), runPollingLoop(config.botToken)]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
