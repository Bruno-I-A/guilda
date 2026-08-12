// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const previous = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  appSecret: process.env.BETTER_AUTH_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    TELEGRAM_BOT_TOKEN: previous.botToken,
    TELEGRAM_WEBHOOK_SECRET: previous.webhookSecret,
    BETTER_AUTH_SECRET: previous.appSecret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("configuração Telegram", () => {
  it("deriva um segredo estável sem expor o token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:token-secreto";
    process.env.BETTER_AUTH_SECRET = "segredo-da-aplicacao";
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const { getTelegramConfig } = await import("./config");
    const config = getTelegramConfig();
    expect(config.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(config.webhookSecret).not.toContain("token-secreto");
    expect(getTelegramConfig().webhookSecret).toBe(config.webhookSecret);
  });

  it("respeita override explícito", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:token";
    process.env.BETTER_AUTH_SECRET = "app";
    process.env.TELEGRAM_WEBHOOK_SECRET = "override";
    const { getTelegramConfig } = await import("./config");
    expect(getTelegramConfig().webhookSecret).toBe("override");
  });
});
