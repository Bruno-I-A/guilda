import { describe, expect, it } from "vitest";

import {
  encodeTaskCallback,
  encodeDraftCallback,
  isTelegramUpdate,
  parseTelegramStartToken,
  parseTaskCallback,
  parseDraftCallback,
} from "./endpoint";

describe("parseTelegramStartToken", () => {
  it("aceita apenas o deep link técnico de conexão", () => {
    expect(parseTelegramStartToken(" /start@GuildaBot token-opaco ")).toBe(
      "token-opaco",
    );
  });

  it("recusa todos os comandos operacionais e texto livre", () => {
    expect(parseTelegramStartToken("/ajuda")).toBeNull();
    expect(parseTelegramStartToken("/minhas")).toBeNull();
    expect(parseTelegramStartToken("olá")).toBeNull();
  });
});

describe("isTelegramUpdate", () => {
  it("aceita somente update_id inteiro, seguro e não negativo", () => {
    expect(isTelegramUpdate({ update_id: 123, message: {} })).toBe(true);
    expect(isTelegramUpdate({ update_id: -1 })).toBe(false);
    expect(isTelegramUpdate({ update_id: 1.5 })).toBe(false);
    expect(isTelegramUpdate({ update_id: "123" })).toBe(false);
  });

});

describe("callbacks de rascunho da IA", () => {
  const draftId = "123e4567-e89b-12d3-a456-426614174000";

  it("faz round-trip compacto de confirmação e cancelamento", () => {
    const confirm = encodeDraftCallback("confirm", draftId);
    const cancel = encodeDraftCallback("cancel", draftId);
    expect(Buffer.byteLength(confirm)).toBeLessThanOrEqual(64);
    expect(parseDraftCallback(confirm)).toEqual({ action: "confirm", draftId });
    expect(parseDraftCallback(cancel)).toEqual({ action: "cancel", draftId });
  });
});

describe("callbacks compactos", () => {
  const taskId = "123e4567-e89b-12d3-a456-426614174000";

  it("faz round-trip em até 64 bytes", () => {
    const encoded = encodeTaskCallback("approve", taskId);
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(64);
    expect(parseTaskCallback(encoded)).toEqual({ action: "approve", taskId });
  });

  it("recusa payload adulterado", () => {
    expect(parseTaskCallback("t:z:Ej5FZ-ibEtOkVkJmFBdAAA")).toBeNull();
    expect(parseTaskCallback("t:a:../../etc/passwd")).toBeNull();
  });

  it("codifica rejeição e cancelamento para confirmação guiada", () => {
    expect(parseTaskCallback(encodeTaskCallback("reject", taskId))).toEqual({
      action: "reject",
      taskId,
    });
    expect(parseTaskCallback(encodeTaskCallback("cancel", taskId))).toEqual({
      action: "cancel",
      taskId,
    });
  });
});
