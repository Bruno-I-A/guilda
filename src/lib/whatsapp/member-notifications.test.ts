import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hasOpenMemberWhatsAppWindow,
  memberNewClientMessage,
  memberNewClientTemplateParams,
  normalizeMemberPhoneInput,
  normalizeWhatsAppPhone,
  whatsAppPhoneVariants,
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
    expect(normalizeWhatsAppPhone("55 54 99999-0000")).toBe("+5554999990000");
    expect(normalizeWhatsAppPhone("999")).toBeNull();
  });

  test("número digitado no Perfil sem o 55 é do Brasil, não de outro país", () => {
    // "(54) 99999-0000" virava +54…, um número da Argentina.
    expect(normalizeMemberPhoneInput("(54) 99999-0000")).toBe("+5554999990000");
    expect(normalizeMemberPhoneInput("054 99999-0000")).toBe("+5554999990000");
    expect(normalizeMemberPhoneInput("55 54 99999-0000")).toBe("+5554999990000");
    expect(normalizeMemberPhoneInput("+55 (54) 99999-0000")).toBe("+5554999990000");
    expect(normalizeMemberPhoneInput("(54) 3333-0000")).toBe("+555433330000");
    // Com o +, o código do país é o que a pessoa escreveu.
    expect(normalizeMemberPhoneInput("+1 415 555 0000")).toBe("+14155550000");
    expect(normalizeMemberPhoneInput("55 54 999")).toBeNull();
    expect(normalizeMemberPhoneInput("+55 54 999999")).toBeNull();
  });

  test("celular brasileiro com e sem o nono dígito é o mesmo WhatsApp", () => {
    expect(whatsAppPhoneVariants("+5554999990000")).toEqual(["+5554999990000", "+555499990000"]);
    expect(whatsAppPhoneVariants("+555499990000")).toEqual(["+555499990000", "+5554999990000"]);
    // Fixo (começa com 2 a 5) não ganha nono dígito; outro país fica como está.
    expect(whatsAppPhoneVariants("+555433330000")).toEqual(["+555433330000"]);
    expect(whatsAppPhoneVariants("+14155550000")).toEqual(["+14155550000"]);
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
