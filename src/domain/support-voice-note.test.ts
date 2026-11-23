import { describe, expect, it } from "vitest";

import { formatVoiceDuration, pickRecorderMimeType } from "./support-voice-note";

describe("pickRecorderMimeType", () => {
  it("prefere OGG/Opus quando o navegador grava nele", () => {
    expect(pickRecorderMimeType(() => true)).toBe("audio/ogg;codecs=opus");
  });

  it("cai para WebM/Opus no Chrome e para MP4 no Safari", () => {
    expect(pickRecorderMimeType((type) => type.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
  });

  it("devolve nulo quando nenhum formato é aceito (o navegador escolhe)", () => {
    expect(pickRecorderMimeType(() => false)).toBeNull();
  });
});

describe("formatVoiceDuration", () => {
  it("mostra minutos e segundos com dois dígitos", () => {
    expect(formatVoiceDuration(0)).toBe("0:00");
    expect(formatVoiceDuration(7)).toBe("0:07");
    expect(formatVoiceDuration(90)).toBe("1:30");
    expect(formatVoiceDuration(300)).toBe("5:00");
  });

  it("nunca mostra número negativo nem fração", () => {
    expect(formatVoiceDuration(-3)).toBe("0:00");
    expect(formatVoiceDuration(61.9)).toBe("1:01");
  });
});
