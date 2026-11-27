import "server-only";

import { createHash } from "node:crypto";

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, notInArray, type SQL } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  contactName,
  conversationAfterTeamReply,
  deliveryFailureMessage,
  deliveryState,
  messageLabel,
  normalizeContactName,
  replyBlockReason,
  statusAfterCustomerMessage,
  type DeliveryState,
  type SupportFilter,
  type SupportStatus,
  type SupportViewer,
} from "@/domain/support-inbox";
import { documentFilename } from "@/domain/support-media";
import { validateSupportUpload } from "@/domain/support-upload";

import { loadTranscriptions, type TranscriptionStatus } from "./transcription";
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

/*
 * Quem vê (2026-11-24, decisão do Bruno): todo integrante da organização vê
 * todas as conversas e pode responder, como no WhatsApp do celular. Antes,
 * membro via só o próprio clã e o que era dele, e a conversa sem setor ficava
 * só com o admin. O isolamento entre organizações continua no RLS (withOrgTx).
 */

function filterWhere(filter: SupportFilter, viewer: SupportViewer): SQL | undefined {
  if (filter === "needs_human") return eq(c.status, "needs_human");
  if (filter === "mine") return and(eq(c.assignedUserId, viewer.userId), ne(c.status, "resolved"));
  // Fila geral: só o que ainda não chegou a nenhum atendente.
  return and(isNull(c.assignedUserId), ne(c.status, "resolved"));
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
  /** Quem falou por último, quando não foi o cliente: a prévia mostra "Você:" ou "IA:". */
  lastAuthor: "team" | "ai" | null;
  /** A IA, em sombra, leu como urgente. Só marca: a fila continua por ordem de chegada. */
  aiUrgent: boolean;
  /** Rodada do teste do agente aberta: a IA está conversando com o cliente. */
  agentTest: boolean;
}

export interface SupportForwardTarget {
  conversationId: string;
  contactName: string;
  phone: string | null;
  lastMessageAt: string | null;
}

/** Conversas abertas que podem receber um encaminhamento; a action confere a janela de 24 h. */
export async function loadSupportForwardTargets(tx: OrgTx, orgId: string): Promise<SupportForwardTarget[]> {
  const rows = await tx
    .select({
      conversationId: c.id,
      displayName: contacts.displayName,
      customName: contacts.customName,
      whatsappId: contacts.whatsappId,
      phone: contacts.phoneE164,
      lastMessageAt: c.lastMessageAt,
    })
    .from(c)
    .innerJoin(contacts, and(eq(contacts.orgId, c.orgId), eq(contacts.id, c.contactId)))
    .where(and(eq(c.orgId, orgId), ne(c.status, "resolved")))
    .orderBy(desc(c.lastMessageAt))
    .limit(QUEUE_LIMIT);
  return rows.map((row) => ({
    conversationId: row.conversationId,
    contactName: contactName(row),
    phone: row.phone,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
  }));
}

export async function loadSupportQueue(
  tx: OrgTx,
  input: { orgId: string; viewer: SupportViewer; filter: SupportFilter },
): Promise<{ rows: SupportQueueRow[]; counts: Record<SupportFilter, number> }> {

  const rows = await tx
    .select({
      id: c.id,
      status: c.status,
      assignedUserId: c.assignedUserId,
      aiTestStartedAt: c.aiTestStartedAt,
      lastMessageAt: c.lastMessageAt,
      displayName: contacts.displayName,
      customName: contacts.customName,
      phone: contacts.phoneE164,
      whatsappId: contacts.whatsappId,
      clientName: schema.clients.name,
      clanName: schema.clans.name,
      assigneeName: schema.user.name,
    })
    .from(c)
    .innerJoin(contacts, and(eq(contacts.orgId, c.orgId), eq(contacts.id, c.contactId)))
    .leftJoin(schema.clients, and(eq(schema.clients.orgId, c.orgId), eq(schema.clients.id, c.clientId)))
    .leftJoin(schema.clans, and(eq(schema.clans.orgId, c.orgId), eq(schema.clans.id, c.assignedClanId)))
    .leftJoin(schema.user, eq(schema.user.id, c.assignedUserId))
    .where(and(eq(c.orgId, input.orgId), filterWhere(input.filter, input.viewer)))
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

  const statusCounts = await tx.select({ status: c.status, total: count() }).from(c).where(eq(c.orgId, input.orgId)).groupBy(c.status);
  const [open] = await tx
    .select({ total: count() })
    .from(c)
    .where(and(eq(c.orgId, input.orgId), filterWhere("open", input.viewer)));
  const [mine] = await tx
    .select({ total: count() })
    .from(c)
    .where(and(eq(c.orgId, input.orgId), filterWhere("mine", input.viewer)));
  const of = (status: SupportStatus) => statusCounts.find((row) => row.status === status)?.total ?? 0;

  return {
    rows: rows.map((row) => {
      const last = lastById.get(row.id);
      return {
        id: row.id,
        status: row.status,
        contactName: contactName(row),
        phone: row.phone,
        clientName: row.clientName,
        clanName: row.clanName,
        assigneeName: row.assigneeName,
        assignedToMe: row.assignedUserId === input.viewer.userId,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
        lastMessage: last ? messageLabel(last) : null,
        waitingReply: last?.actor === "customer" && row.status !== "resolved",
        lastAuthor: !last || last.actor === "customer" ? null : last.actor === "ai" ? "ai" : "team",
        aiUrgent: row.status !== "resolved" && suggestions.get(row.id)?.urgency === "alta",
        agentTest: row.status === "ai_active" && row.aiTestStartedAt !== null,
      };
    }),
    counts: {
      open: open?.total ?? 0,
      needs_human: of("needs_human"),
      mine: mine?.total ?? 0,
    },
  };
}

export type SupportTimelineItem =
  | {
      kind: "message";
      id: string;
      at: string;
      direction: "inbound" | "outbound";
      author: string;
      text: string;
      isText: boolean;
      image: { src: string; caption: string | null } | null;
      /** Documento recebido (2026-11-23): baixa pela rota da Guilda; PDF abre no navegador. */
      file: { href: string; name: string; caption: string | null; isPdf: boolean } | null;
      /** Áudio recebido (2026-11-23): toca pela rota da Guilda, com o texto da transcrição. */
      audio: { src: string; transcript: string | null; status: TranscriptionStatus | null } | null;
      canReply: boolean;
      canForward: boolean;
      replyTo: { author: string; text: string } | null;
      forwarded: boolean;
      delivery: DeliveryState | null;
      failure: string | null;
    }
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
  /** Nome no perfil do WhatsApp; o da equipe (customName) vence na tela (2026-11-24). */
  whatsAppName: string | null;
  customName: string | null;
  phone: string | null;
  /** Empresa desta conversa (2026-11-23): uma das empresas do número. */
  client: { id: string; name: string; cnpj: string | null; taxRegime: string } | null;
  /** Empresas do número que escreveu: uma empresa tem vários números e um número várias empresas. */
  contactClients: { id: string; name: string; cnpj: string | null }[];
  timeline: SupportTimelineItem[];
  replyBlocked: string | null;
  openTasks: { id: string; title: string; status: string }[];
  /** Para o resumo da missão criada a partir da conversa. */
  lastCustomerText: string | null;
  /** O que a IA faria, em sombra: nunca foi enviado ao cliente. */
  aiSuggestion: (SupportAiSuggestion & { sectorLabel: string; clan: { id: string; name: string } | null }) | null;
  /** Rodada do teste do agente aberta: a IA está conversando com o cliente. */
  agentTest: boolean;
  /** Mensagens de atendimentos anteriores, exibidas no próprio chat quando solicitado. */
  previousTimeline: SupportTimelineItem[];
  previousConversationCount: number;
}

function eventLabel(eventType: string, actor: string | null, detail: Record<string, unknown>, status: string | undefined): string | null {
  const who = actor ?? (typeof detail.actorLabel === "string" ? detail.actorLabel : "Sistema");
  if (eventType === "ai_resumed" && detail.reason === "test_keyword") return "Teste do agente iniciado pela palavra-chave";
  if (eventType === "ai_resumed" && detail.reason === "agent_live") return "Agente de IA começou o atendimento";
  if (eventType === "ai_paused" && detail.reason === "test_disabled") return `${who} desligou o teste do agente`;
  if (eventType === "ai_paused" && detail.reason === "agent_disabled") return `${who} desligou o agente de IA`;
  if (eventType === "contact_renamed") {
    return typeof detail.name === "string" ? `${who} chamou o contato de "${detail.name}"` : `${who} voltou ao nome do WhatsApp`;
  }
  if (eventType === "assigned" && detail.reason === "replied") return `${who} respondeu e ficou com a conversa`;
  if (eventType === "assigned") return typeof detail.note === "string" ? `${who}: ${detail.note}` : `${who} assumiu a conversa`;
  if (eventType === "resolved") return `${who} resolveu a conversa`;
  if (eventType === "reopened") return `${who} reabriu a conversa`;
  if (eventType === "contact_linked") return typeof detail.note === "string" ? `${who}: ${detail.note}` : null;
  if (eventType === "status_changed" && status) return `${who} marcou como aguardando cliente`;
  // A própria mensagem já aparece à direita com autor "Celular". Repetir um
  // evento depois de cada resposta escondia a conversa real entre etiquetas.
  if (eventType === "ai_paused" && detail.reason === "business_app_message") return null;
  return null;
}

export async function loadSupportConversation(
  tx: OrgTx,
  input: { orgId: string; viewer: SupportViewer; conversationId: string; now: Date; includeHistory?: boolean },
): Promise<SupportConversationView | null> {
  const [row] = await tx
    .select({
      id: c.id,
      status: c.status,
      channelId: c.channelId,
      assignedClanId: c.assignedClanId,
      assignedUserId: c.assignedUserId,
      aiTestStartedAt: c.aiTestStartedAt,
      contactId: contacts.id,
      clientId: c.clientId,
      displayName: contacts.displayName,
      customName: contacts.customName,
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
  if (!row) return null;

  const historyRows = await tx
    .select({
      id: c.id,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
    })
    .from(c)
    .where(and(
      eq(c.orgId, input.orgId),
      eq(c.channelId, row.channelId),
      eq(c.contactId, row.contactId),
      ne(c.id, row.id),
    ))
    .orderBy(asc(c.createdAt));
  const historyIds = historyRows.map((conversation) => conversation.id);
  const previousMessages = input.includeHistory && historyIds.length
    ? await tx
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          direction: messages.direction,
          actor: messages.actor,
          source: messages.source,
          text: messages.text,
          messageType: messages.messageType,
          content: messages.content,
          externalMessageId: messages.externalMessageId,
          replyToExternalMessageId: messages.replyToExternalMessageId,
          occurredAt: messages.occurredAt,
          sender: schema.user.name,
        })
        .from(messages)
        .leftJoin(schema.user, eq(schema.user.id, messages.sentByUserId))
        .where(and(eq(messages.orgId, input.orgId), inArray(messages.conversationId, historyIds)))
        .orderBy(asc(messages.occurredAt))
    : [];

  const recent = await tx
    .select({
      id: messages.id,
      direction: messages.direction,
      actor: messages.actor,
      source: messages.source,
      text: messages.text,
      messageType: messages.messageType,
      content: messages.content,
      externalMessageId: messages.externalMessageId,
      replyToExternalMessageId: messages.replyToExternalMessageId,
      occurredAt: messages.occurredAt,
      sender: schema.user.name,
    })
    .from(messages)
    .leftJoin(schema.user, eq(schema.user.id, messages.sentByUserId))
    .where(and(eq(messages.orgId, input.orgId), eq(messages.conversationId, row.id)))
    .orderBy(desc(messages.occurredAt))
    .limit(MESSAGE_LIMIT);

  const name = contactName(row);
  const events = schema.supportMessageEvents;
  const loadedMessages = [...previousMessages, ...recent];
  const outboundIds = loadedMessages.filter((message) => message.direction === "outbound").map((message) => message.id);
  const deliveries = outboundIds.length
    ? await tx.select({ messageId: events.messageId, eventType: events.eventType, detail: events.detail }).from(events).where(and(eq(events.orgId, input.orgId), inArray(events.messageId, outboundIds)))
    : [];

  const transcripts = await loadTranscriptions(
    tx,
    input.orgId,
    loadedMessages.filter((message) => message.messageType === "audio").map((message) => message.id),
  );

  const externalIdByMessage = new Map<string, string>();
  for (const message of loadedMessages) {
    if (message.externalMessageId) externalIdByMessage.set(message.id, message.externalMessageId);
  }
  for (const event of deliveries) {
    if (event.eventType === "accepted" && typeof event.detail.wamid === "string") {
      externalIdByMessage.set(event.messageId, event.detail.wamid);
    }
  }
  const messageByExternalId = new Map(
    loadedMessages.flatMap((message) => {
      const externalId = externalIdByMessage.get(message.id);
      return externalId ? [[externalId, message] as const] : [];
    }),
  );

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

  const toTimelineMessage = (message: (typeof recent)[number], historical: boolean): SupportTimelineItem => {
      const own = deliveries.filter((event) => event.messageId === message.id);
      const failed = own.find((event) => event.eventType === "failed");
      const quoted = message.replyToExternalMessageId ? messageByExternalId.get(message.replyToExternalMessageId) : undefined;
      return {
        kind: "message",
        id: message.id,
        at: message.occurredAt.toISOString(),
        direction: message.direction,
        author: message.direction === "inbound" ? name : message.source === "business_app" ? "Celular" : message.source === "guilda_ai" ? "IA" : (message.sender ?? "Equipe"),
        text: messageLabel(message),
        isText: message.text !== null,
        image: message.messageType === "image" && typeof message.content.id === "string"
          ? {
              src: `/api/atendimento/media/${message.id}`,
              caption: typeof message.content.caption === "string"
                ? message.content.caption.slice(0, 1024)
                : null,
            }
          : null,
        file: message.messageType === "document" && typeof message.content.id === "string"
          ? {
              href: `/api/atendimento/media/${message.id}`,
              name: documentFilename(message.content, typeof message.content.mime_type === "string" ? message.content.mime_type : null),
              caption: typeof message.content.caption === "string" ? message.content.caption.slice(0, 1024) : null,
              isPdf: message.content.mime_type === "application/pdf",
            }
          : null,
        audio: message.messageType === "audio" && typeof message.content.id === "string"
          ? {
              src: `/api/atendimento/media/${message.id}`,
              transcript: transcripts.get(message.id)?.text ?? null,
              status: transcripts.get(message.id)?.status ?? null,
            }
          : null,
        canReply: !historical && externalIdByMessage.has(message.id),
        canForward: !historical && (message.text !== null || ["image", "document", "audio"].includes(message.messageType)),
        replyTo: message.replyToExternalMessageId
          ? {
              author: quoted?.direction === "inbound" ? name : quoted?.source === "business_app" ? "Celular" : quoted?.source === "guilda_ai" ? "IA" : (quoted?.sender ?? "Equipe"),
              text: quoted ? messageLabel(quoted) : "Mensagem anterior",
            }
          : null,
        forwarded: typeof message.content.forwardedFromMessageId === "string",
        delivery: message.direction === "outbound" && message.source !== "business_app" ? deliveryState(own.map((event) => event.eventType)) : null,
        failure: failed ? deliveryFailureMessage(failed.detail) : null,
      };
  };

  const timeline: SupportTimelineItem[] = [
    ...recent.map((message) => toTimelineMessage(message, false)),
    ...notes.map((note): SupportTimelineItem => ({ kind: "note", id: note.id, at: note.createdAt.toISOString(), author: note.author, text: note.text })),
    ...history.flatMap((event): SupportTimelineItem[] => {
      const text = eventLabel(event.eventType, event.actor, event.detail, "waiting");
      return text ? [{ kind: "event", id: event.id, at: event.createdAt.toISOString(), text }] : [];
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const previousTimeline: SupportTimelineItem[] = input.includeHistory
    ? [
        ...historyRows.flatMap((conversation): SupportTimelineItem[] => [
          { kind: "event", id: `history-start-${conversation.id}`, at: conversation.createdAt.toISOString(), text: "Atendimento anterior" },
          ...(conversation.resolvedAt
            ? [{ kind: "event" as const, id: `history-end-${conversation.id}`, at: conversation.resolvedAt.toISOString(), text: "Atendimento encerrado" }]
            : []),
        ]),
        ...previousMessages.map((message) => toTimelineMessage(message, true)),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];

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
  const linkedClients = await tx
    .select({ id: schema.clients.id, name: schema.clients.name, cnpj: schema.clients.cnpj })
    .from(contactClients)
    .innerJoin(schema.clients, and(eq(schema.clients.orgId, contactClients.orgId), eq(schema.clients.id, contactClients.clientId)))
    .where(and(eq(contactClients.orgId, input.orgId), eq(contactClients.contactId, row.contactId)))
    .orderBy(asc(schema.clients.name));
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
    agentTest: row.status === "ai_active" && row.aiTestStartedAt !== null,
    previousTimeline,
    previousConversationCount: historyRows.length,
    assignedToMe: row.assignedUserId === input.viewer.userId,
    assignedUserId: row.assignedUserId,
    assignedClanId: row.assignedClanId,
    assigneeName: row.assigneeName,
    clanName: row.clanName,
    contactId: row.contactId,
    contactName: name,
    whatsAppName: row.displayName,
    customName: row.customName,
    phone: row.phone,
    client: client ?? null,
    contactClients: linkedClients,
    timeline,
    replyBlocked: replyBlockReason({
      status: row.status,
      channelActive: row.channelStatus === "active",
      lastCustomerMessageAt: lastCustomer?.occurredAt ?? null,
      now: input.now,
    }),
    openTasks,
    lastCustomerText: lastCustomer?.text ?? null,
  };
}

export type SupportMediaReference = Readonly<{
  channelId: string;
  mediaId: string;
  kind: "image" | "document" | "audio";
  filename: string;
}>;

/**
 * Autoriza uma foto ou documento pela mesma régua da conversa. O navegador
 * fornece apenas o id interno da mensagem; media id e canal continuam presos à
 * organização.
 */
export async function loadSupportMediaReference(
  tx: OrgTx,
  input: { orgId: string; viewer: SupportViewer; messageId: string },
): Promise<SupportMediaReference | null> {
  const [row] = await tx
    .select({
      channelId: messages.channelId,
      messageType: messages.messageType,
      content: messages.content,
      assignedClanId: c.assignedClanId,
      assignedUserId: c.assignedUserId,
    })
    .from(messages)
    .innerJoin(
      c,
      and(
        eq(c.orgId, messages.orgId),
        eq(c.id, messages.conversationId),
      ),
    )
    .where(
      and(
        eq(messages.orgId, input.orgId),
        eq(messages.id, input.messageId),
      ),
    )
    .limit(1);
  if (!row || (row.messageType !== "image" && row.messageType !== "document" && row.messageType !== "audio")) {
    return null;
  }
  const mediaId = row.content.id;
  if (typeof mediaId !== "string" || !/^\d{1,32}$/.test(mediaId)) return null;
  const mimeType = typeof row.content.mime_type === "string" ? row.content.mime_type : null;
  return {
    channelId: row.channelId,
    mediaId,
    kind: row.messageType,
    filename: documentFilename(row.content, mimeType),
  };
}

/** Número conectado? Sem nenhum, a tela explica como conectar em vez de ficar vazia. */
export async function countActiveSupportChannels(tx: OrgTx, orgId: string): Promise<number> {
  const ch = schema.supportWhatsAppChannels;
  const [row] = await tx.select({ total: count() }).from(ch).where(and(eq(ch.orgId, orgId), eq(ch.status, "active"), isNotNull(ch.phoneNumberId)));
  return row?.total ?? 0;
}

type Command = { orgId: string; viewer: SupportViewer; conversationId: string; now: Date };

/** Trava a conversa da organização; de outra organização, o RLS responde como inexistente. */
async function lockConversation(tx: OrgTx, input: Command) {
  const [row] = await tx
    .select({ id: c.id, status: c.status, channelId: c.channelId, contactId: c.contactId, clientId: c.clientId, assignedClanId: c.assignedClanId, assignedUserId: c.assignedUserId, aiPausedAt: c.aiPausedAt })
    .from(c)
    .where(and(eq(c.orgId, input.orgId), eq(c.id, input.conversationId)))
    .for("update");
  return row ?? null;
}

const NOT_FOUND = "Conversa não encontrada.";

/** Assumir reserva a resposta para a pessoa; no modo sombra a IA só continua lendo e sugerindo internamente. */
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
const contactClients = schema.supportContactClients;

async function clientNameOf(tx: OrgTx, orgId: string, clientId: string): Promise<string | null> {
  const [client] = await tx.select({ name: schema.clients.name }).from(schema.clients).where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.id, clientId)));
  return client?.name ?? null;
}

async function linkedClientIds(tx: OrgTx, orgId: string, contactId: string): Promise<string[]> {
  const rows = await tx
    .select({ clientId: contactClients.clientId })
    .from(contactClients)
    .where(and(eq(contactClients.orgId, orgId), eq(contactClients.contactId, contactId)));
  return rows.map((row) => row.clientId);
}

async function recordLinkEvent(tx: OrgTx, input: Command & { conversationId: string; note: string; clientId: string | null }) {
  await tx.insert(schema.supportConversationEvents).values({
    orgId: input.orgId,
    conversationId: input.conversationId,
    eventType: "contact_linked",
    actorUserId: input.viewer.userId,
    source: "guilda_attendant",
    detail: { note: input.note, clientId: input.clientId },
  });
}

/**
 * Número ↔ empresas (2026-11-23): acrescenta a empresa ao número desta
 * conversa. Sem empresa na conversa, ela passa a ser esta.
 */
export async function addSupportContactClient(tx: OrgTx, input: Command & { clientId: string }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  const name = await clientNameOf(tx, input.orgId, input.clientId);
  if (!name) return err("Empresa não encontrada.");
  await tx
    .insert(contactClients)
    .values({ orgId: input.orgId, contactId: row.contactId, clientId: input.clientId, linkedBy: input.viewer.userId, linkedAt: input.now })
    .onConflictDoNothing();
  if (!row.clientId) {
    await tx.update(c).set({ clientId: input.clientId, updatedAt: input.now }).where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  }
  await recordLinkEvent(tx, { ...input, conversationId: row.id, note: `vinculou o número a ${name}`, clientId: input.clientId });
  return { ok: true };
}

/** Tira a empresa do número. Se era a da conversa, fica a única que sobrar, ou nenhuma. */
export async function removeSupportContactClient(tx: OrgTx, input: Command & { clientId: string }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  const name = (await clientNameOf(tx, input.orgId, input.clientId)) ?? "a empresa";
  await tx
    .delete(contactClients)
    .where(and(eq(contactClients.orgId, input.orgId), eq(contactClients.contactId, row.contactId), eq(contactClients.clientId, input.clientId)));
  if (row.clientId === input.clientId) {
    const remaining = await linkedClientIds(tx, input.orgId, row.contactId);
    await tx
      .update(c)
      .set({ clientId: remaining.length === 1 ? remaining[0] : null, updatedAt: input.now })
      .where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  }
  await recordLinkEvent(tx, { ...input, conversationId: row.id, note: `tirou ${name} deste número`, clientId: input.clientId });
  return { ok: true };
}

/** A empresa desta conversa, entre as do número: é ela que a Carteira usa. */
export async function setSupportConversationClient(tx: OrgTx, input: Command & { clientId: string | null }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  let name: string | null = null;
  if (input.clientId) {
    if (!(await linkedClientIds(tx, input.orgId, row.contactId)).includes(input.clientId)) {
      return err("Essa empresa não é deste número. Adicione-a antes.");
    }
    name = await clientNameOf(tx, input.orgId, input.clientId);
  }
  await tx.update(c).set({ clientId: input.clientId, updatedAt: input.now }).where(and(eq(c.orgId, input.orgId), eq(c.id, row.id)));
  await recordLinkEvent(tx, {
    ...input,
    conversationId: row.id,
    note: name ? `marcou a conversa como da ${name}` : "tirou a empresa da conversa",
    clientId: input.clientId,
  });
  return { ok: true };
}

/**
 * Nome do contato dado pela equipe (2026-11-24, pedido do Bruno): vale para o
 * número em todas as conversas dele e não muda nada no WhatsApp do cliente.
 * Vazio volta ao nome do perfil. A troca fica no histórico desta conversa.
 */
export async function renameSupportContact(tx: OrgTx, input: Command & { name: string }): Promise<ActionResult> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  const name = normalizeContactName(input.name);
  const [contact] = await tx
    .select({ customName: contacts.customName })
    .from(contacts)
    .where(and(eq(contacts.orgId, input.orgId), eq(contacts.id, row.contactId)));
  if (!contact) return err(NOT_FOUND);
  if ((contact.customName ?? null) === name) return { ok: true };
  await tx
    .update(contacts)
    .set({ customName: name, updatedAt: input.now })
    .where(and(eq(contacts.orgId, input.orgId), eq(contacts.id, row.contactId)));
  await tx.insert(schema.supportConversationEvents).values({
    orgId: input.orgId,
    conversationId: row.id,
    eventType: "contact_renamed",
    actorUserId: input.viewer.userId,
    source: "guilda_attendant",
    detail: { name, previous: contact.customName ?? null },
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

/** A mesma régua de texto e áudio, antes de carregar a mídia na Meta. */
export async function checkSupportMediaReply(tx: OrgTx, input: Command & { requestId: string; replyToMessageId?: string | null }): Promise<ActionResult<{ channelId: string; alreadyQueued: boolean }>> {
  const target = await replyTarget(tx, input);
  if (!("row" in target)) return target;
  const reply = await replyExternalId(tx, { orgId: input.orgId, conversationId: target.row.id, messageId: input.replyToMessageId });
  if (!reply.ok) return reply;
  return { ok: true, data: { channelId: target.row.channelId, alreadyQueued: target.duplicate } };
}

/**
 * Responde o cliente: grava a mensagem e a saída na mesma transação, e o
 * processo de atendimento entrega à Meta. O telefone sai do cadastro do contato,
 * nunca do navegador. A chave do formulário impede a mensagem em dobro.
 */
async function replyExternalId(
  tx: OrgTx,
  input: { orgId: string; conversationId: string; messageId: string | null | undefined },
): Promise<ActionResult<{ externalId: string | null }>> {
  if (!input.messageId) return { ok: true, data: { externalId: null } };
  const [message] = await tx
    .select({ id: messages.id, externalMessageId: messages.externalMessageId })
    .from(messages)
    .where(and(eq(messages.orgId, input.orgId), eq(messages.conversationId, input.conversationId), eq(messages.id, input.messageId)))
    .limit(1);
  if (!message) return err("A mensagem escolhida não pertence a esta conversa.");
  if (message.externalMessageId) return { ok: true, data: { externalId: message.externalMessageId } };
  const events = schema.supportMessageEvents;
  const accepted = await tx
    .select({ detail: events.detail })
    .from(events)
    .where(and(eq(events.orgId, input.orgId), eq(events.messageId, message.id), eq(events.eventType, "accepted")))
    .orderBy(desc(events.occurredAt))
    .limit(1);
  const wamid = accepted[0]?.detail.wamid;
  return typeof wamid === "string"
    ? { ok: true, data: { externalId: wamid } }
    : err("Essa mensagem ainda não pode ser citada no WhatsApp.");
}

export async function sendSupportReply(
  tx: OrgTx,
  input: Command & { text: string; requestId: string; replyToMessageId?: string | null },
): Promise<ActionResult> {
  const target = await replyTarget(tx, input);
  if (!("row" in target)) return target;
  if (target.duplicate) return { ok: true };
  const { row, contact, queuedKey } = target;
  const events = schema.supportMessageEvents;
  const reply = await replyExternalId(tx, { orgId: input.orgId, conversationId: row.id, messageId: input.replyToMessageId });
  if (!reply.ok) return reply;
  const replyToExternalId = reply.data?.externalId ?? null;

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
      replyToExternalMessageId: replyToExternalId,
      sentByUserId: input.viewer.userId,
      occurredAt: input.now,
    })
    .returning({ id: messages.id });
  await tx.insert(events).values({ orgId: input.orgId, messageId: message.id, eventType: "queued", providerEventKey: queuedKey, occurredAt: input.now });
  await tx.insert(schema.supportOutbox).values({
    orgId: input.orgId,
    channelId: row.channelId,
    messageId: message.id,
    payload: { to: contact.whatsappId, text: input.text, ...(replyToExternalId ? { contextMessageId: replyToExternalId } : {}) },
  });
  await afterTeamReply(tx, input, row);
  return { ok: true };
}

/** Reenvia texto ou mídia a outra conversa do mesmo canal, com origem auditável na Guilda. */
export async function forwardSupportMessage(
  tx: OrgTx,
  input: Command & { sourceMessageId: string; targetConversationId: string; requestId: string },
): Promise<ActionResult> {
  if (input.conversationId === input.targetConversationId) return err("Escolha outro contato para encaminhar.");
  const [source] = await tx
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      channelId: messages.channelId,
      messageType: messages.messageType,
      text: messages.text,
      content: messages.content,
    })
    .from(messages)
    .where(and(eq(messages.orgId, input.orgId), eq(messages.conversationId, input.conversationId), eq(messages.id, input.sourceMessageId)))
    .limit(1);
  if (!source) return err("Mensagem de origem não encontrada.");
  const mediaId = typeof source.content.id === "string" ? source.content.id : null;

  let payload: Record<string, unknown>;
  if (source.messageType === "text") {
    payload = { text: source.text ?? "" };
  } else if (source.messageType === "audio") {
    if (!mediaId) return err("A mídia original não está mais disponível para encaminhar.");
    payload = { audio: { id: mediaId } };
  } else if (source.messageType === "image" || source.messageType === "document") {
    if (!mediaId) return err("A mídia original não está mais disponível para encaminhar.");
    payload = {
      media: {
        id: mediaId,
        kind: source.messageType,
        ...(typeof source.content.filename === "string" ? { filename: source.content.filename } : {}),
        ...(typeof source.content.caption === "string" ? { caption: source.content.caption } : {}),
      },
    };
  } else {
    return err("Esse tipo de mensagem não pode ser encaminhado.");
  }

  const target = await replyTarget(tx, { ...input, conversationId: input.targetConversationId });
  if (!("row" in target)) return target;
  if (target.duplicate) return { ok: true };
  if (target.row.channelId !== source.channelId) return err("Só é possível encaminhar pelo mesmo número do WhatsApp.");

  const copied = {
    ...source.content,
    forwardedFromMessageId: source.id,
    forwardedFromConversationId: source.conversationId,
  };
  const [message] = await tx
    .insert(messages)
    .values({
      orgId: input.orgId,
      channelId: target.row.channelId,
      conversationId: target.row.id,
      direction: "outbound",
      actor: "attendant",
      source: "guilda_attendant",
      messageType: source.messageType,
      text: source.text,
      content: copied,
      sentByUserId: input.viewer.userId,
      occurredAt: input.now,
    })
    .returning({ id: messages.id });
  await tx.insert(schema.supportMessageEvents).values({
    orgId: input.orgId,
    messageId: message.id,
    eventType: "queued",
    providerEventKey: target.queuedKey,
    occurredAt: input.now,
  });

  await tx.insert(schema.supportOutbox).values({ orgId: input.orgId, channelId: target.row.channelId, messageId: message.id, payload: { to: target.contact.whatsappId, ...payload } });
  await afterTeamReply(tx, { ...input, conversationId: input.targetConversationId }, target.row);
  return { ok: true };
}

/** Guarda só o id da mídia da Meta; o arquivo não vai para o Postgres. */
export async function sendSupportMedia(
  tx: OrgTx,
  input: Command & { requestId: string; mediaId: string; kind: "image" | "document"; mimeType: string; filename: string; caption: string; replyToMessageId?: string | null },
): Promise<ActionResult> {
  const spec = validateSupportUpload({ name: input.filename, type: input.mimeType, size: 1 });
  if (!/^\d{1,32}$/.test(input.mediaId) || input.caption.length > 1024 || !spec.ok || spec.value.kind !== input.kind) return err("Arquivo inválido.");
  const target = await replyTarget(tx, input);
  if (!("row" in target)) return target;
  if (target.duplicate) return { ok: true };
  const { row, contact, queuedKey } = target;
  const reply = await replyExternalId(tx, { orgId: input.orgId, conversationId: row.id, messageId: input.replyToMessageId });
  if (!reply.ok) return reply;
  const replyToExternalId = reply.data?.externalId ?? null;

  const content = {
    id: input.mediaId,
    mime_type: input.mimeType,
    ...(input.kind === "document" ? { filename: input.filename } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
  };
  const [message] = await tx.insert(messages).values({
    orgId: input.orgId,
    channelId: row.channelId,
    conversationId: row.id,
    direction: "outbound",
    actor: "attendant",
    source: "guilda_attendant",
    messageType: input.kind,
    content,
    replyToExternalMessageId: replyToExternalId,
    sentByUserId: input.viewer.userId,
    occurredAt: input.now,
  }).returning({ id: messages.id });
  await tx.insert(schema.supportMessageEvents).values({ orgId: input.orgId, messageId: message.id, eventType: "queued", providerEventKey: queuedKey, occurredAt: input.now });
  await tx.insert(schema.supportOutbox).values({
    orgId: input.orgId,
    channelId: row.channelId,
    messageId: message.id,
    payload: { to: contact.whatsappId, media: { id: input.mediaId, kind: input.kind, filename: input.filename, caption: input.caption }, ...(replyToExternalId ? { contextMessageId: replyToExternalId } : {}) },
  });
  await afterTeamReply(tx, input, row);
  return { ok: true };
}

/**
 * Antes de converter e subir a nota de voz à Meta (2026-11-23): a mesma régua da
 * resposta em texto, para não gastar o envio com uma resposta que seria recusada.
 * Devolve o canal, de onde a rota tira o acesso à Meta.
 */
export async function checkSupportAudioReply(tx: OrgTx, input: Command & { requestId: string; replyToMessageId?: string | null }): Promise<ActionResult<{ channelId: string; duplicate: boolean }>> {
  const target = await replyTarget(tx, input);
  if (!("row" in target)) return target;
  const reply = await replyExternalId(tx, { orgId: input.orgId, conversationId: target.row.id, messageId: input.replyToMessageId });
  if (!reply.ok) return reply;
  return { ok: true, data: { channelId: target.row.channelId, duplicate: target.duplicate } };
}

/**
 * Nota de voz gravada na conversa (2026-11-23): o áudio já está na Meta
 * (`mediaId`); aqui entra a mensagem e a saída, como a resposta em texto.
 */
export async function sendSupportAudioReply(tx: OrgTx, input: Command & { mediaId: string; requestId: string; replyToMessageId?: string | null }): Promise<ActionResult> {
  if (!/^\d{1,32}$/.test(input.mediaId)) return err("Áudio inválido.");
  const target = await replyTarget(tx, input);
  if (!("row" in target)) return target;
  if (target.duplicate) return { ok: true };
  const { row, contact, queuedKey } = target;
  const reply = await replyExternalId(tx, { orgId: input.orgId, conversationId: row.id, messageId: input.replyToMessageId });
  if (!reply.ok) return reply;
  const replyToExternalId = reply.data?.externalId ?? null;
  const [message] = await tx
    .insert(messages)
    .values({
      orgId: input.orgId,
      channelId: row.channelId,
      conversationId: row.id,
      direction: "outbound",
      actor: "attendant",
      source: "guilda_attendant",
      messageType: "audio",
      content: { id: input.mediaId, mime_type: "audio/ogg", voice: true },
      replyToExternalMessageId: replyToExternalId,
      sentByUserId: input.viewer.userId,
      occurredAt: input.now,
    })
    .returning({ id: messages.id });
  await tx.insert(schema.supportMessageEvents).values({ orgId: input.orgId, messageId: message.id, eventType: "queued", providerEventKey: queuedKey, occurredAt: input.now });
  await tx.insert(schema.supportOutbox).values({ orgId: input.orgId, channelId: row.channelId, messageId: message.id, payload: { to: contact.whatsappId, audio: { id: input.mediaId }, ...(replyToExternalId ? { contextMessageId: replyToExternalId } : {}) } });
  await afterTeamReply(tx, input, row);
  return { ok: true };
}

/**
 * Depois de pôr a resposta na fila: quem vê a conversa responde sem assumir
 * (2026-11-24). A conversa continua com quem está; sem responsável, fica com
 * quem respondeu, e a IA para (a trava de saída e o turno conferem o status).
 */
async function afterTeamReply(
  tx: OrgTx,
  input: Command,
  row: { id: string; status: SupportStatus; assignedUserId: string | null; aiPausedAt: Date | null },
): Promise<void> {
  const where = and(eq(c.orgId, input.orgId), eq(c.id, row.id));
  const change = conversationAfterTeamReply({ status: row.status, assignedUserId: row.assignedUserId, viewerId: input.viewer.userId });
  if (!change) {
    await tx.update(c).set({ lastMessageAt: input.now, updatedAt: input.now }).where(where);
    return;
  }
  await tx
    .update(c)
    .set({
      status: change.status,
      assignedUserId: change.assignedUserId,
      ...(change.pauseAi ? { aiPausedAt: row.aiPausedAt ?? input.now, aiPauseReason: "attendant_replied" } : {}),
      lastMessageAt: input.now,
      updatedAt: input.now,
    })
    .where(where);
  if (change.takeOver) {
    await tx.insert(schema.supportConversationEvents).values({
      orgId: input.orgId,
      conversationId: row.id,
      eventType: "assigned",
      actorUserId: input.viewer.userId,
      source: "guilda_attendant",
      detail: { reason: "replied" },
    });
  }
}

/**
 * Régua de quem responde, comum ao texto, ao arquivo e à nota de voz: a
 * conversa travada e visível para quem responde (não precisa ter assumido),
 * canal ativo e a janela de 24 horas. A chave do formulário diz se o mesmo
 * envio já entrou (clique duplo).
 */
async function replyTarget(
  tx: OrgTx,
  input: Command & { requestId: string },
): Promise<
  | { row: NonNullable<Awaited<ReturnType<typeof lockConversation>>>; contact: { whatsappId: string }; queuedKey: string; duplicate: boolean }
  | { ok: false; error: string }
> {
  const row = await lockConversation(tx, input);
  if (!row) return err(NOT_FOUND);
  const events = schema.supportMessageEvents;
  const queuedKey = createHash("sha256").update(`reply\0${row.id}\0${input.requestId}`, "utf8").digest("hex");
  const [already] = await tx.select({ id: events.id }).from(events).where(and(eq(events.orgId, input.orgId), eq(events.providerEventKey, queuedKey))).limit(1);

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
    channelActive: channel?.status === "active",
    lastCustomerMessageAt: lastCustomer?.occurredAt ?? null,
    now: input.now,
  });
  if (blocked) return err(blocked);
  if (!contact) return err(NOT_FOUND);
  return { row, contact, queuedKey, duplicate: Boolean(already) };
}
