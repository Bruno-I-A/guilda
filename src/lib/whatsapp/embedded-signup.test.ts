import { describe, expect, test } from "vitest";

import {
  embeddedSignupLoginOptions,
  isTrustedFacebookOrigin,
  parseEmbeddedSignupMessage,
} from "./embedded-signup";

describe("mensagens do Embedded Signup", () => {
  test("aceita somente origens HTTPS da Meta", () => {
    expect(isTrustedFacebookOrigin("https://www.facebook.com")).toBe(true);
    expect(isTrustedFacebookOrigin("https://web.facebook.com")).toBe(true);
    expect(isTrustedFacebookOrigin("http://www.facebook.com")).toBe(false);
    expect(isTrustedFacebookOrigin("https://facebook.com.evil.example")).toBe(false);
    expect(isTrustedFacebookOrigin("not-a-url")).toBe(false);
  });

  test("extrai apenas o evento final com IDs válidos", () => {
    expect(
      parseEmbeddedSignupMessage(
        JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "111111", phone_number_id: "222222", ignored: "x" },
        }),
      ),
    ).toEqual({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: { waba_id: "111111", phone_number_id: "222222" },
    });
    expect(
      parseEmbeddedSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "CANCEL",
        data: { waba_id: "111111" },
      }),
    ).toBeNull();
    expect(
      parseEmbeddedSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "../../outro" },
      }),
    ).toBeNull();
  });

  test("monta o login sem segredos", () => {
    expect(
      embeddedSignupLoginOptions({
        appId: "123",
        configId: "456",
        graphApiVersion: "v24.0",
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      }),
    ).toEqual({
      config_id: "456",
      response_type: "code",
      override_default_response_type: true,
      extras: {
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    });
  });
});
