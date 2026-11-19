import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hasOpenMemberWhatsAppWindow,
  memberNewClientMessage,
  memberNewClientTemplateParams,
  normalizeWhatsAppPhone,
} from "./member-notifications";

const payload = {
  version: 1 as const,
  title: "Novo cliente",
  companyName: "ACME Comércio Ltda",
  clanName: "Fiscal",
  url: "https://guilda.exemplo/clans/fiscal?flow=1",
};

describe("avisos WhatsApp para integrantes", () => {
  test("normaliza telefone para E.164 e rejeita números incompletos", () => {
    expect(normalizeWhatsAppPhone("(54) 99999-0000")).toBe("+54999990000");
    expect(normalizeWhatsAppPhone("55 54 99999-0000")).toBe("+5554999990000");
    expect(normalizeWhatsAppPhone("999")).toBeNull();
  });

  test("usa texto só até dez minutos antes de a janela de 24 horas vencer", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(hasOpenMemberWhatsAppWindow(new Date(now.getTime() - (23 * 60 + 49) * 60_000), now)).toBe(true);
    expect(hasOpenMemberWhatsAppWindow(new Date(now.getTime() - (23 * 60 + 50) * 60_000), now)).toBe(false);
  });

  test("mantém texto e variáveis do modelo com o mesmo contexto", () => {
    expect(memberNewClientMessage(payload)).toContain("ACME Comércio Ltda");
    expect(memberNewClientTemplateParams(payload)).toEqual([payload.companyName, payload.clanName, payload.url]);
  });
});
