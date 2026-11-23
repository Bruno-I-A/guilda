import { describe, expect, test } from "vitest";

import { audioBaseMime, audioTurnText, transcriptionFileName } from "./support-audio";

describe("tipo do áudio recebido", () => {
  test("tira os parâmetros e só aceita áudio", () => {
    expect(audioBaseMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(audioBaseMime("AUDIO/MPEG")).toBe("audio/mpeg");
    expect(audioBaseMime("text/html")).toBeNull();
    expect(audioBaseMime("audio/x<script>")).toBeNull();
    expect(audioBaseMime(null)).toBeNull();
  });

  test("nome do arquivo que a OpenAI reconhece; AMR ela não lê", () => {
    expect(transcriptionFileName("audio/ogg")).toBe("audio.ogg");
    expect(transcriptionFileName("audio/mpeg")).toBe("audio.mp3");
    expect(transcriptionFileName("audio/mp4")).toBe("audio.m4a");
    expect(transcriptionFileName("audio/aac")).toBe("audio.m4a");
    expect(transcriptionFileName("audio/wav")).toBe("audio.wav");
    expect(transcriptionFileName("audio/webm")).toBe("audio.webm");
    expect(transcriptionFileName("audio/amr")).toBeNull();
  });
});

describe("áudio no turno da IA", () => {
  test("leva a transcrição; sem ela, só o rótulo", () => {
    expect(audioTurnText("Preciso da guia do DAS de outubro")).toBe("Áudio (transcrição): Preciso da guia do DAS de outubro");
    expect(audioTurnText("  ")).toBe("Áudio");
    expect(audioTurnText(null)).toBe("Áudio");
  });
});
