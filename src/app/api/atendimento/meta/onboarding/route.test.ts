import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  readyConfig: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/action-context", () => ({ requireMemberContext: mocks.member }));
vi.mock("@/lib/session", () => ({
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));
vi.mock("@/lib/whatsapp/onboarding", () => ({
  getReadyEmbeddedSignupConfig: mocks.readyConfig,
  completeEmbeddedSignup: mocks.complete,
  WhatsAppOnboardingActivationError: class extends Error {},
}));

import { GET, POST } from "./route";

const config = {
  appId: "123",
  configId: "456",
  graphApiVersion: "v24.0",
  featureType: "whatsapp_business_app_onboarding",
  sessionInfoVersion: "3",
};

const validBody = {
  code: "code-temporario-valido",
  sessionInfo: {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    data: { waba_id: "111111", phone_number_id: "222222" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue({
    ok: true,
    orgId: "org-a",
    userId: "user-a",
    role: "owner",
  });
  mocks.readyConfig.mockReturnValue(config);
  mocks.complete.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Escritório",
    status: "active",
    wabaId: "111111",
    phoneNumberId: "222222",
    coexistenceEnabled: true,
  });
});

test("GET só entrega configuração pública a admin/owner", async () => {
  expect(await (await GET()).json()).toEqual({ ok: true, configured: true, config });
  mocks.member.mockResolvedValue({ ok: true, orgId: "org-a", userId: "u", role: "member" });
  expect((await GET()).status).toBe(403);
});

test("POST recusa origem externa antes de trocar o code", async () => {
  const response = await POST(
    new Request("https://guilda.example/api/atendimento/meta/onboarding", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }),
  );
  expect(response.status).toBe(403);
  expect(mocks.complete).not.toHaveBeenCalled();
});

test("POST exige evento final do fluxo de coexistência", async () => {
  const response = await POST(
    new Request("https://guilda.example/api/atendimento/meta/onboarding", {
      method: "POST",
      headers: { origin: "https://guilda.example", "content-type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        sessionInfo: { ...validBody.sessionInfo, event: "CANCEL" },
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.complete).not.toHaveBeenCalled();
});

test("POST usa organização e usuário da sessão, nunca do browser", async () => {
  const response = await POST(
    new Request("https://guilda.example/api/atendimento/meta/onboarding", {
      method: "POST",
      headers: { origin: "https://guilda.example", "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.complete).toHaveBeenCalledWith({
    orgId: "org-a",
    userId: "user-a",
    code: "code-temporario-valido",
    wabaId: "111111",
    phoneNumberId: "222222",
  });
  expect(await response.json()).toMatchObject({
    ok: true,
    channel: { status: "active", phoneNumberId: "222222" },
  });
});

test("POST aceita apenas o code quando a Meta não publica a sessão", async () => {
  const response = await POST(
    new Request("https://guilda.example/api/atendimento/meta/onboarding", {
      method: "POST",
      headers: { origin: "https://guilda.example", "content-type": "application/json" },
      body: JSON.stringify({ code: "code-temporario-valido" }),
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.complete).toHaveBeenCalledWith({
    orgId: "org-a",
    userId: "user-a",
    code: "code-temporario-valido",
  });
});
