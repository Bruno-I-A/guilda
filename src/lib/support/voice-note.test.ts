import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { convertToVoiceNote, VOICE_NOTE_MAX_INPUT_BYTES, VoiceNoteError } from "./voice-note";

/** 1 segundo de tom em WAV PCM: entrada real para o ffmpeg, sem arquivo de fixture. */
function toneWav(seconds = 1, sampleRate = 16_000): Uint8Array {
  const samples = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), 44 + i * 2);
  }
  return new Uint8Array(buffer);
}

const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-hide_banner", "-version"], { stdio: "ignore" }).status === 0;

describe("convertToVoiceNote", () => {
  it("recusa gravação vazia ou acima de 10 MB sem chamar o ffmpeg", async () => {
    await expect(convertToVoiceNote(new Uint8Array())).rejects.toThrow("A gravação veio vazia.");
    await expect(convertToVoiceNote(new Uint8Array(VOICE_NOTE_MAX_INPUT_BYTES + 1))).rejects.toThrow("A gravação passou de 10 MB.");
  });

  describe.skipIf(!hasFfmpeg)("com o ffmpeg do servidor", () => {
    it("converte para OGG com Opus, o formato da nota de voz do WhatsApp", async () => {
      const output = Buffer.from(await convertToVoiceNote(toneWav()));
      expect(output.subarray(0, 4).toString("ascii")).toBe("OggS");
      expect(output.includes(Buffer.from("OpusHead"))).toBe(true);
    }, 20_000);

    it("arquivo que não é áudio vira erro para a tela, com a saída do ffmpeg só no detalhe", async () => {
      const error = await convertToVoiceNote(new TextEncoder().encode("isto não é um áudio")).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(VoiceNoteError);
      expect((error as VoiceNoteError).message).toBe("Não foi possível converter o áudio. Grave de novo.");
      expect((error as VoiceNoteError).detail).toBeTruthy();
    }, 20_000);
  });
});
