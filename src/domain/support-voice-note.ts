/** Nota de voz gravada na conversa (2026-11-23): regras puras do gravador. */

/** Teto da gravação. Passou disso, para e espera o clique (microfone esquecido não vira envio). */
export const VOICE_NOTE_MAX_SECONDS = 5 * 60;

/**
 * Formatos na ordem de preferência. OGG/Opus é o da nota de voz do WhatsApp
 * (Firefox grava nele); Chrome e Edge gravam WebM/Opus; Safari só MP4. O
 * servidor converte todos para OGG/Opus.
 */
export const RECORDER_MIME_TYPES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

export function pickRecorderMimeType(isSupported: (type: string) => boolean): string | null {
  return RECORDER_MIME_TYPES.find((type) => isSupported(type)) ?? null;
}

/** 0:07, 1:30, 5:00. */
export function formatVoiceDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
