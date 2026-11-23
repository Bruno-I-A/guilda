import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  downloadWhatsAppImage,
  downloadWhatsAppMedia,
  createWhatsAppUtilityTemplate,
  describeWhatsAppTemplateError,
  exchangeEmbeddedSignupCode,
  resolveEmbeddedSignupWabaId,
  resolveCoexistencePhone,
  sendWhatsAppMedia,
  sendWhatsAppAudio,
  sendWhatsAppTemplate,
  subscribeWhatsAppWebhook,
  uploadWhatsAppMedia,
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
  test("sobe arquivo no número conectado e envia o id como documento com legenda", async () => {
    const upload = fetchReturning({ id: "987654321" });
    const mediaId = await uploadWhatsAppMedia({
      phoneNumberId: "222222",
      accessToken: "EA-token",
      bytes: new Uint8Array([37, 80, 68, 70]),
      mimeType: "application/pdf",
      fileName: "balanco.pdf",
    }, config, upload);
    expect(mediaId).toBe("987654321");
    const [uploadUrl, uploadInit] = (upload as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(uploadUrl)).toContain("/v24.0/222222/media");
    expect(new Headers(uploadInit.headers).get("authorization")).toBe("Bearer EA-token");
    expect(new Headers(uploadInit.headers).get("content-type")).toBeNull();
    const form = uploadInit.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("application/pdf");
    expect((form.get("file") as File).name).toBe("balanco.pdf");

    const send = fetchReturning({ messages: [{ id: "wamid.documento" }] });
    await expect(sendWhatsAppMedia({
      phoneNumberId: "222222", accessToken: "EA-token", to: "5554911110000",
      kind: "document", mediaId, filename: "balanco.pdf", caption: "Segue o balanço",
    }, config, send)).resolves.toBe("wamid.documento");
    const [sendUrl, sendInit] = (send as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(sendUrl)).toContain("/v24.0/222222/messages");
    expect(JSON.parse(String(sendInit.body))).toMatchObject({
      messaging_product: "whatsapp", type: "document", to: "5554911110000",
      document: { id: "987654321", filename: "balanco.pdf", caption: "Segue o balanço" },
    });
  });

  test("recusa id de mídia inválido e não faz chamada à Meta", async () => {
    const send = fetchReturning({ messages: [{ id: "wamid" }] });
    await expect(sendWhatsAppMedia({ phoneNumberId: "222222", accessToken: "EA-token", to: "5554911110000", kind: "image", mediaId: "outro" }, config, send)).rejects.toBeInstanceOf(Error);
    expect(send).not.toHaveBeenCalled();
  });

  test("foto sai como imagem, sem nome de documento", async () => {
    const send = fetchReturning({ messages: [{ id: "wamid.foto" }] });
    await sendWhatsAppMedia({ phoneNumberId: "222222", accessToken: "EA-token", to: "5554911110000", kind: "image", mediaId: "12345", caption: "Comprovante" }, config, send);
    const [, init] = (send as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({ type: "image", image: { id: "12345", caption: "Comprovante" } });
    expect(JSON.parse(String(init.body)).image).not.toHaveProperty("filename");
  });

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

  test("envia o modelo Utility com os parâmetros fora da janela", async () => {
    const fetchMock = fetchReturning({ messages: [{ id: "wamid.aviso" }] });
    await expect(sendWhatsAppTemplate({
      phoneNumberId: "222222", accessToken: "EA-token", to: "5554999990000",
      name: "guilda_novo_cliente", language: "pt_BR", bodyParams: ["ACME", "Fiscal", "https://guilda.example"],
    }, config, fetchMock)).resolves.toBe("wamid.aviso");
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: "template",
      template: { name: "guilda_novo_cliente", language: { code: "pt_BR" } },
    });
    expect(JSON.parse(String(init.body)).template.components[0].parameters).toEqual([
      { type: "text", text: "ACME" }, { type: "text", text: "Fiscal" }, { type: "text", text: "https://guilda.example" },
    ]);
  });

  test("explica de forma acionável a permissão ausente para criar modelos", async () => {
    const fetchMock = fetchReturning({ error: { code: 200, message: "Permissions error" } }, 403);
    await expect(createWhatsAppUtilityTemplate({
      wabaId: "111111", accessToken: "EA-token", name: "guilda_novo_cliente", body: "Novo cliente: {{1}}", examples: ["ACME"],
    }, config, fetchMock)).rejects.toSatisfy((error: unknown) =>
      describeWhatsAppTemplateError(error).includes("whatsapp_business_management"),
    );
  });

  test("baixa foto por uma URL temporária sem expor o token", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/test",
            mime_type: "image/jpeg",
            file_size: bytes.byteLength,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "image/jpeg", "content-length": "4" },
        }),
      ) as unknown as typeof fetch;

    const image = await downloadWhatsAppImage(
      { mediaId: "987654321", phoneNumberId: "222222", accessToken: "EA-token" },
      config,
      fetchMock,
    );
    expect(new Uint8Array(image.bytes)).toEqual(bytes);
    expect(image.mimeType).toBe("image/jpeg");

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(new URL(String(calls[0][0])).pathname).toBe("/v24.0/987654321");
    expect(new URL(String(calls[0][0])).searchParams.get("phone_number_id")).toBe("222222");
    expect(new Headers(calls[0][1].headers).get("authorization")).toBe("Bearer EA-token");
    expect(String(calls[1][0])).toContain("lookaside.fbsbx.com");
    expect(new Headers(calls[1][1].headers).get("authorization")).toBe("Bearer EA-token");
  });

  test("documento de qualquer tipo baixa; acima do limite é recusa própria (413), sem baixar", async () => {
    const meta = (mime: string, size: number) =>
      fetchReturning({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/doc", mime_type: mime, file_size: size });
    const xml = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/doc", mime_type: "text/xml", file_size: 3 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([60, 97, 62]), { status: 200, headers: { "content-length": "3" } })) as unknown as typeof fetch;
    const media = await downloadWhatsAppMedia(
      { mediaId: "123", phoneNumberId: "222222", accessToken: "EA-token", allowedMimeTypes: null, maxBytes: 10 },
      config,
      xml,
    );
    expect(media.mimeType).toBe("text/xml");

    const big = meta("application/pdf", 11);
    await expect(
      downloadWhatsAppMedia({ mediaId: "123", phoneNumberId: "222222", accessToken: "EA-token", allowedMimeTypes: null, maxBytes: 10 }, config, big),
    ).rejects.toMatchObject({ operation: "download_media", httpStatus: 413 });
    expect((big as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  test("não segue URL de mídia fora dos hosts da Meta", async () => {
    const fetchMock = fetchReturning({
      url: "https://example.com/foto.jpg",
      mime_type: "image/jpeg",
      file_size: 123,
    });
    await expect(
      downloadWhatsAppImage(
        { mediaId: "987654321", phoneNumberId: "222222", accessToken: "EA-token" },
        config,
        fetchMock,
      ),
    ).rejects.toMatchObject({ operation: "download_media", httpStatus: 502 });
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
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
  test("sobe a nota de voz como multipart e devolve o id da mídia", async () => {
    const fetchMock = fetchReturning({ id: "1234567890" });
    await expect(
      uploadWhatsAppMedia(
        { phoneNumberId: "222222", accessToken: "EA-token", bytes: new Uint8Array([79, 103, 103, 83]), mimeType: "audio/ogg", fileName: "nota-de-voz.ogg" },
        config,
        fetchMock,
      ),
    ).resolves.toBe("1234567890");
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/v24.0/222222/media");
    expect(init).toMatchObject({ method: "POST", headers: { authorization: "Bearer EA-token" } });
    const form = (init as RequestInit).body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("audio/ogg");
    const file = form.get("file") as File;
    expect(file.name).toBe("nota-de-voz.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([79, 103, 103, 83]));
  });

  test("recusa da Meta ao subir a mídia vira erro sem o texto dela", async () => {
    const fetchMock = fetchReturning({ error: { message: "detalhe", code: 131053 } }, 400);
    await expect(
      uploadWhatsAppMedia(
        { phoneNumberId: "222222", accessToken: "EA-token", bytes: new Uint8Array([1]), mimeType: "audio/ogg", fileName: "nota-de-voz.ogg" },
        config,
        fetchMock,
      ),
    ).rejects.toMatchObject({ operation: "upload_media", httpStatus: 400, graphCode: 131053 });
  });

  test("manda o áudio pelo id da mídia e devolve o wamid", async () => {
    const fetchMock = fetchReturning({ messages: [{ id: "wamid.AUDIO" }] });
    await expect(
      sendWhatsAppAudio({ phoneNumberId: "222222", accessToken: "EA-token", to: "5554999999999", mediaId: "1234567890" }, config, fetchMock),
    ).resolves.toBe("wamid.AUDIO");
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/v24.0/222222/messages");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5554999999999",
      type: "audio",
      audio: { id: "1234567890", voice: true },
    });
  });
});
