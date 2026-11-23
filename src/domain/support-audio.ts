/**
 * Áudio no Atendimento (2026-11-23, pedido do Bruno): todo áudio recebido vira
 * texto pela OpenAI, como no Scharff, para a equipe ler e a IA entender. Puro.
 */

/** O WhatsApp aceita áudio até 16 MB; a OpenAI, até 25 MB. */
export const AUDIO_MAX_BYTES = 16 * 1024 * 1024;

/** "audio/ogg; codecs=opus" vira "audio/ogg"; o que não for áudio, null. */
export function audioBaseMime(value: string | null | undefined): string | null {
  const base = value?.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return /^audio\/[a-z0-9.+-]+$/.test(base) ? base : null;
}

const OPENAI_EXTENSIONS: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

/** Nome com a extensão que a OpenAI reconhece; null para o que ela não lê (AMR). */
export function transcriptionFileName(mimeType: string): string | null {
  const extension = OPENAI_EXTENSIONS[mimeType];
  return extension ? `audio.${extension}` : null;
}

/** Como o áudio entra no turno da IA: com a transcrição quando já existe. */
export function audioTurnText(transcript: string | null | undefined): string {
  const text = transcript?.trim();
  return text ? `Áudio (transcrição): ${text}` : "Áudio";
}
