import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Nota de voz gravada na conversa (2026-11-23, pedido do Bruno): o navegador
 * grava em WebM (Chrome), OGG (Firefox) ou MP4 (Safari); o WhatsApp só mostra
 * como nota de voz OGG com Opus. O ffmpeg do servidor converte.
 *
 * A entrada vai por arquivo temporário, não pela entrada padrão: o MP4 do Safari
 * precisa de leitura com saltos, que a entrada padrão não permite.
 */

/** Gravação maior que isso não sai: a nota de voz do WhatsApp vai até 16 MB. */
export const VOICE_NOTE_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** `message` vai para a tela; `detail` (saída do ffmpeg) só para o log. */
export class VoiceNoteError extends Error {
  constructor(message: string, readonly detail: string | null = null) {
    super(message);
  }
}

export type VoiceNoteConverter = (input: Uint8Array) => Promise<Uint8Array>;

export const convertToVoiceNote: VoiceNoteConverter = async (input) => {
  if (input.byteLength === 0) throw new VoiceNoteError("A gravação veio vazia.");
  if (input.byteLength > VOICE_NOTE_MAX_INPUT_BYTES) throw new VoiceNoteError("A gravação passou de 10 MB.");
  const file = path.join(tmpdir(), `guilda-voz-${randomUUID()}`);
  await writeFile(file, input);
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      // Sem o comentário, o Turbopack trata o arquivo temporário como caminho do
      // projeto e copia o repositório inteiro (com .env e docs) para o standalone.
      const ffmpeg = spawn(
        /*turbopackIgnore: true*/ process.env.FFMPEG_PATH?.trim() || "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", "-f", "ogg", "pipe:1"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = "";
      const timer = setTimeout(() => {
        ffmpeg.kill("SIGKILL");
        reject(new VoiceNoteError("A conversão do áudio demorou demais."));
      }, TIMEOUT_MS);
      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_OUTPUT_BYTES) {
          ffmpeg.kill("SIGKILL");
          reject(new VoiceNoteError("O áudio convertido passou de 16 MB."));
          return;
        }
        chunks.push(chunk);
      });
      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-500);
      });
      ffmpeg.on("error", (error) => {
        clearTimeout(timer);
        reject(new VoiceNoteError("O servidor não está pronto para converter áudio. Avise o suporte da Guilda.", error.message));
      });
      ffmpeg.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && size > 0) resolve(new Uint8Array(Buffer.concat(chunks)));
        else reject(new VoiceNoteError("Não foi possível converter o áudio. Grave de novo.", stderr.trim() || `código ${code}`));
      });
    });
  } finally {
    await rm(file, { force: true });
  }
};
