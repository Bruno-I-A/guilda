import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { clans, clients } from "./domain";

/**
 * Atendimento omnicanal da Guilda.
 *
 * As credenciais e os dados operacionais ficam presos ao tenant por RLS. O
 * webhook usa uma função SECURITY DEFINER estreita apenas para transformar o
 * phone_number_id da Meta em (org_id, channel_id); depois disso toda operação
 * passa por withOrgTx.
 */

export const supportChannelStatus = pgEnum("support_channel_status", [
  "pending",
  "active",
  "paused",
  "disconnected",
]);

export const supportConversationStatus = pgEnum("support_conversation_status", [
  "ai_active",
  "needs_human",
  "human_active",
  "waiting_customer",
  "resolved",
]);

export const supportMessageDirection = pgEnum("support_message_direction", [
  "inbound",
  "outbound",
]);

export const supportMessageActor = pgEnum("support_message_actor", [
  "customer",
  "ai",
  "attendant",
  "system",
]);

export const supportMessageSource = pgEnum("support_message_source", [
  "cloud_api",
  "business_app",
  "guilda_ai",
  "guilda_attendant",
  "history_sync",
  "system",
]);

export const supportMessageType = pgEnum("support_message_type", [
  "text",
  "image",
  "audio",
  "document",
  "video",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "reaction",
  "unsupported",
]);

export const supportMessageEventType = pgEnum("support_message_event_type", [
  "received",
  "queued",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const supportConversationEventType = pgEnum(
  "support_conversation_event_type",
  [
    "opened",
    "status_changed",
    "assigned",
    "unassigned",
    "ai_paused",
    "ai_resumed",
    "resolved",
    "reopened",
    "contact_linked",
  ],
);

export const supportQueueStatus = pgEnum("support_queue_status", [
  "pending",
  "processing",
  "processed",
  "failed",
]);

export const supportOutboxStatus = pgEnum("support_outbox_status", [
  "pending",
  "processing",
  "sent",
  "failed",
]);

/** Número da Cloud API conectado por Embedded Signup com coexistência. */
export const supportWhatsAppChannels = pgTable(
  "support_whatsapp_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    status: supportChannelStatus("status").notNull().default("pending"),
    wabaId: varchar("waba_id", { length: 32 }),
    phoneNumberId: varchar("phone_number_id", { length: 32 }),
    displayPhoneNumber: varchar("display_phone_number", { length: 32 }),
    verifiedName: varchar("verified_name", { length: 255 }),
    coexistenceEnabled: boolean("coexistence_enabled").notNull().default(true),
    accessTokenCiphertext: text("access_token_ciphertext"),
    accessTokenIv: varchar("access_token_iv", { length: 32 }),
    accessTokenAuthTag: varchar("access_token_auth_tag", { length: 32 }),
    accessTokenKeyVersion: smallint("access_token_key_version"),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("support_whatsapp_channels_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("support_whatsapp_channels_phone_number_id_uidx")
      .on(t.phoneNumberId)
      .where(sql`${t.phoneNumberId} IS NOT NULL`),
    index("support_whatsapp_channels_org_status_idx").on(t.orgId, t.status),
    check(
      "support_whatsapp_channels_waba_id_check",
      sql`${t.wabaId} IS NULL OR ${t.wabaId} ~ '^[0-9]{1,32}$'`,
    ),
    check(
      "support_whatsapp_channels_phone_number_id_check",
      sql`${t.phoneNumberId} IS NULL OR ${t.phoneNumberId} ~ '^[0-9]{1,32}$'`,
    ),
    check(
      "support_whatsapp_channels_token_envelope_check",
      sql`(${t.accessTokenCiphertext} IS NULL AND ${t.accessTokenIv} IS NULL AND ${t.accessTokenAuthTag} IS NULL AND ${t.accessTokenKeyVersion} IS NULL) OR (${t.accessTokenCiphertext} IS NOT NULL AND ${t.accessTokenIv} IS NOT NULL AND ${t.accessTokenAuthTag} IS NOT NULL AND ${t.accessTokenKeyVersion} IS NOT NULL)`,
    ),
  ],
);

/** Pessoa atendida; pode ser vinculada a uma empresa-cliente da Guilda. */
export const supportContacts = pgTable(
  "support_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id"),
    whatsappId: varchar("whatsapp_id", { length: 32 }).notNull(),
    phoneE164: varchar("phone_e164", { length: 20 }),
    displayName: varchar("display_name", { length: 255 }),
    linkedBy: text("linked_by").references(() => user.id),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_contacts_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("restrict"),
    uniqueIndex("support_contacts_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("support_contacts_org_whatsapp_uidx").on(t.orgId, t.whatsappId),
    index("support_contacts_org_client_idx").on(t.orgId, t.clientId),
    check(
      "support_contacts_whatsapp_id_check",
      sql`${t.whatsappId} ~ '^[0-9]{1,32}$'`,
    ),
    check(
      "support_contacts_phone_e164_check",
      sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check(
      "support_contacts_link_pair_check",
      sql`(${t.clientId} IS NULL AND ${t.linkedBy} IS NULL AND ${t.linkedAt} IS NULL) OR (${t.clientId} IS NOT NULL AND ${t.linkedBy} IS NOT NULL AND ${t.linkedAt} IS NOT NULL)`,
    ),
  ],
);

export const supportConversations = pgTable(
  "support_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    // Até a IA existir, conversa nova é de uma pessoa: "IA atendendo" ficaria sem ninguém.
    status: supportConversationStatus("status").notNull().default("needs_human"),
    assignedClanId: uuid("assigned_clan_id"),
    assignedUserId: text("assigned_user_id").references(() => user.id),
    summary: text("summary"),
    aiPausedAt: timestamp("ai_paused_at", { withTimezone: true }),
    aiPauseReason: varchar("ai_pause_reason", { length: 120 }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_conversations_org_channel_fk",
      columns: [t.orgId, t.channelId],
      foreignColumns: [supportWhatsAppChannels.orgId, supportWhatsAppChannels.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_conversations_org_contact_fk",
      columns: [t.orgId, t.contactId],
      foreignColumns: [supportContacts.orgId, supportContacts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_conversations_org_clan_fk",
      columns: [t.orgId, t.assignedClanId],
      foreignColumns: [clans.orgId, clans.id],
    }).onDelete("restrict"),
    uniqueIndex("support_conversations_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("support_conversations_open_contact_uidx")
      .on(t.orgId, t.channelId, t.contactId)
      .where(sql`${t.resolvedAt} IS NULL`),
    index("support_conversations_org_queue_idx").on(
      t.orgId,
      t.status,
      t.assignedClanId,
      t.lastMessageAt,
    ),
    check(
      "support_conversations_resolved_check",
      sql`(${t.status} = 'resolved' AND ${t.resolvedAt} IS NOT NULL) OR (${t.status} <> 'resolved' AND ${t.resolvedAt} IS NULL)`,
    ),
    check(
      "support_conversations_ai_pause_pair_check",
      sql`(${t.aiPausedAt} IS NULL AND ${t.aiPauseReason} IS NULL) OR (${t.aiPausedAt} IS NOT NULL AND ${t.aiPauseReason} IS NOT NULL)`,
    ),
  ],
);

/** Mensagem é append-only; status de entrega vive em support_message_events. */
export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    externalMessageId: varchar("external_message_id", { length: 255 }),
    direction: supportMessageDirection("direction").notNull(),
    actor: supportMessageActor("actor").notNull(),
    source: supportMessageSource("source").notNull(),
    messageType: supportMessageType("message_type").notNull(),
    text: text("text"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
    replyToExternalMessageId: varchar("reply_to_external_message_id", { length: 255 }),
    sentByUserId: text("sent_by_user_id").references(() => user.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_messages_org_channel_fk",
      columns: [t.orgId, t.channelId],
      foreignColumns: [supportWhatsAppChannels.orgId, supportWhatsAppChannels.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_messages_org_conversation_fk",
      columns: [t.orgId, t.conversationId],
      foreignColumns: [supportConversations.orgId, supportConversations.id],
    }).onDelete("restrict"),
    uniqueIndex("support_messages_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("support_messages_external_uidx")
      .on(t.orgId, t.channelId, t.externalMessageId)
      .where(sql`${t.externalMessageId} IS NOT NULL`),
    index("support_messages_org_conversation_time_idx").on(
      t.orgId,
      t.conversationId,
      t.occurredAt,
    ),
  ],
);

export const supportMessageEvents = pgTable(
  "support_message_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull(),
    eventType: supportMessageEventType("event_type").notNull(),
    providerEventKey: varchar("provider_event_key", { length: 64 }),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_message_events_org_message_fk",
      columns: [t.orgId, t.messageId],
      foreignColumns: [supportMessages.orgId, supportMessages.id],
    }).onDelete("restrict"),
    uniqueIndex("support_message_events_provider_uidx")
      .on(t.orgId, t.providerEventKey)
      .where(sql`${t.providerEventKey} IS NOT NULL`),
    index("support_message_events_org_message_time_idx").on(
      t.orgId,
      t.messageId,
      t.occurredAt,
    ),
  ],
);

export const supportConversationEvents = pgTable(
  "support_conversation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    eventType: supportConversationEventType("event_type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id),
    source: supportMessageSource("source").notNull().default("system"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_conversation_events_org_conversation_fk",
      columns: [t.orgId, t.conversationId],
      foreignColumns: [supportConversations.orgId, supportConversations.id],
    }).onDelete("restrict"),
    index("support_conversation_events_org_conversation_time_idx").on(
      t.orgId,
      t.conversationId,
      t.createdAt,
    ),
  ],
);

/** Nota interna da equipe: nunca vai para o cliente e não se edita. */
export const supportConversationNotes = pgTable(
  "support_conversation_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_conversation_notes_org_conversation_fk",
      columns: [t.orgId, t.conversationId],
      foreignColumns: [supportConversations.orgId, supportConversations.id],
    }).onDelete("restrict"),
    index("support_conversation_notes_org_conversation_time_idx").on(t.orgId, t.conversationId, t.createdAt),
    check("support_conversation_notes_text_check", sql`length(btrim(${t.text})) BETWEEN 1 AND 4000`),
  ],
);

/** Mudança de webhook sanitizada e durável, pronta para o worker. */
export const supportInboundEvents = pgTable(
  "support_inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    webhookField: varchar("webhook_field", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: supportQueueStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockToken: uuid("lock_token"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_inbound_events_org_channel_fk",
      columns: [t.orgId, t.channelId],
      foreignColumns: [supportWhatsAppChannels.orgId, supportWhatsAppChannels.id],
    }).onDelete("restrict"),
    uniqueIndex("support_inbound_events_fingerprint_uidx").on(t.fingerprint),
    index("support_inbound_events_pending_idx").on(t.status, t.scheduledFor, t.lockedAt),
    check(
      "support_inbound_events_fingerprint_check",
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** Envio à Cloud API separado do histórico imutável da mensagem. */
export const supportOutbox = pgTable(
  "support_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    messageId: uuid("message_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: supportOutboxStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockToken: uuid("lock_token"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "support_outbox_org_channel_fk",
      columns: [t.orgId, t.channelId],
      foreignColumns: [supportWhatsAppChannels.orgId, supportWhatsAppChannels.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_outbox_org_message_fk",
      columns: [t.orgId, t.messageId],
      foreignColumns: [supportMessages.orgId, supportMessages.id],
    }).onDelete("restrict"),
    uniqueIndex("support_outbox_org_message_uidx").on(t.orgId, t.messageId),
    index("support_outbox_pending_idx").on(t.status, t.scheduledFor, t.lockedAt),
  ],
);

export type SupportWhatsAppChannel = typeof supportWhatsAppChannels.$inferSelect;
export type SupportContact = typeof supportContacts.$inferSelect;
export type SupportConversation = typeof supportConversations.$inferSelect;
export type SupportMessage = typeof supportMessages.$inferSelect;
