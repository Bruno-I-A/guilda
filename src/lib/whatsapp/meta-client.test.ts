import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  exchangeEmbeddedSignupCode,
  resolveEmbeddedSignupWabaId,
  resolveCoexistencePhone,
  subscribeWhatsAppWebhook,
} from "./meta-client";

const config = {
  appId: "123456",
  appSecret: "app-secret-test",
  graphApiVersion: "v24.0",
};

function fetchReturning(payload: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("cliente seguro da Meta", () => {
  test("troca o code usando somente a configuração do servidor", async () => {
    const fetchMock = fetchReturning({ access_token: "EA-access-token-valido" });
    await expect(
      exchangeEmbeddedSignupCode("code-temporario", config, fetchMock),
    ).resolves.toBe("EA-access-token-valido");

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v24.0/oauth/access_token");
    expect(parsed.searchParams.get("client_id")).toBe("123456");
    expect(parsed.searchParams.get("client_secret")).toBe("app-secret-test");
    expect(parsed.searchParams.get("code")).toBe("code-temporario");
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  test("confirma que o telefone pertence ao WABA e continua no Business App", async () => {
    const fetchMock = fetchReturning({
      data: [
        {
          id: "222222",
          display_phone_number: "+55 54 99999-9999",
          verified_name: "Escritório",
          status: "CONNECTED",
          is_on_biz_app: true,
        },
        { id: "333333", is_on_biz_app: false },
      ],
    });
    await expect(
      resolveCoexistencePhone(
        { wabaId: "111111", phoneNumberId: "222222", accessToken: "EA-token" },
        config,
        fetchMock,
      ),
    ).resolves.toEqual({
      id: "222222",
      displayPhoneNumber: "+55 54 99999-9999",
      verifiedName: "Escritório",
      status: "CONNECTED",
      isOnBusinessApp: true,
    });
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer EA-token");
  });

  test("descobre uma única conta do WhatsApp pela permissão concedida", async () => {
    const fetchMock = fetchReturning({
      data: {
        granular_scopes: [
          { scope: "whatsapp_business_messaging", target_ids: ["999999"] },
          { scope: "whatsapp_business_management", target_ids: ["111111"] },
        ],
      },
    });
    await expect(
      resolveEmbeddedSignupWabaId("EA-access-token-valido", config, fetchMock),
    ).resolves.toBe("111111");

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v24.0/debug_token");
    expect(parsed.searchParams.get("input_token")).toBe("EA-access-token-valido");
    expect(parsed.searchParams.get("access_token")).toBe("123456|app-secret-test");
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  test("não escolhe arbitrariamente entre contas autorizadas", async () => {
    const fetchMock = fetchReturning({
      data: {
        granular_scopes: [
          {
            scope: "whatsapp_business_management",
            target_ids: ["111111", "222222"],
          },
        ],
      },
    });
    await expect(
      resolveEmbeddedSignupWabaId("EA-access-token-valido", config, fetchMock),
    ).rejects.toMatchObject({ operation: "resolve_waba", httpStatus: 409 });
  });

  test("recusa número comum ou seleção ambígua", async () => {
    const fetchMock = fetchReturning({ data: [{ id: "333333", is_on_biz_app: false }] });
    await expect(
      resolveCoexistencePhone(
        { wabaId: "111111", phoneNumberId: "333333", accessToken: "EA-token" },
        config,
        fetchMock,
      ),
    ).rejects.toMatchObject({
      operation: "list_phones",
      httpStatus: 409,
    });
  });

  test("assina o WABA com o callback e o token de verificação da Guilda", async () => {
    const fetchMock = fetchReturning({ success: true });
    await expect(
      subscribeWhatsAppWebhook(
        {
          wabaId: "111111",
          accessToken: "EA-token",
          overrideCallbackUrl: "https://guilda.example/api/atendimento/meta/webhook",
          verifyToken: "verify-token-guilda",
        },
        config,
        fetchMock,
      ),
    ).resolves.toBeUndefined();
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/v24.0/111111/subscribed_apps");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer EA-token");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      override_callback_uri: "https://guilda.example/api/atendimento/meta/webhook",
      verify_token: "verify-token-guilda",
    });
    expect(String(init.body)).not.toContain("EA-token");
  });

  test("erro da Graph API expõe somente metadados seguros", async () => {
    const fetchMock = fetchReturning(
      { error: { message: "detalhe sensível", code: 190, type: "OAuthException" } },
      400,
    );
    await expect(
      exchangeEmbeddedSignupCode("code-temporario", config, fetchMock),
    ).rejects.toMatchObject({
      operation: "exchange_code",
      httpStatus: 400,
      graphCode: 190,
      graphType: "OAuthException",
      message: "Meta Graph API falhou em exchange_code.",
    });
  });
});
