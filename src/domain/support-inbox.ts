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

/**
 * A caixa não é um histórico de estados: ela é a distribuição do trabalho.
 * "open" é a fila geral, isto é, conversas que ninguém assumiu ainda.
 */
export type SupportFilter = "open" | "needs_human" | "mine";

export const SUPPORT_FILTERS: readonly { key: SupportFilter; label: string }[] = [
  { key: "open", label: "Abertas" },
  { key: "needs_human", label: "Precisa de pessoa" },
  { key: "mine", label: "Minhas" },
];

export function parseSupportFilter(value: string | undefined): SupportFilter {
  return SUPPORT_FILTERS.some((filter) => filter.key === value) ? (value as SupportFilter) : "open";
}

export interface SupportViewer {
  userId: string;
  role: OrgRole;
  clanIds: readonly string[];
}

/** A Meta só aceita texto livre até 24 horas depois da última mensagem do cliente. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function replyWindowIsOpen(lastCustomerMessageAt: Date | null, now: Date): boolean {
  return lastCustomerMessageAt !== null && now.getTime() - lastCustomerMessageAt.getTime() < REPLY_WINDOW_MS;
}

/**
 * Quem vê a conversa responde, sem precisar assumir (2026-11-24, pedido do
 * Bruno; antes só quem assumiu). Todo integrante vê todas as conversas da
 * organização; o que a resposta muda na conversa é conversationAfterTeamReply.
 */
export function replyBlockReason(input: {
  status: SupportStatus;
  channelActive: boolean;
  lastCustomerMessageAt: Date | null;
  now: Date;
}): string | null {
  if (input.status === "resolved") return "Conversa resolvida. Reabra para responder.";
  if (!input.channelActive) return "O número do WhatsApp não está ativo. Confira em Configurações.";
  if (!replyWindowIsOpen(input.lastCustomerMessageAt, input.now)) {
    return "Passaram 24 horas desde a última mensagem do cliente: pela Guilda, só quando ele escrever de novo. Para falar antes, responda pelo celular ou pelo WhatsApp Web do escritório.";
  }
  return null;
}

/**
 * O que a resposta da equipe muda na conversa (2026-11-24, decisão do Bruno):
 * a conversa continua com quem está; sem responsável, fica com quem respondeu.
 * Sai de "IA atendendo" e de "Precisa de pessoa", e a IA para. Null: nada muda.
 */
export function conversationAfterTeamReply(input: {
  status: SupportStatus;
  assignedUserId: string | null;
  viewerId: string;
}): { status: SupportStatus; assignedUserId: string; takeOver: boolean; pauseAi: boolean } | null {
  if (!input.assignedUserId) return { status: "human_active", assignedUserId: input.viewerId, takeOver: true, pauseAi: true };
  if (input.status === "ai_active" || input.status === "needs_human") {
    return { status: "human_active", assignedUserId: input.assignedUserId, takeOver: false, pauseAi: input.status === "ai_active" };
  }
  return null;
}

/**
 * Enter envia, como no WhatsApp Web (2026-11-24, pedido do Bruno); Shift + Enter
 * quebra a linha. No celular (toque), Enter quebra a linha e o envio é o botão,
 * como no WhatsApp do celular. Ctrl/⌘ + Enter envia sempre.
 */
export function enterSends(input: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  coarsePointer: boolean;
}): boolean {
  if (input.key !== "Enter" || input.isComposing) return false;
  if (input.ctrlKey || input.metaKey) return true;
  return !input.shiftKey && !input.coarsePointer;
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

/** Telefone do Brasil como se lê, "(54) 99930-7239"; de outro país, como veio. */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : null;
  if (!local) return value;
  const area = local.slice(0, 2);
  const number = local.slice(2);
  return `(${area}) ${number.slice(0, number.length - 4)}-${number.slice(-4)}`;
}

export const CONTACT_NAME_MAX = 80;

/** Nome digitado pela equipe: espaços limpos, até 80 letras; vazio volta ao do WhatsApp. */
export function normalizeContactName(value: string): string | null {
  const clean = value.replace(/\s+/g, " ").trim().slice(0, CONTACT_NAME_MAX).trim();
  return clean || null;
}

/**
 * Nome do contato na tela (2026-11-24, pedido do Bruno): o dado pela equipe
 * vence o do perfil do WhatsApp, que a Meta reescreve a cada mensagem.
 */
export function contactName(input: { customName: string | null; displayName: string | null; phone: string | null; whatsappId: string }): string {
  return input.customName?.trim() || input.displayName?.trim() || formatPhone(input.phone ?? input.whatsappId);
}

/** Avatar legível mesmo quando o nome do WhatsApp começa com emoji ou é só um número. */
export function contactInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return "?";
  if (words.every((word) => /^\d+$/.test(word))) return "#";
  return words.slice(0, 2).map((word) => Array.from(word)[0].toLocaleUpperCase("pt-BR")).join("");
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
  131053: "A Meta não aceitou o arquivo.",
  190: "O acesso ao WhatsApp expirou. Reconecte em Configurações.",
};

export function metaErrorMessage(code: number | undefined): string {
  return (code !== undefined && META_ERRORS[code]) || "A Meta recusou o envio.";
}

/**
 * Frase da falha de envio. A recusa na hora já vem como frase (`message`); a
 * que a Meta avisa DEPOIS de aceitar (status "failed" do webhook, comum em
 * mídia) vem como `errors` da Meta. Antes essa segunda virava só "Não
 * enviada", sem dizer por quê (nota de voz, 2026-11-23). O código vai junto:
 * é ele que separa janela, número e arquivo recusado.
 */
export function deliveryFailureMessage(detail: Readonly<Record<string, unknown>>): string | null {
  if (typeof detail.message === "string") return detail.message;
  const first: unknown = Array.isArray(detail.errors) ? detail.errors[0] : undefined;
  const code = first && typeof first === "object" ? (first as { code?: unknown }).code : undefined;
  if (typeof code !== "number" || !Number.isInteger(code)) return null;
  return `${metaErrorMessage(code)} (código ${code} da Meta)`;
}
