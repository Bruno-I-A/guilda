import "./load-env";

import { setTimeout as delay } from "node:timers/promises";

import { isWhatsAppWebhookConfigured } from "../src/lib/whatsapp/config";
import { runSupportInboundCycle } from "../src/lib/whatsapp/inbound-worker";
import { runSupportOutboxCycle } from "../src/lib/whatsapp/outbound-worker";
import { runMemberCommandCycle } from "../src/lib/whatsapp/member-commands";
import { runMemberWhatsAppNotificationCycle } from "../src/lib/whatsapp/member-notification-worker";
import { queueScheduledMemberNotices } from "../src/lib/notices/schedule";
import { runSupportTriageCycle, supportAiMode } from "../src/lib/support/triage/shadow";
import { isTranscriptionEnabled, runSupportTranscriptionCycle } from "../src/lib/support/transcription";

const INTERVAL_MS = 2_000;

/** Os lembretes do dia (prazo, fechamentos, resumo) rodam uma vez por minuto. */
let lastScheduledMinute = "";
async function queueScheduledOncePerMinute(): Promise<void> {
  const minute = new Date().toISOString().slice(0, 16);
  if (minute === lastScheduledMinute) return;
  lastScheduledMinute = minute;
  await queueScheduledMemberNotices();
}

async function main() {
  if (!isWhatsAppWebhookConfigured()) {
    console.log(
      "Worker de atendimento inativo: configuração do webhook do WhatsApp ausente.",
    );
    while (true) await delay(60 * 60 * 1000);
  }
  console.log(`Worker de atendimento iniciado. Triagem por IA: ${supportAiMode() === "shadow" ? "em sombra (nada vai ao cliente)" : "desligada"}. Transcrição de áudio: ${isTranscriptionEnabled() ? "ligada" : "desligada (sem OPENAI_API_KEY)"}.`);
  while (true) {
    const started = Date.now();
    try {
      await runSupportInboundCycle();
      // Mensagens dos integrantes (pedido de missão, botões dos avisos).
      await runMemberCommandCycle();
      // Antes da triagem: a leitura do turno espera o texto do áudio.
      await runSupportTranscriptionCycle();
      await runSupportOutboxCycle();
      await queueScheduledOncePerMinute();
      await runMemberWhatsAppNotificationCycle();
      await runSupportTriageCycle();
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
