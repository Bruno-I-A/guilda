import { describe, expect, test } from "vitest";

import {
  canSeeConversation,
  characterCount,
  deliveryState,
  elapsedLabel,
  handoffPlan,
  isScrolledToEnd,
  messageLabel,
  metaErrorMessage,
  NOTE_MAX_LENGTH,
  parseSupportFilter,
  parseSupportPage,
  queueLimitNotice,
  REPLY_MAX_LENGTH,
  replyBlock,
  replyBlockReason,
  replyWindowIsOpen,
  sortForAction,
  statusAfterCustomerMessage,
  SUPPORT_FILTERS,
  SUPPORT_QUEUE_LIMIT,
  supportNextAction,
  takeIntent,
  timelineUpdate,
  type QueueActionInput,
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

describe("fila para agir", () => {
  const row = (over: Partial<QueueActionInput> & { id?: string } = {}) => ({
    id: "x",
    status: "human_active" as const,
    assignedToMe: false,
    assigneeName: null,
    waitingReply: false,
    aiUrgent: false,
    lastMessageAt: "2026-11-06T11:00:00Z",
    ...over,
  });

  test("a visão padrão se chama Para agir e as URLs antigas continuam valendo", () => {
    expect(SUPPORT_FILTERS[0]).toEqual({ key: "open", label: "Para agir" });
    for (const key of ["open", "needs_human", "mine", "waiting", "resolved"]) expect(parseSupportFilter(key)).toBe(key);
  });

  test("cada linha diz, em texto, a próxima ação", () => {
    expect(supportNextAction(row({ status: "needs_human" }))).toMatchObject({ kind: "take", label: "Assumir atendimento" });
    expect(supportNextAction(row({ assignedToMe: true, assigneeName: "Ana", waitingReply: true }))).toMatchObject({ kind: "reply", label: "Responder" });
    expect(supportNextAction(row({ assigneeName: "Rui", aiUrgent: true }))).toMatchObject({ kind: "review_ai", label: "Revisar triagem IA" });
    expect(supportNextAction(row({ status: "waiting_customer", assignedToMe: true, assigneeName: "Ana" }))).toMatchObject({ kind: "waiting", label: "Aguardando cliente" });
    expect(supportNextAction(row({ assignedToMe: true, assigneeName: "Ana" }))).toMatchObject({ kind: "waiting", label: "Aguardando cliente" });
    expect(supportNextAction(row({ assigneeName: "Rui" }))).toMatchObject({ kind: "follow", label: "Com Rui" });
    expect(supportNextAction(row({ status: "ai_active" }))).toMatchObject({ kind: "follow", label: "Acompanhar IA" });
    expect(supportNextAction(row({ status: "resolved" }))).toMatchObject({ kind: "done", label: "Resolvida" });
  });

  test("respondida pelo celular, sem responsável, com o cliente por último: alguém precisa assumir", () => {
    expect(supportNextAction(row({ waitingReply: true }))).toMatchObject({ kind: "take", label: "Assumir atendimento" });
  });

  test("ordem: precisa de pessoa, depois minhas para responder, depois urgência IA, depois o resto", () => {
    const rows = [
      row({ id: "resto", assigneeName: "Rui", lastMessageAt: "2026-11-06T11:59:00Z" }),
      row({ id: "urgente", assigneeName: "Rui", aiUrgent: true, lastMessageAt: "2026-11-06T11:58:00Z" }),
      row({ id: "responder", assignedToMe: true, assigneeName: "Ana", waitingReply: true, lastMessageAt: "2026-11-06T11:57:00Z" }),
      row({ id: "pessoa", status: "needs_human", lastMessageAt: "2026-11-06T11:56:00Z" }),
      row({ id: "aguardando", status: "waiting_customer", assignedToMe: true, assigneeName: "Ana", lastMessageAt: "2026-11-06T11:55:00Z" }),
    ];
    expect(sortForAction(rows).map((r) => r.id)).toEqual(["pessoa", "responder", "urgente", "resto", "aguardando"]);
  });

  test("dentro de quem pede ação, urgência IA e a espera mais longa vêm primeiro; no resto, a mais recente", () => {
    const rows = [
      row({ id: "pessoa-nova", status: "needs_human", lastMessageAt: "2026-11-06T11:59:00Z" }),
      row({ id: "pessoa-antiga", status: "needs_human", lastMessageAt: "2026-11-06T09:00:00Z" }),
      row({ id: "pessoa-urgente", status: "needs_human", aiUrgent: true, lastMessageAt: "2026-11-06T11:59:30Z" }),
      row({ id: "resto-antigo", assigneeName: "Rui", lastMessageAt: "2026-11-06T08:00:00Z" }),
      row({ id: "resto-novo", assigneeName: "Rui", lastMessageAt: "2026-11-06T10:00:00Z" }),
    ];
    expect(sortForAction(rows).map((r) => r.id)).toEqual(["pessoa-urgente", "pessoa-antiga", "pessoa-nova", "resto-novo", "resto-antigo"]);
  });

  test("não muda a ordem original nem perde linha", () => {
    const rows = [row({ id: "a" }), row({ id: "b", status: "needs_human" })];
    const sorted = sortForAction(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(sorted).toHaveLength(2);
  });

  test("avisa em que trecho da fila paginada a pessoa está", () => {
    expect(SUPPORT_QUEUE_LIMIT).toBe(200);
    expect(queueLimitNotice(200, 340)).toBe("Mostrando 1–200 de 340 conversas, as que pedem ação primeiro.");
    expect(queueLimitNotice(140, 340, 2)).toBe("Mostrando 201–340 de 340 conversas, as que pedem ação primeiro.");
    expect(queueLimitNotice(0, 120, 3)).toBe("Nenhuma conversa nesta página. São 120 no total.");
    expect(queueLimitNotice(120, 120)).toBeNull();
    expect(queueLimitNotice(200, 200)).toBeNull();
  });

  test("a página vem da URL só como inteiro positivo", () => {
    expect(parseSupportPage(undefined)).toBe(1);
    expect(parseSupportPage("2")).toBe(2);
    expect(parseSupportPage("0")).toBe(1);
    expect(parseSupportPage("-3")).toBe(1);
    expect(parseSupportPage("1e9")).toBe(1);
    expect(parseSupportPage("9999999")).toBe(1);
  });
});

describe("assumir e passar adiante", () => {
  const conv = { status: "needs_human" as const, assignedToMe: false, assigneeName: null as string | null };

  test("assumir da IA explica o efeito antes de confirmar", () => {
    const intent = takeIntent({ ...conv, status: "ai_active" });
    if (!intent) throw new Error("A conversa da IA deveria poder ser assumida.");
    expect(intent.label).toBe("Assumir da IA");
    expect(intent.confirm?.effects.join(" ")).toMatch(/responsável/);
    expect(intent.confirm?.effects.join(" ")).toMatch(/IA (fica|é) pausada/);
  });

  test("assumir de outra pessoa também confirma, dizendo de quem", () => {
    const intent = takeIntent({ ...conv, status: "human_active", assigneeName: "Rui" });
    if (!intent) throw new Error("A conversa de outra pessoa deveria poder ser assumida.");
    expect(intent.label).toBe("Assumir de Rui");
    expect(intent.confirm?.effects.join(" ")).toMatch(/Rui deixa de ser/);
  });

  test("sem responsável, o rótulo diz o que acontece e não precisa de diálogo", () => {
    expect(takeIntent(conv)).toEqual({ label: "Assumir atendimento", confirm: null });
  });

  test("quem já é responsável não vê Assumir", () => {
    expect(takeIntent({ ...conv, status: "human_active", assignedToMe: true, assigneeName: "Ana" })).toBeNull();
    expect(takeIntent({ ...conv, status: "resolved" })).toBeNull();
  });

  const clans = [{ id: "c1", name: "Fiscal" }, { id: "c2", name: "RH" }];
  const people = [{ id: "u1", name: "Ana" }, { id: "u2", name: "Rui" }];
  const current = { clanId: "c1", userId: null as string | null };

  test("sem escolha, não há o que confirmar", () => {
    expect(handoffPlan({ clanId: null, userId: null, current, clans, people })).toEqual({ ok: false, reason: "Escolha um clã, uma pessoa ou os dois." });
  });

  test("escolher o que já está não transfere", () => {
    expect(handoffPlan({ clanId: "c1", userId: null, current, clans, people })).toEqual({ ok: false, reason: "A conversa já está com Fiscal." });
    expect(handoffPlan({ clanId: null, userId: "u1", current: { clanId: "c1", userId: "u1" }, clans, people })).toEqual({ ok: false, reason: "A conversa já está com Ana." });
  });

  test("só o clã: volta para a fila do clã, sem responsável", () => {
    expect(handoffPlan({ clanId: "c2", userId: null, current, clans, people })).toEqual({
      ok: true,
      clanId: "c2",
      userId: null,
      summary: "Vai para RH, sem responsável. Fica em Precisa de pessoa até alguém do clã assumir.",
    });
  });

  test("pessoa, com ou sem clã: ela vira a responsável", () => {
    expect(handoffPlan({ clanId: null, userId: "u2", current, clans, people })).toMatchObject({ ok: true, clanId: null, userId: "u2", summary: "Rui passa a ser responsável e a conversa fica Em atendimento. O setor continua Fiscal." });
    expect(handoffPlan({ clanId: "c2", userId: "u2", current, clans, people })).toMatchObject({ ok: true, clanId: "c2", userId: "u2", summary: "Rui passa a ser responsável e a conversa fica Em atendimento, no setor RH." });
  });

  test("opção que não existe na lista é recusada", () => {
    expect(handoffPlan({ clanId: "zz", userId: null, current, clans, people })).toEqual({ ok: false, reason: "Escolha um clã da lista." });
    expect(handoffPlan({ clanId: null, userId: "zz", current, clans, people })).toEqual({ ok: false, reason: "Escolha uma pessoa da lista." });
  });
});

describe("estado da resposta", () => {
  const base = { status: "human_active" as const, assignedUserId: "u1", viewerId: "u1", channelActive: true, lastCustomerMessageAt: new Date("2026-11-06T11:00:00Z"), now: NOW };

  test("cada bloqueio tem tipo, rótulo curto e a mesma frase de sempre", () => {
    expect(replyBlock(base)).toBeNull();
    expect(replyBlock({ ...base, status: "resolved" })).toMatchObject({ kind: "resolved", short: "Resolvida" });
    expect(replyBlock({ ...base, assignedUserId: "u2" })).toMatchObject({ kind: "not_assigned", short: "Assuma para responder" });
    expect(replyBlock({ ...base, channelActive: false })).toMatchObject({ kind: "channel_inactive", short: "Número inativo" });
    expect(replyBlock({ ...base, lastCustomerMessageAt: null })).toMatchObject({ kind: "window_closed", short: "Janela de 24 h fechada" });
    for (const input of [{ ...base, status: "resolved" as const }, { ...base, channelActive: false }, { ...base, lastCustomerMessageAt: null }]) {
      expect(replyBlock(input)?.message).toBe(replyBlockReason(input));
    }
  });

  test("o número inativo aponta para as configurações do atendimento", () => {
    expect(replyBlockReason({ ...base, channelActive: false })).toMatch(/Configurações do Atendimento/);
  });
});

describe("contagem de caracteres", () => {
  test("mostra o usado e o limite de cada tipo", () => {
    expect(REPLY_MAX_LENGTH).toBe(4096);
    expect(NOTE_MAX_LENGTH).toBe(4000);
    expect(characterCount("", "reply")).toEqual({ text: "0 / 4096", nearLimit: false });
    expect(characterCount("x".repeat(3900), "note")).toEqual({ text: "3900 / 4000", nearLimit: true });
  });
});

describe("rolagem da conversa", () => {
  test("está no fim com uma folga pequena", () => {
    expect(isScrolledToEnd({ scrollTop: 552, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isScrolledToEnd({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  test("só acompanha sozinha quem já está no fim; quem lê o histórico recebe o aviso", () => {
    expect(timelineUpdate({ previousLastId: "a", nextLastId: "b", atEnd: true })).toBe("follow");
    expect(timelineUpdate({ previousLastId: "a", nextLastId: "b", atEnd: false })).toBe("notify");
    expect(timelineUpdate({ previousLastId: "a", nextLastId: "a", atEnd: false })).toBe("none");
    expect(timelineUpdate({ previousLastId: "a", nextLastId: "a", atEnd: true })).toBe("none");
  });
});

describe("apresentação", () => {
  test("filtro desconhecido cai em Para agir", () => {
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
