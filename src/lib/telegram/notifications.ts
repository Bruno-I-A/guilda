import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import type { TelegramNotificationPayload } from "./notification-payload";

export async function enqueueTelegramNotification(
  tx: OrgTx,
  input: {
    orgId: string;
    userId: string;
    eventType: string;
    dedupeKey: string;
    payload: TelegramNotificationPayload;
    scheduledFor?: Date;
  },
): Promise<void> {
  await tx
    .insert(schema.telegramOutbox)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      eventType: input.eventType.slice(0, 80),
      dedupeKey: input.dedupeKey.slice(0, 255),
      payload: input.payload,
      scheduledFor: input.scheduledFor,
    })
    .onConflictDoNothing();
}

export async function enqueueTelegramNotificationIfEnabled(
  tx: OrgTx,
  input: {
    orgId: string;
    userId: string;
    eventType: string;
    dedupeKey: string;
    payload: TelegramNotificationPayload;
    scheduledFor?: Date;
  },
): Promise<void> {
  const connection = await tx.query.telegramConnections.findFirst({
    where: and(
      eq(schema.telegramConnections.orgId, input.orgId),
      eq(schema.telegramConnections.userId, input.userId),
      isNull(schema.telegramConnections.revokedAt),
    ),
    columns: { id: true },
  });
  if (!connection) return;

  const preferences = await tx.query.telegramPreferences.findFirst({
    where: and(
      eq(schema.telegramPreferences.orgId, input.orgId),
      eq(schema.telegramPreferences.userId, input.userId),
    ),
  });
  const preferenceEnabled =
    input.payload.preference === "tasks"
      ? preferences?.taskNotifications ?? true
      : input.payload.preference === "approvals"
        ? preferences?.approvalNotifications ?? true
        : input.payload.preference === "deadlines"
          ? preferences?.deadlineReminders ?? true
          : input.payload.preference === "xp"
            ? preferences?.xpNotifications ?? true
            : input.payload.preference === "closings"
              ? preferences?.closingNotifications ?? true
              : input.payload.preference === "campaigns"
                ? preferences?.campaignNotifications ?? true
                : preferences?.dailySummary ?? false;
  if (!preferenceEnabled) return;

  await tx
    .insert(schema.telegramOutbox)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      connectionId: connection.id,
      eventType: input.eventType.slice(0, 80),
      dedupeKey: input.dedupeKey.slice(0, 255),
      payload: input.payload,
      scheduledFor: input.scheduledFor,
    })
    .onConflictDoNothing();
}

export function notificationPayload(
  preference: TelegramNotificationPayload["preference"],
  text: string,
  keyboard?: TelegramNotificationPayload["keyboard"],
): TelegramNotificationPayload {
  return {
    version: 1,
    text: text.slice(0, 4096),
    preference,
    ...(keyboard?.length ? { keyboard } : {}),
  };
}

export async function enqueueTelegramOrgBroadcast(
  tx: OrgTx,
  input: {
    orgId: string;
    eventType: string;
    dedupeKey: string;
    payload: TelegramNotificationPayload;
  },
): Promise<void> {
  const connections = await tx.query.telegramConnections.findMany({
    where: and(
      eq(schema.telegramConnections.orgId, input.orgId),
      isNull(schema.telegramConnections.revokedAt),
    ),
    columns: { userId: true },
  });
  for (const connection of connections) {
    await enqueueTelegramNotificationIfEnabled(tx, {
      ...input,
      userId: connection.userId,
      dedupeKey: `${input.dedupeKey}:user:${connection.userId}`,
    });
  }
}
