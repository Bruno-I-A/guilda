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
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
const hasFfprobe = hasFfmpeg && spawnSync(ffprobe, ["-hide_banner", "-version"], { stdio: "ignore" }).status === 0;

/**
 * Gravação como a do Chrome com microfone de verdade: WebM/Opus que começa
 * depois do zero e tem um salto de 0,6 s nas marcas de tempo aos 4 s.
 */
function gappedWebm(): Uint8Array {
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=330:d=10",
    "-af", "asetpts='if(gte(T,4),PTS+0.6/TB,PTS)'", "-c:a", "libopus", "-b:a", "64k",
    "-output_ts_offset", "0.25", "-f", "webm", "pipe:1",
  ], { maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return new Uint8Array(result.stdout);
}

/** Momento de cada pacote de áudio do OGG, lido pelo ffprobe. */
function packetTimes(ogg: Uint8Array): number[] {
  const result = spawnSync(ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "packet=pts_time", "-of", "csv=p=0", "-i", "pipe:0"], { input: ogg });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  // O primeiro pacote sai com uma vírgula a mais (dado lateral do Opus).
  return result.stdout.toString().trim().split(/\r?\n/).map((line) => Number(line.split(",")[0]));
}

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

    // A Meta recusou notas de voz com "Media file scrutiny ... failed" (131053) e
    // aceitou outras iguais (2026-11-23): o salto da gravação passava para o OGG.
    it.skipIf(!hasFfprobe)("refaz as marcas de tempo: OGG contínuo desde o zero, mesmo com salto na gravação", async () => {
      const times = packetTimes(await convertToVoiceNote(gappedWebm()));
      expect(times[0]).toBeLessThan(0.05);
      const gaps = times.slice(1).map((time, index) => time - times[index]).filter((step) => step > 0.03 || step < 0.01);
      expect(gaps).toEqual([]);
      // 10 s de tom + 0,6 s de silêncio no lugar do salto.
      expect(times.at(-1)).toBeGreaterThan(10.5);
    }, 30_000);

    it("arquivo que não é áudio vira erro para a tela, com a saída do ffmpeg só no detalhe", async () => {
      const error = await convertToVoiceNote(new TextEncoder().encode("isto não é um áudio")).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(VoiceNoteError);
      expect((error as VoiceNoteError).message).toBe("Não foi possível converter o áudio. Grave de novo.");
      expect((error as VoiceNoteError).detail).toBeTruthy();
    }, 20_000);
  });
});
