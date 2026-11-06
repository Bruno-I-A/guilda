import { describe, expect, test } from "vitest";

import {
  canSeeConversation,
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
const member = { userId: "u1", role: "member" as const, clanIds: ["fiscal"] };

describe("quem vê a conversa", () => {
  test("admin e owner veem tudo, inclusive o que não tem clã", () => {
    const open = { assignedClanId: null, assignedUserId: null };
    expect(canSeeConversation({ ...member, role: "admin" }, open)).toBe(true);
    expect(canSeeConversation({ ...member, role: "owner" }, open)).toBe(true);
  });
  test("membro vê o clã dele e o que é dele, e nada além", () => {
    expect(canSeeConversation(member, { assignedClanId: "fiscal", assignedUserId: null })).toBe(true);
    expect(canSeeConversation(member, { assignedClanId: "rh", assignedUserId: "u1" })).toBe(true);
    expect(canSeeConversation(member, { assignedClanId: "rh", assignedUserId: "u2" })).toBe(false);
    expect(canSeeConversation(member, { assignedClanId: null, assignedUserId: null })).toBe(false);
  });
});

describe("responder", () => {
  const base = { status: "human_active" as const, assignedUserId: "u1", viewerId: "u1", channelActive: true, lastCustomerMessageAt: new Date("2026-11-06T11:00:00Z"), now: NOW };
  test("libera para quem assumiu, com o número ativo e dentro das 24 horas", () => {
    expect(replyBlockReason(base)).toBeNull();
  });
  test("cada bloqueio diz o motivo", () => {
    expect(replyBlockReason({ ...base, status: "resolved" })).toMatch(/Reabra/);
    expect(replyBlockReason({ ...base, assignedUserId: "u2" })).toMatch(/Assuma/);
    expect(replyBlockReason({ ...base, assignedUserId: null })).toMatch(/Assuma/);
    expect(replyBlockReason({ ...base, channelActive: false })).toMatch(/não está ativo/);
    expect(replyBlockReason({ ...base, lastCustomerMessageAt: null })).toMatch(/24 horas/);
  });
  test("a janela fecha exatamente em 24 horas", () => {
    expect(replyWindowIsOpen(new Date(NOW.getTime() - 86_399_000), NOW)).toBe(true);
    expect(replyWindowIsOpen(new Date(NOW.getTime() - 86_400_000), NOW)).toBe(false);
    expect(replyWindowIsOpen(null, NOW)).toBe(false);
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
  test("filtro desconhecido cai em Abertas", () => {
    expect(parseSupportFilter("resolved")).toBe("resolved");
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
});
