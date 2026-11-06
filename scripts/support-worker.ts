import "./load-env";

import { setTimeout as delay } from "node:timers/promises";

import { isWhatsAppWebhookConfigured } from "../src/lib/whatsapp/config";
import { runSupportInboundCycle } from "../src/lib/whatsapp/inbound-worker";

const INTERVAL_MS = 2_000;

async function main() {
  if (!isWhatsAppWebhookConfigured()) {
    console.log(
      "Worker de atendimento inativo: configuração do webhook do WhatsApp ausente.",
    );
    while (true) await delay(60 * 60 * 1000);
  }
  console.log("Worker de atendimento iniciado.");
  while (true) {
    const started = Date.now();
    try {
      await runSupportInboundCycle();
    } catch (error) {
      console.error(
        "Falha no ciclo do worker de atendimento:",
        error instanceof Error ? error.message : "erro desconhecido",
      );
    }
    await delay(Math.max(250, INTERVAL_MS - (Date.now() - started)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
