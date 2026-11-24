import { describe, expect, test } from "vitest";

import {
  contactInitials,
  conversationAfterTeamReply,
  deliveryFailureMessage,
  enterSends,
  deliveryState,
  elapsedLabel,
  messageLabel,
  metaErrorMessage,
  parseSupportFilter,
  replyBlockReason,
  replyWindowIsOpen,
  statusAfterCustomerMessage,
} from "./support-inbox";

const NOW = new Date("2026-11-06T12:00:00Z");

describe("responder", () => {
  const base = { status: "human_active" as const, channelActive: true, lastCustomerMessageAt: new Date("2026-11-06T11:00:00Z"), now: NOW };
  test("libera para quem vê a conversa, com o número ativo e dentro das 24 horas", () => {
    expect(replyBlockReason(base)).toBeNull();
    // Não precisa ter assumido (2026-11-24): todo integrante vê e responde.
    expect(replyBlockReason({ ...base, status: "needs_human" })).toBeNull();
    expect(replyBlockReason({ ...base, status: "ai_active" })).toBeNull();
  });
  test("cada bloqueio diz o motivo", () => {
    expect(replyBlockReason({ ...base, status: "resolved" })).toMatch(/Reabra/);
    expect(replyBlockReason({ ...base, channelActive: false })).toMatch(/não está ativo/);
    expect(replyBlockReason({ ...base, lastCustomerMessageAt: null })).toMatch(/24 horas/);
  });
  test("a janela fecha exatamente em 24 horas", () => {
    expect(replyWindowIsOpen(new Date(NOW.getTime() - 86_399_000), NOW)).toBe(true);
    expect(replyWindowIsOpen(new Date(NOW.getTime() - 86_400_000), NOW)).toBe(false);
    expect(replyWindowIsOpen(null, NOW)).toBe(false);
  });
});

describe("Enter no compositor (2026-11-24)", () => {
  const key = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, coarsePointer: false };
  test("no computador Enter envia e Shift + Enter quebra a linha", () => {
    expect(enterSends(key)).toBe(true);
    expect(enterSends({ ...key, shiftKey: true })).toBe(false);
    expect(enterSends({ ...key, ctrlKey: true })).toBe(true);
    expect(enterSends({ ...key, key: "a" })).toBe(false);
  });
  test("no celular Enter quebra a linha, como no WhatsApp; acento em composição não envia", () => {
    expect(enterSends({ ...key, coarsePointer: true })).toBe(false);
    expect(enterSends({ ...key, coarsePointer: true, ctrlKey: true })).toBe(true);
    expect(enterSends({ ...key, isComposing: true })).toBe(false);
  });
});

describe("resposta da equipe na conversa (2026-11-24)", () => {
  test("sem responsável: quem respondeu passa a ser o responsável e a IA para", () => {
    expect(conversationAfterTeamReply({ status: "needs_human", assignedUserId: null, viewerId: "u1" })).toEqual({ status: "human_active", assignedUserId: "u1", takeOver: true, pauseAi: true });
    expect(conversationAfterTeamReply({ status: "ai_active", assignedUserId: null, viewerId: "u1" })).toEqual({ status: "human_active", assignedUserId: "u1", takeOver: true, pauseAi: true });
  });
  test("com um colega: a conversa continua com ele e sai da fila de quem precisa de pessoa", () => {
    expect(conversationAfterTeamReply({ status: "needs_human", assignedUserId: "u2", viewerId: "u1" })).toEqual({ status: "human_active", assignedUserId: "u2", takeOver: false, pauseAi: false });
    expect(conversationAfterTeamReply({ status: "human_active", assignedUserId: "u2", viewerId: "u1" })).toBeNull();
  });
  test("quem já está com a conversa responde sem mudar nada", () => {
    expect(conversationAfterTeamReply({ status: "human_active", assignedUserId: "u1", viewerId: "u1" })).toBeNull();
    expect(conversationAfterTeamReply({ status: "waiting_customer", assignedUserId: "u1", viewerId: "u1" })).toBeNull();
  });
});

describe("mensagem do cliente", () => {
  test("traz de volta quem estava aguardando, para quem assumiu ou para a fila", () => {
    expect(statusAfterCustomerMessage("waiting_customer", "u1")).toBe("human_active");
    expect(statusAfterCustomerMessage("waiting_customer", null)).toBe("needs_human");
    expect(statusAfterCustomerMessage("human_active", "u1")).toBe("human_active");
    expect(statusAfterCustomerMessage("needs_human", null)).toBe("needs_human");
  });
});

describe("apresentação", () => {
  test("avatar usa letras do contato sem depender da foto da Meta", () => {
    expect(contactInitials("José Prazeres Dos Santos")).toBe("JP");
    expect(contactInitials("👩‍👦 Ana")).toBe("A");
    expect(contactInitials("+5554912345678")).toBe("#");
    expect(contactInitials("♡")).toBe("?");
  });
  test("filtro desconhecido cai em Abertas", () => {
    expect(parseSupportFilter("resolved")).toBe("open");
    expect(parseSupportFilter("waiting")).toBe("open");
    expect(parseSupportFilter("x")).toBe("open");
    expect(parseSupportFilter(undefined)).toBe("open");
  });
  test("tempo sem resposta", () => {
    expect(elapsedLabel(new Date(NOW.getTime() - 20_000), NOW)).toBe("agora");
    expect(elapsedLabel(new Date(NOW.getTime() - 12 * 60_000), NOW)).toBe("12 min");
    expect(elapsedLabel(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3 h");
    expect(elapsedLabel(new Date(NOW.getTime() - 50 * 3_600_000), NOW)).toBe("2 d");
  });
  test("mensagem sem texto diz o que é", () => {
    expect(messageLabel({ text: "Oi", messageType: "text" })).toBe("Oi");
    expect(messageLabel({ text: null, messageType: "audio" })).toBe("Áudio");
    expect(messageLabel({ text: null, messageType: "novo" })).toBe("Mensagem");
  });
  test("a situação de envio não volta atrás, e falha sempre aparece", () => {
    expect(deliveryState(["queued"])).toBe("sending");
    expect(deliveryState(["queued", "accepted"])).toBe("sent");
    expect(deliveryState(["read", "delivered", "queued"])).toBe("read");
    expect(deliveryState(["queued", "read", "failed"])).toBe("failed");
  });
  test("erro da Meta vira frase, sem expor código", () => {
    expect(metaErrorMessage(131047)).toMatch(/24 horas/);
    expect(metaErrorMessage(1)).toBe("A Meta recusou o envio.");
    expect(metaErrorMessage(undefined)).toBe("A Meta recusou o envio.");
  });
  test("falha avisada depois pelo webhook diz o motivo e o código", () => {
    expect(deliveryFailureMessage({ message: "Passaram 24 horas." })).toBe("Passaram 24 horas.");
    expect(deliveryFailureMessage({ errors: [{ code: 131053, title: "Media upload error", error_data: { details: "x" } }] }))
      .toBe("A Meta não aceitou o arquivo. (código 131053 da Meta)");
    expect(deliveryFailureMessage({ errors: [{ code: 131000 }] })).toBe("A Meta recusou o envio. (código 131000 da Meta)");
    expect(deliveryFailureMessage({ errors: [{ code: "131053" }] })).toBeNull();
    expect(deliveryFailureMessage({ errors: [] })).toBeNull();
    expect(deliveryFailureMessage({})).toBeNull();
  });
});
