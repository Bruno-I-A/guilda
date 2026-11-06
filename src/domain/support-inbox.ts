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
  { key: "open", label: "Abertas" },
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

/** Só quem assumiu responde: nunca duas pessoas no mesmo cliente sem saber. */
export function replyBlockReason(input: {
  status: SupportStatus;
  assignedUserId: string | null;
  viewerId: string;
  channelActive: boolean;
  lastCustomerMessageAt: Date | null;
  now: Date;
}): string | null {
  if (input.status === "resolved") return "Conversa resolvida. Reabra para responder.";
  if (input.assignedUserId !== input.viewerId) return "Assuma a conversa para responder.";
  if (!input.channelActive) return "O número do WhatsApp não está ativo. Confira em Configurações.";
  if (!replyWindowIsOpen(input.lastCustomerMessageAt, input.now)) {
    return "Passaram 24 horas desde a última mensagem do cliente. O WhatsApp só libera nova resposta quando ele escrever de novo.";
  }
  return null;
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

/** O texto da mensagem ou, sem texto, o que ela é: mídia ainda não abre na Guilda. */
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
