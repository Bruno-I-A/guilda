import "./load-env";

import { setTimeout as delay } from "node:timers/promises";

import { getTelegramConfig } from "../src/lib/telegram/config";
import { ensureTelegramWebhook } from "../src/lib/telegram/client";
import { runTelegramWorkerCycle } from "../src/lib/telegram/worker";

const INTERVAL_MS = 60_000;

async function main() {
  if (!getTelegramConfig().botToken) {
    console.log("Telegram worker inativo: TELEGRAM_BOT_TOKEN não definido.");
    while (true) await delay(60 * 60 * 1000);
  }
  let webhookReady = false;
  console.log("Telegram worker iniciado.");
  while (true) {
    const started = Date.now();
    try {
      if (!webhookReady) {
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
