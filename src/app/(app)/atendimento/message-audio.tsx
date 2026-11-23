import type { SupportTimelineItem } from "@/lib/support/inbox";

type Audio = NonNullable<Extract<SupportTimelineItem, { kind: "message" }>["audio"]>;

/**
 * Áudio recebido (2026-11-23, pedido do Bruno): toca na própria conversa e mostra
 * o texto transcrito embaixo, para a equipe ler em vez de ouvir. O player tem
 * 16rem (com "Transcrevendo…" a bolha encolhia até sobrar só o play) e
 * `max-w-full`, que deixa encolher em tela estreita sem empurrar a bolha.
 */
export function MessageAudio({ audio }: { audio: Audio }) {
  return (
    <>
      <audio controls preload="none" src={audio.src} className="h-10 w-64 max-w-full" aria-label="Áudio do cliente" />
      {audio.transcript ? (
        <p className="whitespace-pre-wrap break-words">
          <span className="hud-label mr-1.5">Transcrição</span>
          {audio.transcript}
        </p>
      ) : audio.status === "failed" || audio.status === "unavailable" ? (
        <p className="text-xs text-muted-foreground">Não foi possível transcrever. Ouça o áudio.</p>
      ) : audio.status ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">Transcrevendo…</p>
      ) : null}
    </>
  );
}
