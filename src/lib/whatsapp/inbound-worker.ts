import "server-only";

import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

type JsonRecord = Record<string, unknown>;

type InboundClaim = Readonly<{
  id: string;
  orgId: string;
  channelId: string;
  claimToken: string;
}>;

type NormalizedMessage = Readonly<{
  externalId: string;
  contactWhatsAppId: string;
  displayName?: string;
  direction: "inbound" | "outbound";
  actor: "customer" | "attendant";
  source: "cloud_api" | "business_app";
  messageType: typeof schema.supportMessageType.enumValues[number];
  text?: string;
  content: JsonRecord;
  replyToExternalMessageId?: string;
  occurredAt: Date;
}>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown, max = 255): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

function occurredAt(value: unknown): Date {
  const seconds = typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : NaN;
  const date = Number.isSafeInteger(seconds) ? new Date(seconds * 1000) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

const MESSAGE_TYPES = new Set<string>(schema.supportMessageType.enumValues);

function normalizeMessageType(value: unknown): NormalizedMessage["messageType"] {
  return typeof value === "string" && MESSAGE_TYPES.has(value)
    ? (value as NormalizedMessage["messageType"])
    : "unsupported";
}

function contactNames(payload: JsonRecord): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(payload.contacts)) return result;
  for (const item of payload.contacts) {
    const contact = asRecord(item);
    const profile = asRecord(contact?.profile);
    const whatsappId = asString(contact?.wa_id, 32);
    const name = asString(profile?.name, 255);
    if (whatsappId && name) result.set(whatsappId, name);
  }
  return result;
}

function messageContent(message: JsonRecord, type: NormalizedMessage["messageType"]): JsonRecord {
  const content = asRecord(message[type]);
  return content ?? {};
}

export function normalizeInboundMessages(payload: JsonRecord): NormalizedMessage[] {
  const result: NormalizedMessage[] = [];
  const names = contactNames(payload);

  if (Array.isArray(payload.messages)) {
    for (const value of payload.messages) {
      const message = asRecord(value);
      const externalId = asString(message?.id);
      const from = asString(message?.from, 32);
      if (!message || !externalId || !from || !/^\d{1,32}$/.test(from)) continue;
      const type = normalizeMessageType(message.type);
      const content = messageContent(message, type);
      const context = asRecord(message.context);
      result.push({
        externalId,
        contactWhatsAppId: from,
        ...(names.get(from) ? { displayName: names.get(from) } : {}),
        direction: "inbound",
        actor: "customer",
        source: "cloud_api",
        messageType: type,
        ...(type === "text" && asString(content.body, 20_000)
          ? { text: asString(content.body, 20_000) }
          : {}),
        content,
        ...(asString(context?.id) ? { replyToExternalMessageId: asString(context?.id) } : {}),
        occurredAt: occurredAt(message.timestamp),
      });
    }
  }

  if (Array.isArray(payload.message_echoes)) {
    for (const value of payload.message_echoes) {
      const message = asRecord(value);
      const externalId = asString(message?.id);
      const to = asString(message?.to, 32);
      if (!message || !externalId || !to || !/^\d{1,32}$/.test(to)) continue;
      const type = normalizeMessageType(message.type);
      const content = messageContent(message, type);
      const context = asRecord(message.context);
      result.push({
        externalId,
        contactWhatsAppId: to,
        direction: "outbound",
        actor: "attendant",
        source: "business_app",
        messageType: type,
        ...(type === "text" && asString(content.body, 20_000)
          ? { text: asString(content.body, 20_000) }
          : {}),
        content,
        ...(asString(context?.id) ? { replyToExternalMessageId: asString(context?.id) } : {}),
        occurredAt: occurredAt(message.timestamp),
      });
    }
  }

  return result;
}

function providerEventKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex");
}

async function upsertContact(
  tx: OrgTx,
  input: { orgId: string; message: NormalizedMessage },
): Promise<string> {
  const inserted = await tx
    .insert(schema.supportContacts)
    .values({
      orgId: input.orgId,
      whatsappId: input.message.contactWhatsAppId,
      phoneE164: /^[1-9][0-9]{7,14}$/.test(input.message.contactWhatsAppId)
        ? `+${input.message.contactWhatsAppId}`
        : undefined,
      displayName: input.message.displayName,
      lastSeenAt: input.message.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.supportContacts.id });
  const contactId = inserted[0]?.id;
  if (contactId) return contactId;

  const [existing] = await tx
    .select({ id: schema.supportContacts.id })
    .from(schema.supportContacts)
    .where(
      and(
        eq(schema.supportContacts.orgId, input.orgId),
        eq(schema.supportContacts.whatsappId, input.message.contactWhatsAppId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Contato do WhatsApp não pôde ser resolvido");

  await tx
    .update(schema.supportContacts)
    .set({
      lastSeenAt: input.message.occurredAt,
      updatedAt: new Date(),
      ...(input.message.displayName ? { displayName: input.message.displayName } : {}),
    })
    .where(eq(schema.supportContacts.id, existing.id));
  return existing.id;
}

async function findOrCreateConversation(
  tx: OrgTx,
  input: { orgId: string; channelId: string; contactId: string; at: Date },
): Promise<{ id: string; created: boolean }> {
  const inserted = await tx
    .insert(schema.supportConversations)
    .values({
      orgId: input.orgId,
      channelId: input.channelId,
      contactId: input.contactId,
      lastMessageAt: input.at,
    })
    .onConflictDoNothing()
    .returning({ id: schema.supportConversations.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };

  const [existing] = await tx
    .select({ id: schema.supportConversations.id })
    .from(schema.supportConversations)
    .where(
      and(
        eq(schema.supportConversations.orgId, input.orgId),
        eq(schema.supportConversations.channelId, input.channelId),
        eq(schema.supportConversations.contactId, input.contactId),
        isNull(schema.supportConversations.resolvedAt),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Conversa do WhatsApp não pôde ser resolvida");
  return { id: existing.id, created: false };
}

async function materializeMessage(
  tx: OrgTx,
  input: { orgId: string; channelId: string; message: NormalizedMessage },
): Promise<void> {
  const contactId = await upsertContact(tx, { orgId: input.orgId, message: input.message });
  const conversation = await findOrCreateConversation(tx, {
    orgId: input.orgId,
    channelId: input.channelId,
    contactId,
    at: input.message.occurredAt,
  });
  if (conversation.created) {
    await tx.insert(schema.supportConversationEvents).values({
      orgId: input.orgId,
      conversationId: conversation.id,
      eventType: "opened",
      source: input.message.source,
      detail: { initialStatus: "ai_active" },
    });
  }

  const inserted = await tx
    .insert(schema.supportMessages)
    .values({
      orgId: input.orgId,
      channelId: input.channelId,
      conversationId: conversation.id,
      externalMessageId: input.message.externalId,
      direction: input.message.direction,
      actor: input.message.actor,
      source: input.message.source,
      messageType: input.message.messageType,
      text: input.message.text,
      content: input.message.content,
      replyToExternalMessageId: input.message.replyToExternalMessageId,
      occurredAt: input.message.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.supportMessages.id });
  const messageId = inserted[0]?.id;
  if (!messageId) return;

  await tx.insert(schema.supportMessageEvents).values({
    orgId: input.orgId,
    messageId,
    eventType: input.message.direction === "inbound" ? "received" : "sent",
    providerEventKey: providerEventKey(
      input.message.externalId,
      input.message.direction === "inbound" ? "received" : "sent",
    ),
    occurredAt: input.message.occurredAt,
  });

  if (input.message.source === "business_app") {
    await tx
      .update(schema.supportConversations)
      .set({
        status: "human_active",
        aiPausedAt: input.message.occurredAt,
        aiPauseReason: "business_app_message",
        lastMessageAt: input.message.occurredAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.supportConversations.id, conversation.id));
    await tx.insert(schema.supportConversationEvents).values({
      orgId: input.orgId,
      conversationId: conversation.id,
      eventType: "ai_paused",
      source: "business_app",
      detail: { reason: "business_app_message", externalMessageId: input.message.externalId },
    });
  } else {
    await tx
      .update(schema.supportConversations)
      .set({ lastMessageAt: input.message.occurredAt, updatedAt: new Date() })
      .where(eq(schema.supportConversations.id, conversation.id));
  }
}

async function materializeStatuses(
  tx: OrgTx,
  input: { orgId: string; channelId: string; payload: JsonRecord },
): Promise<void> {
  if (!Array.isArray(input.payload.statuses)) return;
  for (const value of input.payload.statuses) {
    const status = asRecord(value);
    if (!status) continue;
    const externalId = asString(status.id);
    const eventType = asString(status.status, 32);
    if (
      !externalId ||
      !eventType ||
      !["sent", "delivered", "read", "failed"].includes(eventType)
    ) {
      continue;
    }
    const [message] = await tx
      .select({ id: schema.supportMessages.id })
      .from(schema.supportMessages)
      .where(
        and(
          eq(schema.supportMessages.orgId, input.orgId),
          eq(schema.supportMessages.channelId, input.channelId),
          eq(schema.supportMessages.externalMessageId, externalId),
        ),
      )
      .limit(1);
    if (!message) continue;
    const at = occurredAt(status.timestamp);
    await tx
      .insert(schema.supportMessageEvents)
      .values({
        orgId: input.orgId,
        messageId: message.id,
        eventType: eventType as "sent" | "delivered" | "read" | "failed",
        providerEventKey: providerEventKey(externalId, eventType, at.toISOString()),
        detail: status.errors !== undefined ? { errors: status.errors } : {},
        occurredAt: at,
      })
      .onConflictDoNothing();
  }
}

async function claimInboundEvents(limit: number): Promise<InboundClaim[]> {
  const result = await db.execute<{
    event_id: string;
    org_id: string;
    channel_id: string;
    claim_token: string;
  }>(sql`SELECT * FROM public.claim_support_inbound_events(${limit})`);
  return result.rows.map((row) => ({
    id: row.event_id,
    orgId: row.org_id,
    channelId: row.channel_id,
    claimToken: row.claim_token,
  }));
}

async function finishInboundEvent(
  claim: InboundClaim,
  result: { success: boolean; error?: unknown },
): Promise<boolean> {
  const detail =
    result.error instanceof Error
      ? result.error.message
      : result.error
        ? "Falha desconhecida"
        : null;
  const finished = await db.execute<{ finish_support_inbound_event: boolean }>(
    sql`SELECT public.finish_support_inbound_event(
      ${claim.id}::uuid,
      ${claim.claimToken}::uuid,
      ${result.success},
      ${detail}
    )`,
  );
  return finished.rows[0]?.finish_support_inbound_event ?? false;
}

async function processClaim(claim: InboundClaim): Promise<void> {
  await withOrgTx(claim.orgId, async (tx) => {
    const [event] = await tx
      .select({ payload: schema.supportInboundEvents.payload })
      .from(schema.supportInboundEvents)
      .where(
        and(
          eq(schema.supportInboundEvents.id, claim.id),
          eq(schema.supportInboundEvents.orgId, claim.orgId),
          eq(schema.supportInboundEvents.channelId, claim.channelId),
          eq(schema.supportInboundEvents.status, "processing"),
          eq(schema.supportInboundEvents.lockToken, claim.claimToken),
        ),
      )
      .limit(1);
    if (!event) throw new Error("Lease do webhook expirou");

    for (const message of normalizeInboundMessages(event.payload)) {
      await materializeMessage(tx, {
        orgId: claim.orgId,
        channelId: claim.channelId,
        message,
      });
    }
    await materializeStatuses(tx, {
      orgId: claim.orgId,
      channelId: claim.channelId,
      payload: event.payload,
    });
  });
}

export async function runSupportInboundCycle(limit = 20): Promise<{
  claimed: number;
  processed: number;
  failed: number;
}> {
  const claims = await claimInboundEvents(Math.max(1, Math.min(100, limit)));
  let processed = 0;
  let failed = 0;
  for (const claim of claims) {
    try {
      await processClaim(claim);
      await finishInboundEvent(claim, { success: true });
      processed += 1;
    } catch (error) {
      await finishInboundEvent(claim, { success: false, error }).catch(() => false);
      failed += 1;
    }
  }
  return { claimed: claims.length, processed, failed };
}
