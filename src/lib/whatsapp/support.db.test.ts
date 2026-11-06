import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import * as schema from "@/db/schema";
import { applyMigrations } from "@/lib/nfse/testing/pglite";

vi.mock("server-only", () => ({}));

const client = new PGlite();
const pgDb = drizzle(client, { schema });
vi.mock("@/db", () => ({ db: pgDb }));

const ORG = "support-org-a";
const OTHER = "support-org-b";
let channelId = "";

beforeAll(async () => {
  await applyMigrations(client);
  await client.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES
      ('${ORG}', 'Escritório A', 'support-a', now()),
      ('${OTHER}', 'Escritório B', 'support-b', now());
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('support-user', 'Atendente', 'support@example.com', true, now(), now());
  `);
  await client.exec("SET ROLE guilda_app;");

  const { withOrgTx } = await import("@/db/org-tx");
  const [channel] = await withOrgTx(ORG, (tx) =>
    tx
      .insert(schema.supportWhatsAppChannels)
      .values({
        orgId: ORG,
        name: "WhatsApp principal",
        status: "active",
        wabaId: "111111",
        phoneNumberId: "222222",
        displayPhoneNumber: "+5554999999999",
        coexistenceEnabled: true,
        createdBy: "support-user",
      })
      .returning({ id: schema.supportWhatsAppChannels.id }),
  );
  channelId = channel.id;
}, 120_000);

afterAll(() => client.close());

test("roteia antes do tenant sem revelar credenciais", async () => {
  const repository = await import("./webhook-repository");
  await expect(repository.lookupWhatsAppChannel("222222")).resolves.toEqual({
    channelId,
    orgId: ORG,
  });
  await expect(repository.lookupWhatsAppChannel("999999")).resolves.toBeNull();
});

test("RLS isola conversas e o histórico é append-only", async () => {
  const { withOrgTx } = await import("@/db/org-tx");
  const { contactId, conversationId, messageId } = await withOrgTx(ORG, async (tx) => {
    const [contact] = await tx
      .insert(schema.supportContacts)
      .values({
        orgId: ORG,
        whatsappId: "5554988888888",
        phoneE164: "+5554988888888",
        displayName: "Cliente",
      })
      .returning({ id: schema.supportContacts.id });
    const [conversation] = await tx
      .insert(schema.supportConversations)
      .values({ orgId: ORG, channelId, contactId: contact.id })
      .returning({ id: schema.supportConversations.id });
    const [message] = await tx
      .insert(schema.supportMessages)
      .values({
        orgId: ORG,
        channelId,
        conversationId: conversation.id,
        externalMessageId: "wamid.inbound.1",
        direction: "inbound",
        actor: "customer",
        source: "cloud_api",
        messageType: "text",
        text: "Preciso da guia",
        occurredAt: new Date("2026-11-06T12:00:00Z"),
      })
      .returning({ id: schema.supportMessages.id });
    await tx.insert(schema.supportMessageEvents).values({
      orgId: ORG,
      messageId: message.id,
      eventType: "received",
      occurredAt: new Date("2026-11-06T12:00:00Z"),
    });
    return { contactId: contact.id, conversationId: conversation.id, messageId: message.id };
  });

  expect(
    await withOrgTx(OTHER, (tx) => tx.select().from(schema.supportMessages)),
  ).toEqual([]);
  await expect(
    withOrgTx(ORG, (tx) =>
      tx.update(schema.supportMessages).set({ text: "texto adulterado" }).where(eq(schema.supportMessages.id, messageId)),
    ),
  ).rejects.toThrow();
  await expect(
    withOrgTx(ORG, (tx) =>
      tx.delete(schema.supportMessageEvents).where(eq(schema.supportMessageEvents.messageId, messageId)),
    ),
  ).rejects.toThrow();

  expect(contactId).toMatch(/^[0-9a-f-]{36}$/);
  expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
});

test("webhook é deduplicado e o claim global volta ao RLS do tenant", async () => {
  const repository = await import("./webhook-repository");
  const { withOrgTx } = await import("@/db/org-tx");
  const route = { orgId: ORG, channelId };
  const change = {
    phoneNumberId: "222222",
    field: "smb_message_echoes",
    payload: {
      metadata: { phone_number_id: "222222" },
      message_echoes: [{ id: "wamid.echo.1", to: "5554988888888", type: "text" }],
    },
  } as const;

  await expect(
    repository.enqueueWhatsAppChange({ route, fingerprint: "a".repeat(64), change }),
  ).resolves.toBe("queued");
  await expect(
    repository.enqueueWhatsAppChange({ route, fingerprint: "a".repeat(64), change }),
  ).resolves.toBe("duplicate");

  const claimed = await pgDb.execute<{
    event_id: string;
    org_id: string;
    channel_id: string;
    claim_token: string;
  }>(sql`SELECT * FROM public.claim_support_inbound_events(10)`);
  expect(claimed.rows).toHaveLength(1);
  expect(claimed.rows[0]).toMatchObject({ org_id: ORG, channel_id: channelId });

  const [event] = await withOrgTx(ORG, (tx) =>
    tx
      .select()
      .from(schema.supportInboundEvents)
      .where(eq(schema.supportInboundEvents.id, claimed.rows[0].event_id)),
  );
  expect(event.status).toBe("processing");
  expect(event.webhookField).toBe("smb_message_echoes");

  const finished = await pgDb.execute<{ finish_support_inbound_event: boolean }>(
    sql`SELECT public.finish_support_inbound_event(
      ${claimed.rows[0].event_id}::uuid,
      ${claimed.rows[0].claim_token}::uuid,
      true,
      NULL
    )`,
  );
  expect(finished.rows[0].finish_support_inbound_event).toBe(true);
  const [processed] = await withOrgTx(ORG, (tx) =>
    tx
      .select({ status: schema.supportInboundEvents.status })
      .from(schema.supportInboundEvents)
      .where(eq(schema.supportInboundEvents.id, event.id)),
  );
  expect(processed.status).toBe("processed");
});

test("eco do Business App aparece como mensagem humana e pausa a IA", async () => {
  const repository = await import("./webhook-repository");
  const { runSupportInboundCycle } = await import("./inbound-worker");
  const { withOrgTx } = await import("@/db/org-tx");

  await repository.enqueueWhatsAppChange({
    route: { orgId: ORG, channelId },
    fingerprint: "b".repeat(64),
    change: {
      phoneNumberId: "222222",
      field: "smb_message_echoes",
      payload: {
        metadata: { phone_number_id: "222222" },
        message_echoes: [
          {
            from: "5554999999999",
            to: "5554988888888",
            id: "wamid.echo.human.1",
            timestamp: "1793966400",
            type: "text",
            text: { body: "Já vou conferir para você." },
          },
        ],
      },
    },
  });

  await expect(runSupportInboundCycle()).resolves.toEqual({
    claimed: 1,
    processed: 1,
    failed: 0,
  });

  const state = await withOrgTx(ORG, async (tx) => {
    const [message] = await tx
      .select({
        actor: schema.supportMessages.actor,
        source: schema.supportMessages.source,
        text: schema.supportMessages.text,
        conversationId: schema.supportMessages.conversationId,
      })
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.externalMessageId, "wamid.echo.human.1"));
    const [conversation] = await tx
      .select({
        status: schema.supportConversations.status,
        aiPauseReason: schema.supportConversations.aiPauseReason,
      })
      .from(schema.supportConversations)
      .where(eq(schema.supportConversations.id, message.conversationId));
    const events = await tx
      .select({ type: schema.supportConversationEvents.eventType })
      .from(schema.supportConversationEvents)
      .where(eq(schema.supportConversationEvents.conversationId, message.conversationId));
    return { message, conversation, events };
  });

  expect(state.message).toMatchObject({
    actor: "attendant",
    source: "business_app",
    text: "Já vou conferir para você.",
  });
  expect(state.conversation).toEqual({
    status: "human_active",
    aiPauseReason: "business_app_message",
  });
  expect(state.events.map((event) => event.type)).toContain("ai_paused");
});
