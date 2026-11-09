import "server-only";

import { createHash } from "node:crypto";

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, type SQL } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { isAdminRole } from "@/domain/guild-permissions";
import {
  canSeeConversation,
  deliveryState,
  messageLabel,
  replyBlockReason,
  statusAfterCustomerMessage,
  type DeliveryState,
  type SupportFilter,
  type SupportStatus,
  type SupportViewer,
} from "@/domain/support-inbox";
import { err, type ActionResult } from "@/lib/action-context";

import { clanForSector, SECTOR_LABELS } from "./triage/sectors";
import { loadLatestSuggestions, type SupportAiSuggestion } from "./triage/shadow";
import type { SetorValido } from "./triage/classificacao";

export { statusAfterCustomerMessage };

const c = schema.supportConversations;
const contacts = schema.supportContacts;
const messages = schema.supportMessages;

const QUEUE_LIMIT = 200;
const MESSAGE_LIMIT = 200;

export async function loadSupportViewer(tx: OrgTx, input: { orgId: string; userId: string; role: SupportViewer["role"] }): Promise<SupportViewer> {
  const m = schema.clanMemberships;
  const rows = await tx.select({ clanId: m.clanId }).from(m).where(and(eq(m.orgId, input.orgId), eq(m.userId, input.userId)));
  return { userId: input.userId, role: input.role, clanIds: rows.map((row) => row.clanId) };
}

/** A mesma régua de canSeeConversation, em SQL: o filtro roda antes de qualquer linha sair do banco. */
function visibleTo(viewer: SupportViewer): SQL | undefined {
  if (isAdminRole(viewer.role)) return undefined;
  return or(eq(c.assignedUserId, viewer.userId), viewer.clanIds.length ? inArray(c.assignedClanId, [...viewer.clanIds]) : undefined);
}

function filterWhere(filter: SupportFilter, viewer: SupportViewer): SQL | undefined {
  if (filter === "resolved") return eq(c.status, "resolved");
  if (filter === "needs_human") return eq(c.status, "needs_human");
  if (filter === "waiting") return eq(c.status, "waiting_customer");
  if (filter === "mine") return and(eq(c.assignedUserId, viewer.userId), ne(c.status, "resolved"));
  return ne(c.status, "resolved");
}

export interface SupportQueueRow {
  id: string;
  status: SupportStatus;
  contactName: string;
  phone: string | null;
  clientName: string | null;
  clanName: string | null;
  assigneeName: string | null;
  assignedToMe: boolean;
  lastMessageAt: string | null;
  lastMessage: string | null;
  /** A última fala é do cliente: alguém ainda precisa responder. */
  waitingReply: boolean;
  /** A IA, em sombra, leu como urgente. Só marca: a fila continua por ordem de chegada. */
  aiUrgent: boolean;
}

export async function loadSupportQueue(
  tx: OrgTx,
  input: { orgId: string; viewer: SupportViewer; filter: SupportFilter },
): Promise<{ rows: SupportQueueRow[]; counts: Record<SupportFilter, number> }> {
  const visible = visibleTo(input.viewer);
  const rows = await tx
    .select({
      id: c.id,
      status: c.status,
      assignedUserId: c.assignedUserId,
      lastMessageAt: c.lastMessageAt,
      displayName: contacts.displayName,
      phone: contacts.phoneE164,
      whatsappId: contacts.whatsappId,
      clientName: schema.clients.name,
      clanName: schema.clans.name,
      assigneeName: schema.user.name,
    })
    .from(c)
    .innerJoin(contacts, and(eq(contacts.orgId, c.orgId), eq(contacts.id, c.contactId)))
    .leftJoin(schema.clients, and(eq(schema.clients.orgId, contacts.orgId), eq(schema.clients.id, contacts.clientId)))
    .leftJoin(schema.clans, and(eq(schema.clans.orgId, c.orgId), eq(schema.clans.id, c.assignedClanId)))
    .leftJoin(schema.user, eq(schema.user.id, c.assignedUserId))
    .where(and(eq(c.orgId, input.orgId), filterWhere(input.filter, input.viewer), visible))
    .orderBy(desc(c.lastMessageAt))
    .limit(QUEUE_LIMIT);

  const ids = rows.map((row) => row.id);
  const lastMessages = ids.length
    ? await tx
        .selectDistinctOn([messages.conversationId], { conversationId: messages.conversationId, text: messages.text, messageType: messages.messageType, actor: messages.actor })
        .from(messages)
        .where(and(eq(messages.orgId, input.orgId), inArray(messages.conversationId, ids)))
        .orderBy(messages.conversationId, desc(messages.occurredAt))
    : [];
  const lastById = new Map(lastMessages.map((row) => [row.conversationId, row]));
  const suggestions = await loadLatestSuggestions(tx, input.orgId, ids);

  const statusCounts = await tx.select({ status: c.status, total: count() }).from(c).where(and(eq(c.orgId, input.orgId), visible)).groupBy(c.status);
  const [mine] = await tx
    .select({ total: count() })
    .from(c)
    .where(and(eq(c.orgId, input.orgId), filterWhere("mine", input.viewer), visible));
  const of = (status: SupportStatus) => statusCounts.find((row) => row.status === status)?.total ?? 0;

  return {
    rows: rows.map((row) => {
      const last = lastById.get(row.id);
      return {
        id: row.id,
        status: row.status,
        contactName: row.displayName ?? row.phone ?? row.whatsappId,
        phone: row.phone,
        clientName: row.clientName,
        clanName: row.clanName,
        assigneeName: row.assigneeName,
        assignedToMe: row.assignedUserId === input.viewer.userId,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
        lastMessage: last ? messageLabel(last) : null,
        waitingReply: last?.actor === "customer" && row.status !== "resolved",
        aiUrgent: row.status !== "resolved" && suggestions.get(row.id)?.urgency === "alta",
      };
    }),
    counts: {
      open: statusCounts.filter((row) => row.status !== "resolved").reduce((sum, row) => sum + row.total, 0),
      needs_human: of("needs_human"),
      mine: mine?.total ?? 0,
      waiting: of("waiting_customer"),
      resolved: of("resolved"),
    },
  };
}

export type SupportTimelineItem =
  | { kind: "message"; id: string; at: string; direction: "inbound" | "outbound"; author: string; text: string; isText: boolean; delivery: DeliveryState | null; failure: string | null }
  | { kind: "note"; id: string; at: string; author: string; text: string }
  | { kind: "event"; id: string; at: string; text: string };

export interface SupportConversationView {
  id: string;
  status: SupportStatus;
  assignedToMe: boolean;
  assignedUserId: string | null;
  assignedClanId: string | null;
  assigneeName: string | null;
  clanName: string | null;
  contactId: string;
  contactName: string;
  phone: string | null;
  client: { id: string; name: string; cnpj: string | null; taxRegime: string } | null;
  timeline: SupportTimelineItem[];
  replyBlocked: string | null;
  openTasks: { id: string; title: string; status: string }[];
  /** Para o resumo da missão criada a partir da conversa. */
  lastCustomerText: string | null;
  /** O que a IA faria, em sombra: nunca foi enviado ao cliente. */
  aiSuggestion: (SupportAiSuggestion & { sectorLabel: string; clan: { id: string; name: string } | null }) | null;
}

function eventLabel(eventType: string, actor: string | null, detail: Record<string, unknown>, status: string | undefined): string | null {
  const who = actor ?? "Sistema";
  if (eventType === "assigned") return typeof detail.note === "string" ? `${who}: ${detail.note}` : `${who} assumiu a conversa`;
  if (eventType === "resolved") return `${who} resolveu a conversa`;
  if (eventType === "reopened") return `${who} reabriu a conversa`;
  if (eventType === "contact_linked") return typeof detail.note === "string" ? `${who}: ${detail.note}` : null;
  if (eventType === "status_changed" && status) return `${who} marcou como aguardando cliente`;
  if (eventType === "ai_paused" && detail.reason === "business_app_message") return "Respondida pelo celular";
  return null;
}

export async function loadSupportConversation(
  tx: OrgTx,
  input: { orgId: string; viewer: SupportViewer; conversationId: string; now: Date },
): Promise<SupportConversationView | null> {
  const [row] = await tx
    .select({
      id: c.id,
      status: c.status,
      channelId: c.channelId,
      assignedClanId: c.assignedClanId,
      assignedUserId: c.assignedUserId,
      contactId: contacts.id,
      clientId: contacts.clientId,
      displayName: contacts.displayName,
      phone: contacts.phoneE164,
      whatsappId: contacts.whatsappId,
      clanName: schema.clans.name,
      assigneeName: schema.user.name,
      channelStatus: schema.supportWhatsAppChannels.status,
    })
    .from(c)
    .innerJoin(contacts, and(eq(contacts.orgId, c.orgId), eq(contacts.id, c.contactId)))
    .innerJoin(schema.supportWhatsAppChannels, and(eq(schema.supportWhatsAppChannels.orgId, c.orgId), eq(schema.supportWhatsAppChannels.id, c.channelId)))
    .leftJoin(schema.clans, and(eq(schema.clans.orgId, c.orgId), eq(schema.clans.id, c.assignedClanId)))
    .leftJoin(schema.user, eq(schema.user.id, c.assignedUserId))
    .where(and(eq(c.orgId, input.orgId), eq(c.id, input.conversationId)));
  if (!row || !canSeeConversation(input.viewer, row)) return null;

  const recent = await tx
    .select({
      id: messages.id,
      direction: messages.direction,
      actor: messages.actor,
      source: messages.source,
      text: messages.text,
      messageType: messages.messageType,
      occurredAt: messages.occurredAt,
      sender: schema.user.name,
    })
    .from(messages)
    .leftJoin(schema.user, eq(schema.user.id, messages.sentByUserId))
    .where(and(eq(messages.orgId, input.orgId), eq(messages.conversationId, row.id)))
    .orderBy(desc(messages.occurredAt))
    .limit(MESSAGE_LIMIT);

  const contactName = row.displayName ?? row.phone ?? row.whatsappId;
  const events = schema.supportMessageEvents;
  const outboundIds = recent.filter((message) => message.direction === "outbound").map((message) => message.id);
  const deliveries = outboundIds.length
    ? await tx.select({ messageId: events.messageId, eventType: events.eventType, detail: events.detail }).from(events).where(and(eq(events.orgId, input.orgId), inArray(events.messageId, outboundIds)))
    : [];

  const notesTable = schema.supportConversationNotes;
  const notes = await tx
    .select({ id: notesTable.id, text: notesTable.text, createdAt: notesTable.createdAt, author: schema.user.name })
    .from(notesTable)
    .innerJoin(schema.user, eq(schema.user.id, notesTable.authorId))
    .where(and(eq(notesTable.orgId, input.orgId), eq(notesTable.conversationId, row.id)))
    .orderBy(asc(notesTable.createdAt));

  const eventsTable = schema.supportConversationEvents;
  const history = await tx
    .select({ id: eventsTable.id, eventType: eventsTable.eventType, detail: eventsTable.detail, createdAt: eventsTable.createdAt, actor: schema.user.name })
    .from(eventsTable)
    .leftJoin(schema.user, eq(schema.user.id, eventsTable.actorUserId))
    .where(and(eq(eventsTable.orgId, input.orgId), eq(eventsTable.conversationId, row.id)))
    .orderBy(asc(eventsTable.createdAt));

  const timeline: SupportTimelineItem[] = [
    ...recent.map((message): SupportTimelineItem => {
      const own = deliveries.filter((event) => event.messageId === message.id);
      const failed = own.find((event) => event.eventType === "failed");
      return {
        kind: "message",
        id: message.id,
        at: message.occurredAt.toISOString(),
        direction: message.direction,
        author: message.direction === "inbound" ? contactName : message.source === "business_app" ? "Celular" : message.source === "guilda_ai" ? "IA" : (message.sender ?? "Equipe"),
        text: messageLabel(message),
        isText: message.text !== null,
        delivery: message.direction === "outbound" && message.source !== "business_app" ? deliveryState(own.map((event) => event.eventType)) : null,
        failure: failed && typeof failed.detail.message === "string" ? failed.detail.message : null,
      };
    }),
    ...notes.map((note): SupportTimelineItem => ({ kind: "note", id: note.id, at: note.createdAt.toISOString(), author: note.author, text: note.text })),
    ...history.flatMap((event): SupportTimelineItem[] => {
      const text = eventLabel(event.eventType, event.actor, event.detail, "waiting");
      return text ? [{ kind: "event", id: event.id, at: event.createdAt.toISOString(), text }] : [];
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const [lastCustomer] = await tx
    .select({ occurredAt: messages.occurredAt, text: messages.text })
    .from(messages)
    .where(and(eq(messages.orgId, input.orgId), eq(messages.conversationId, row.id), eq(messages.actor, "customer")))
    .orderBy(desc(messages.occurredAt))
    .limit(1);

  const client = row.clientId
    ? (
        await tx
          .select({ id: schema.clients.id, name: schema.clients.name, cnpj: schema.clients.cnpj, taxRegime: schema.clients.taxRegime })
          .from(schema.clients)
          .where(and(eq(schema.clients.orgId, input.orgId), eq(schema.clients.id, row.clientId)))
      )[0]
    : undefined;
  const tasks = schema.tasks;
  const openTasks = row.clientId
    ? await tx
        .select({ id: tasks.id, title: tasks.title, status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.orgId, input.orgId), eq(tasks.clientId, row.clientId), notInArray(tasks.status, ["completed", "cancelled"])))
        .orderBy(desc(tasks.createdAt))
        .limit(5)
    : [];

  const suggestion = (await loadLatestSuggestions(tx, input.orgId, [row.id])).get(row.id);
  const clanOptions = suggestion
    ? await tx.select({ id: schema.clans.id, name: schema.clans.name, slug: schema.clans.slug }).from(schema.clans).where(and(eq(schema.clans.orgId, input.orgId), eq(schema.clans.active, true)))
    : [];
  const sector = (suggestion?.sector ?? "outro") as SetorValido;
  const suggestedClan = suggestion ? clanForSector(sector, clanOptions) : null;

  return {
    aiSuggestion: suggestion
      ? { ...suggestion, sectorLabel: SECTOR_LABELS[sector] ?? suggestion.sector, clan: suggestedClan ? { id: suggestedClan.id, name: suggestedClan.name } : null }
      : null,
    id: row.id,
    status: row.status,
    assignedToMe: row.assignedUserId === input.viewer.userId,
    assignedUserId: row.assignedUserId,
    assignedClanId: row.assignedClanId,
    assigneeName: row.assigneeName,
    clanName: row.clanName,
    contactId: row.contactId,
    contactName,
    phone: row.phone,
    client: client ?? null,
    timeline,
    replyBlocked: replyBlockReason({
      status: row.status,
      assignedUserId: row.assignedUserId,
      viewerId: input.viewer.userId,
      channelActive: row.channelStatus === "active",
      lastCustomerMessageAt: lastCustomer?.occurredAt ?? null,
      now: input.now,
    }),
    openTasks,
    lastCustomerText: lastCustomer?.text ?? null,
  };
}

/** Número conectado? Sem nenhum, a tela explica como conectar em vez de ficar vazia. */
export async function countActiveSupportChannels(tx: OrgTx, orgId: string): Promise<number> {
  const ch = schema.supportWhatsAppChannels;
  const [row] = await tx.select({ total: count() }).from(ch).where(and(eq(ch.orgId, orgId), eq(ch.status, "active"), isNotNull(ch.phoneNumberId)));
  return row?.total ?? 0;
}

type Command = { orgId: string; viewer: SupportViewer; conversationId: string; now: Date };

/** Trava a conversa e confere a visibilidade: conversa alheia responde como inexistente. */
async function lockConversation(tx: OrgTx, input: Command) {
  const [row] = await tx
    .select({ id: c.id, status: c.status, channelId: c.channelId, contactId: c.contactId, assignedClanId: c.assignedClanId, assignedUserId: c.assignedUserId, aiPausedAt: c.aiPausedAt })
    .from(c)
    .where(and(eq(c.orgId, input.orgId), eq(c.id, input.conversationId)))
    .for("update");
  return row && canSeeConversation(input.viewer, row) ? row : null;
}

const NOT_FOUND = "Conversa não encontrada.";

/** Assumir pausa a IA na mesma transação: nunca há IA e pessoa respondendo juntas. */
export async function takeSupportConversation(tx: OrgTx, input: Command): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  if (row.status === "resolved") return err("Conversa resolvida. Reabra para atender.");
  if (row.assignedUserId === input.viewer.userId && row.status === "human_active") return { ok: true };
  await tx
    .update(c)
    .set({ status: "human_active", assignedUserId: input.viewer.userId, aiPausedAt: row.aiPausedAt ?? input.now, aiPauseReason: "attendant_took_over", updatedAt: input.now })
    .where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  await tx.insert(schema.supportConversationEvents).values({ orgId: input.orgId, conversationId: row.id, eventType: "assigned", actorUserId: input.viewer.userId, source: "guilda_attendant", detail: {} });
  return { ok: true };
}

export async function markSupportWaiting(tx: OrgTx, input: Command): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  if (row.status === "resolved") return err("Conversa resolvida.");
  if (row.assignedUserId !== input.viewer.userId) return err("Assuma a conversa primeiro.");
  await tx.update(c).set({ status: "waiting_customer", updatedAt: input.now }).where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  await tx.insert(schema.supportConversationEvents).values({ orgId: input.orgId, conversationId: row.id, eventType: "status_changed", actorUserId: input.viewer.userId, source: "guilda_attendant", detail: { to: "waiting_customer" } });
  return { ok: true };
}

export async function resolveSupportConversation(tx: OrgTx, input: Command): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  if (row.status === "resolved") return { ok: true };
  await tx.update(c).set({ status: "resolved", resolvedAt: input.now, updatedAt: input.now }).where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  await tx.insert(schema.supportConversationEvents).values({ orgId: input.orgId, conversationId: row.id, eventType: "resolved", actorUserId: input.viewer.userId, source: "guilda_attendant", detail: {} });
  return { ok: true };
}

export async function reopenSupportConversation(tx: OrgTx, input: Command): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  if (row.status !== "resolved") return { ok: true };
  // Só pode haver uma conversa aberta por contato: o cliente pode já ter escrito de novo.
  const [open] = await tx
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.orgId, input.orgId), eq(c.channelId, row.channelId), eq(c.contactId, row.contactId), isNull(c.resolvedAt)))
    .limit(1);
  if (open) return err("Este cliente já tem outra conversa aberta. Continue por ela.");
  await tx
    .update(c)
    .set({ status: "human_active", resolvedAt: null, assignedUserId: input.viewer.userId, aiPausedAt: input.now, aiPauseReason: "attendant_took_over", updatedAt: input.now })
    .where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  await tx.insert(schema.supportConversationEvents).values({ orgId: input.orgId, conversationId: row.id, eventType: "reopened", actorUserId: input.viewer.userId, source: "guilda_attendant", detail: {} });
  return { ok: true };
}

/**
 * Passa a conversa para um clã, ou direto para uma pessoa. Ambos são conferidos
 * na organização: o navegador só escolhe.
 */
export async function transferSupportConversation(tx: OrgTx, input: Command & { clanId: string | null; userId: string | null }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  if (row.status === "resolved") return err("Conversa resolvida. Reabra para transferir.");
  if (!input.clanId && !input.userId) return err("Escolha um clã ou uma pessoa.");
  let clanName: string | null = null;
  if (input.clanId) {
    const [clan] = await tx.select({ name: schema.clans.name }).from(schema.clans).where(and(eq(schema.clans.orgId, input.orgId), eq(schema.clans.id, input.clanId)));
    if (!clan) return err("Clã não encontrado.");
    clanName = clan.name;
  }
  let personName: string | null = null;
  if (input.userId) {
    const [person] = await tx
      .select({ name: schema.user.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(and(eq(schema.member.organizationId, input.orgId), eq(schema.member.userId, input.userId)));
    if (!person) return err("Pessoa não encontrada.");
    personName = person.name;
  }
  await tx
    .update(c)
    .set({
      status: input.userId ? "human_active" : "needs_human",
      assignedUserId: input.userId,
      assignedClanId: input.clanId ?? row.assignedClanId,
      aiPausedAt: row.aiPausedAt ?? input.now,
      aiPauseReason: "attendant_took_over",
      updatedAt: input.now,
    })
    .where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  await tx.insert(schema.supportConversationEvents).values({
    orgId: input.orgId,
    conversationId: row.id,
    eventType: "assigned",
    actorUserId: input.viewer.userId,
    source: "guilda_attendant",
    detail: { note: `transferiu para ${personName ?? clanName}`, clanId: input.clanId, userId: input.userId },
  });
  return { ok: true };
}

/** O vínculo com a empresa é manual: número parecido não prova de quem é a conversa. */
export async function linkSupportContact(tx: OrgTx, input: Command & { clientId: string | null }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  let clientName: string | null = null;
  if (input.clientId) {
    const [client] = await tx.select({ name: schema.clients.name }).from(schema.clients).where(and(eq(schema.clients.orgId, input.orgId), eq(schema.clients.id, input.clientId)));
    if (!client) return err("Empresa não encontrada.");
    clientName = client.name;
  }
  await tx
    .update(contacts)
    .set(input.clientId ? { clientId: input.clientId, linkedBy: input.viewer.userId, linkedAt: input.now, updatedAt: input.now } : { clientId: null, linkedBy: null, linkedAt: null, updatedAt: input.now })
    .where(and(eq(contacts.orgId, input.orgId), eq(contacts.id, row.contactId)));
  await tx.insert(schema.supportConversationEvents).values({
    orgId: input.orgId,
    conversationId: row.id,
    eventType: "contact_linked",
    actorUserId: input.viewer.userId,
    source: "guilda_attendant",
    detail: { note: clientName ? `vinculou a ${clientName}` : "desfez o vínculo com a empresa", clientId: input.clientId },
  });
  return { ok: true };
}

/** Nota interna: só a equipe vê, nunca vai para o cliente. */
export async function addSupportNote(tx: OrgTx, input: Command & { text: string }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  await tx.insert(schema.supportConversationNotes).values({ orgId: input.orgId, conversationId: row.id, authorId: input.viewer.userId, text: input.text });
  return { ok: true };
}

/**
 * Responde o cliente: grava a mensagem e a saída na mesma transação, e o
 * processo de atendimento entrega à Meta. O telefone sai do cadastro do contato,
 * nunca do navegador. A chave do formulário impede a mensagem em dobro.
 */
export async function sendSupportReply(tx: OrgTx, input: Command & { text: string; requestId: string }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  const events = schema.supportMessageEvents;
  const queuedKey = createHash("sha256").update(`reply\0${row.id}\0${input.requestId}`, "utf8").digest("hex");
  const [already] = await tx.select({ id: events.id }).from(events).where(and(eq(events.orgId, input.orgId), eq(events.providerEventKey, queuedKey))).limit(1);
  if (already) return { ok: true };

  const ch = schema.supportWhatsAppChannels;
  const [channel] = await tx.select({ status: ch.status }).from(ch).where(and(eq(ch.orgId, input.orgId), eq(ch.id, row.channelId)));
  const [contact] = await tx.select({ whatsappId: contacts.whatsappId }).from(contacts).where(and(eq(contacts.orgId, input.orgId), eq(contacts.id, row.contactId)));
  const [lastCustomer] = await tx
    .select({ occurredAt: messages.occurredAt })
    .from(messages)
    .where(and(eq(messages.orgId, input.orgId), eq(messages.conversationId, row.id), eq(messages.actor, "customer")))
    .orderBy(desc(messages.occurredAt))
    .limit(1);
  const blocked = replyBlockReason({
    status: row.status,
    assignedUserId: row.assignedUserId,
    viewerId: input.viewer.userId,
    channelActive: channel?.status === "active",
    lastCustomerMessageAt: lastCustomer?.occurredAt ?? null,
    now: input.now,
  });
  if (blocked) return err(blocked);
  if (!contact) return err(NOT_FOUND);

  const [message] = await tx
    .insert(messages)
    .values({
      orgId: input.orgId,
      channelId: row.channelId,
      conversationId: row.id,
      direction: "outbound",
      actor: "attendant",
      source: "guilda_attendant",
      messageType: "text",
      text: input.text,
      sentByUserId: input.viewer.userId,
      occurredAt: input.now,
    })
    .returning({ id: messages.id });
  await tx.insert(events).values({ orgId: input.orgId, messageId: message.id, eventType: "queued", providerEventKey: queuedKey, occurredAt: input.now });
  await tx.insert(schema.supportOutbox).values({ orgId: input.orgId, channelId: row.channelId, messageId: message.id, payload: { to: contact.whatsappId, text: input.text } });
  await tx.update(c).set({ lastMessageAt: input.now, updatedAt: input.now }).where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  return { ok: true };
}
