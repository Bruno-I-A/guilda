import { isAdminRole } from "./guild-permissions";
import type { OrgRole } from "./task-state";

/**
 * Regras puras da caixa de entrada do atendimento. O servidor aplica todas
 * elas: a tela só as repete para não oferecer o que seria recusado.
 */

export type SupportStatus = "ai_active" | "needs_human" | "human_active" | "waiting_customer" | "resolved";

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  ai_active: "IA atendendo",
  needs_human: "Precisa de pessoa",
  human_active: "Em atendimento",
  waiting_customer: "Aguardando cliente",
  resolved: "Resolvida",
};

export type SupportFilter = "open" | "needs_human" | "mine" | "waiting" | "resolved";

export const SUPPORT_FILTERS: readonly { key: SupportFilter; label: string }[] = [
  // `open` continua sendo a chave da URL: links antigos (`?f=open` ou sem `f`) seguem válidos.
  { key: "open", label: "Para agir" },
  { key: "needs_human", label: "Precisa de pessoa" },
  { key: "mine", label: "Minhas" },
  { key: "waiting", label: "Aguardando cliente" },
  { key: "resolved", label: "Resolvidas" },
];

export function parseSupportFilter(value: string | undefined): SupportFilter {
  return SUPPORT_FILTERS.some((filter) => filter.key === value) ? (value as SupportFilter) : "open";
}

export interface SupportViewer {
  userId: string;
  role: OrgRole;
  clanIds: readonly string[];
}

/** Admin vê tudo; membro vê as filas dos clãs dele e o que está atribuído a ele. */
export function canSeeConversation(
  viewer: SupportViewer,
  conversation: { assignedClanId: string | null; assignedUserId: string | null },
): boolean {
  if (isAdminRole(viewer.role)) return true;
  if (conversation.assignedUserId === viewer.userId) return true;
  return conversation.assignedClanId !== null && viewer.clanIds.includes(conversation.assignedClanId);
}

/** A Meta só aceita texto livre até 24 horas depois da última mensagem do cliente. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function replyWindowIsOpen(lastCustomerMessageAt: Date | null, now: Date): boolean {
  return lastCustomerMessageAt !== null && now.getTime() - lastCustomerMessageAt.getTime() < REPLY_WINDOW_MS;
}

type ReplyBlockInput = {
  status: SupportStatus;
  assignedUserId: string | null;
  viewerId: string;
  channelActive: boolean;
  lastCustomerMessageAt: Date | null;
  now: Date;
};

export type ReplyBlockKind = "resolved" | "not_assigned" | "channel_inactive" | "window_closed";

/** Por que não dá para responder, em rótulo curto (cabeçalho) e frase completa (compositor). */
export interface ReplyBlock {
  kind: ReplyBlockKind;
  short: string;
  message: string;
}

/** Só quem assumiu responde: nunca duas pessoas no mesmo cliente sem saber. */
export function replyBlock(input: ReplyBlockInput): ReplyBlock | null {
  if (input.status === "resolved") return { kind: "resolved", short: "Resolvida", message: "Conversa resolvida. Reabra para responder." };
  if (input.assignedUserId !== input.viewerId) return { kind: "not_assigned", short: "Assuma para responder", message: "Assuma a conversa para responder." };
  if (!input.channelActive) return { kind: "channel_inactive", short: "Número inativo", message: "O número do WhatsApp não está ativo. Confira em Configurações do Atendimento." };
  if (!replyWindowIsOpen(input.lastCustomerMessageAt, input.now)) {
    return {
      kind: "window_closed",
      short: "Janela de 24 h fechada",
      message: "Passaram 24 horas desde a última mensagem do cliente: pela Guilda, só quando ele escrever de novo. Para falar antes, responda pelo celular ou pelo WhatsApp Web do escritório.",
    };
  }
  return null;
}

export function replyBlockReason(input: ReplyBlockInput): string | null {
  return replyBlock(input)?.message ?? null;
}

/** Limites do servidor: 4096 é o da Cloud API; a nota é só da Guilda. */
export const REPLY_MAX_LENGTH = 4096;
export const NOTE_MAX_LENGTH = 4000;

export function characterCount(text: string, kind: "reply" | "note"): { text: string; nearLimit: boolean } {
  const max = kind === "reply" ? REPLY_MAX_LENGTH : NOTE_MAX_LENGTH;
  return { text: `${text.length} / ${max}`, nearLimit: text.length >= max * 0.9 };
}

/* ── Fila para agir ─────────────────────────────────────────────────────── */

/**
 * Tamanho da página da fila. A ordem de Para agir é aplicada no banco ANTES do
 * corte, então a primeira página sempre traz quem precisa de ação; o resto é
 * alcançável pelas páginas seguintes (`?p=`), nunca escondido.
 */
export const SUPPORT_QUEUE_LIMIT = 200;

/** Página da fila vinda da URL: inteiro de 1 em diante; qualquer outra coisa é a primeira. */
export function parseSupportPage(value: string | undefined): number {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

export function queueLimitNotice(shown: number, total: number, page = 1): string | null {
  if (total <= SUPPORT_QUEUE_LIMIT && page === 1) return null;
  if (shown === 0) return `Nenhuma conversa nesta página. São ${total} no total.`;
  const from = (page - 1) * SUPPORT_QUEUE_LIMIT + 1;
  return `Mostrando ${from}–${from + shown - 1} de ${total} conversas, as que pedem ação primeiro.`;
}

export interface QueueActionInput {
  status: SupportStatus;
  assignedToMe: boolean;
  assigneeName: string | null;
  /** A última fala é do cliente. */
  waitingReply: boolean;
  aiUrgent: boolean;
  lastMessageAt: string | null;
}

export type SupportNextActionKind = "take" | "reply" | "review_ai" | "waiting" | "follow" | "done";

export interface SupportNextAction {
  kind: SupportNextActionKind;
  label: string;
}

/**
 * A próxima ação de cada linha, em texto, só com o que a fila já sabe. Quem não
 * tem dono e tem o cliente por último precisa de alguém (inclusive a conversa
 * respondida pelo celular, que fica Em atendimento sem responsável).
 */
export function supportNextAction(row: QueueActionInput): SupportNextAction {
  if (row.status === "resolved") return { kind: "done", label: "Resolvida" };
  if (row.status === "needs_human") return { kind: "take", label: "Assumir atendimento" };
  if (row.status === "ai_active") return row.aiUrgent ? { kind: "review_ai", label: "Revisar triagem IA" } : { kind: "follow", label: "Acompanhar IA" };
  if (row.assignedToMe) {
    return row.waitingReply && row.status !== "waiting_customer" ? { kind: "reply", label: "Responder" } : { kind: "waiting", label: "Aguardando cliente" };
  }
  if (!row.assigneeName && row.waitingReply && row.status !== "waiting_customer") return { kind: "take", label: "Assumir atendimento" };
  if (row.aiUrgent) return { kind: "review_ai", label: "Revisar triagem IA" };
  if (row.status === "waiting_customer") return { kind: "waiting", label: "Aguardando cliente" };
  if (row.assigneeName) return { kind: "follow", label: `Com ${row.assigneeName}` };
  return { kind: "waiting", label: "Aguardando cliente" };
}

const ACTION_TIER: Record<SupportNextActionKind, number> = { take: 0, reply: 1, review_ai: 2, waiting: 3, follow: 3, done: 3 };

function timeOf(value: string | null): number | null {
  return value === null ? null : new Date(value).getTime();
}

/**
 * Para agir: precisa de pessoa, depois as minhas para responder, depois urgência
 * da IA; o resto vem abaixo. Onde há ação, urgência IA e a espera mais longa
 * primeiro; no resto, a mais recente. Devolve uma cópia.
 */
export function sortForAction<T extends QueueActionInput>(rows: readonly T[]): T[] {
  const keyed = rows.map((row, index) => ({ row, index, tier: ACTION_TIER[supportNextAction(row).kind], at: timeOf(row.lastMessageAt) }));
  keyed.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const acting = a.tier < 3;
    if (acting && a.row.aiUrgent !== b.row.aiUrgent) return a.row.aiUrgent ? -1 : 1;
    if (a.at !== b.at) {
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return acting ? a.at - b.at : b.at - a.at;
    }
    return a.index - b.index;
  });
  return keyed.map((item) => item.row);
}

/* ── Assumir e passar adiante ───────────────────────────────────────────── */

export interface TakeIntent {
  label: string;
  /** Efeitos ditos antes de mutar; null quando assumir não tira a conversa de ninguém. */
  confirm: { title: string; effects: string[] } | null;
}

export function takeIntent(conversation: { status: SupportStatus; assignedToMe: boolean; assigneeName: string | null }): TakeIntent | null {
  if (conversation.status === "resolved" || conversation.assignedToMe) return null;
  if (conversation.status === "ai_active") {
    return {
      label: "Assumir da IA",
      confirm: {
        title: "Assumir esta conversa da IA?",
        effects: ["Você passa a ser o responsável e só você responde o cliente por aqui.", "A IA fica pausada nesta conversa e não responde mais sozinha."],
      },
    };
  }
  if (conversation.assigneeName) {
    return {
      label: `Assumir de ${conversation.assigneeName}`,
      confirm: {
        title: `Assumir a conversa de ${conversation.assigneeName}?`,
        effects: ["Você passa a ser o responsável e só você responde o cliente por aqui.", `${conversation.assigneeName} deixa de ser o responsável e não responde mais por aqui.`],
      },
    };
  }
  return { label: "Assumir atendimento", confirm: null };
}

type Named = { id: string; name: string };

export type HandoffPlan = { ok: false; reason: string } | { ok: true; clanId: string | null; userId: string | null; summary: string };

/**
 * O que vai acontecer ao passar a conversa, antes de confirmar. Espelha
 * transferSupportConversation: só clã tira o responsável; pessoa vira a
 * responsável. O servidor continua conferindo clã e pessoa na organização.
 */
export function handoffPlan(input: {
  clanId: string | null;
  userId: string | null;
  current: { clanId: string | null; userId: string | null };
  clans: readonly Named[];
  people: readonly Named[];
}): HandoffPlan {
  if (!input.clanId && !input.userId) return { ok: false, reason: "Escolha um clã, uma pessoa ou os dois." };
  const clan = input.clanId ? input.clans.find((item) => item.id === input.clanId) : null;
  if (input.clanId && !clan) return { ok: false, reason: "Escolha um clã da lista." };
  const person = input.userId ? input.people.find((item) => item.id === input.userId) : null;
  if (input.userId && !person) return { ok: false, reason: "Escolha uma pessoa da lista." };

  const nextClanId = input.clanId ?? input.current.clanId;
  if (nextClanId === input.current.clanId && input.userId === input.current.userId) {
    return { ok: false, reason: `A conversa já está com ${person?.name ?? clan?.name}.` };
  }
  if (!person) {
    return { ok: true, clanId: input.clanId, userId: null, summary: `Vai para ${clan!.name}, sem responsável. Fica em Precisa de pessoa até alguém do clã assumir.` };
  }
  if (clan) {
    return { ok: true, clanId: input.clanId, userId: input.userId, summary: `${person.name} passa a ser responsável e a conversa fica Em atendimento, no setor ${clan.name}.` };
  }
  const currentClan = input.clans.find((item) => item.id === input.current.clanId);
  return {
    ok: true,
    clanId: null,
    userId: input.userId,
    summary: `${person.name} passa a ser responsável e a conversa fica Em atendimento. ${currentClan ? `O setor continua ${currentClan.name}.` : "Continua sem setor."}`,
  };
}

/* ── Rolagem da conversa ────────────────────────────────────────────────── */

/** Folga para considerar "no fim": arredondamento e a última linha meio visível. */
const END_SLACK_PX = 48;

export function isScrolledToEnd(box: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= END_SLACK_PX;
}

/** Na atualização periódica, só acompanha quem já está no fim; quem lê o histórico recebe o aviso. */
export function timelineUpdate(input: { previousLastId: string | null; nextLastId: string | null; atEnd: boolean }): "follow" | "notify" | "none" {
  if (input.previousLastId === input.nextLastId) return "none";
  return input.atEnd ? "follow" : "notify";
}

/** Mensagem do cliente que chega enquanto se esperava por ele traz a conversa de volta. */
export function statusAfterCustomerMessage(status: SupportStatus, assignedUserId: string | null): SupportStatus {
  if (status !== "waiting_customer") return status;
  return assignedUserId ? "human_active" : "needs_human";
}

export function elapsedLabel(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

const TYPE_LABELS: Record<string, string> = {
  image: "Imagem",
  audio: "Áudio",
  document: "Documento",
  video: "Vídeo",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  interactive: "Resposta de botão",
  reaction: "Reação",
  unsupported: "Mensagem não suportada",
};

/** O texto da mensagem ou, sem texto, o rótulo usado na fila de conversas. */
export function messageLabel(message: { text: string | null; messageType: string }): string {
  return message.text ?? TYPE_LABELS[message.messageType] ?? "Mensagem";
}

/** Situação de envio a partir dos eventos, do mais recente para o mais antigo. */
export type DeliveryState = "sending" | "sent" | "delivered" | "read" | "failed";

const DELIVERY_RANK: Record<string, DeliveryState> = { queued: "sending", accepted: "sent", sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
const DELIVERY_ORDER: readonly DeliveryState[] = ["sending", "sent", "delivered", "read"];

export function deliveryState(events: readonly string[]): DeliveryState {
  if (events.includes("failed")) return "failed";
  let best = 0;
  for (const event of events) {
    const state = DELIVERY_RANK[event];
    if (state) best = Math.max(best, DELIVERY_ORDER.indexOf(state));
  }
  return DELIVERY_ORDER[best];
}

export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Não enviada",
};

const META_ERRORS: Record<number, string> = {
  131047: "Passaram 24 horas desde a última mensagem do cliente.",
  131026: "O número não pôde receber a mensagem.",
  131031: "O número do WhatsApp da empresa está bloqueado na Meta.",
  190: "O acesso ao WhatsApp expirou. Reconecte em Configurações.",
};

export function metaErrorMessage(code: number | undefined): string {
  return (code !== undefined && META_ERRORS[code]) || "A Meta recusou o envio.";
}
