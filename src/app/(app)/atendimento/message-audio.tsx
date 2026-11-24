import type { SupportTimelineItem } from "@/lib/support/inbox";
import { cn } from "@/lib/utils";

type Audio = NonNullable<Extract<SupportTimelineItem, { kind: "message" }>["audio"]>;

/**
 * Áudio recebido (2026-11-23, pedido do Bruno): toca na própria conversa e mostra
 * o texto transcrito embaixo, para a equipe ler em vez de ouvir. O player tem
 * 16rem (com "Transcrevendo…" a bolha encolhia até sobrar só o play) e
 * `max-w-full`, que deixa encolher em tela estreita sem empurrar a bolha.
 */
export function MessageAudio({ audio, outbound = false }: { audio: Audio; outbound?: boolean }) {
  return (
    <>
      <audio controls preload="none" src={audio.src} className="h-10 w-64 max-w-full" aria-label={outbound ? "Nota de voz enviada" : "Áudio do cliente"} />
      {audio.transcript ? (
        <p className="whitespace-pre-wrap break-words">
          <span className={cn("mr-1.5 text-xs font-medium", outbound ? "text-primary-foreground/75" : "text-muted-foreground")}>Transcrição</span>
          {audio.transcript}
        </p>
      ) : audio.status === "failed" || audio.status === "unavailable" ? (
        <p className={cn("text-xs", outbound ? "text-primary-foreground/75" : "text-muted-foreground")}>Não foi possível transcrever. Ouça o áudio.</p>
      ) : audio.status ? (
        <p className={cn("text-xs", outbound ? "text-primary-foreground/75" : "text-muted-foreground")} aria-live="polite">Transcrevendo…</p>
      ) : null}
    </>
  );
}
