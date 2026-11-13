import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getWhatsAppConfig } from "./config";

describe("configuração do WhatsApp", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("deriva o callback da Guilda pela URL pública do servidor", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://guilda.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://outra.example");

    expect(getWhatsAppConfig().webhookCallbackUrl).toBe(
      "https://guilda.example/api/atendimento/meta/webhook",
    );
  });

  test("usa a URL pública como reserva e recusa protocolo impróprio", () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://guilda.example");
    expect(getWhatsAppConfig().webhookCallbackUrl).toBe(
      "https://guilda.example/api/atendimento/meta/webhook",
    );

    vi.stubEnv("NEXT_PUBLIC_APP_URL", "file:///segredo");
    expect(getWhatsAppConfig().webhookCallbackUrl).toBeUndefined();
  });
});
