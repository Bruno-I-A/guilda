import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  generateTelegramLinkToken,
  hashTelegramLinkToken,
  TELEGRAM_LINK_TOKEN_TTL_MS,
  telegramLinkTokenExpiresAt,
} from "./link-token";

describe("tokens de vínculo do Telegram", () => {
  it("gera segredos base64url fortes e distintos", () => {
    const first = generateTelegramLinkToken();
    const second = generateTelegramLinkToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("produz SHA-256 hexadecimal determinístico", () => {
    expect(hashTelegramLinkToken("token-teste")).toBe(
      "857c4f4acec38f54bf3e142e67569f0fc7533138d4377d4f22dd98b59bef5573",
    );
    expect(() => hashTelegramLinkToken("")).toThrow("vazio");
  });

  it("expira em dez minutos", () => {
    const now = new Date("2026-08-12T10:00:00Z");
    expect(telegramLinkTokenExpiresAt(now).getTime() - now.getTime()).toBe(
      TELEGRAM_LINK_TOKEN_TTL_MS,
    );
  });
});
