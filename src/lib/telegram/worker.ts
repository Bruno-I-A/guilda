import "server-only";

import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { getTelegramClient } from "./client";
import type { InlineKeyboardButton } from "./endpoint";
import {
  appUrl,
  dueDateLabel,
  isTelegramNotificationPayload,
  taskUrl,
} from "./notification-payload";
import {
  enqueueTelegramNotification,
  notificationPayload,
} from "./notifications";
import {
  claimTelegramOutbox,
  deferTelegramOutbox,
  finishTelegramOutbox,
  type TelegramOutboxClaim,
} from "./outbox-repository";
import { isQuietMinute, isScheduledMinute, zonedMinute } from "./scheduler-time";

function preferenceEnabled(
  preference: string,
  settings: typeof schema.telegramPreferences.$inferSelect | undefined,
): boolean {
  if (preference === "tasks") return settings?.taskNotifications ?? true;
  if (preference === "approvals") return settings?.approvalNotifications ?? true;
  if (preference === "deadlines") return settings?.deadlineReminders ?? true;
  if (preference === "xp") return settings?.xpNotifications ?? true;
  if (preference === "closings") return settings?.closingNotifications ?? true;
  if (preference === "campaigns") return settings?.campaignNotifications ?? true;
  if (preference === "mural") return settings?.muralNotifications ?? true;
  return settings?.dailySummary ?? false;
}

async function readClaim(claim: TelegramOutboxClaim) {
  return withOrgTx(claim.orgId, async (tx) => {
    const item = await tx.query.telegramOutbox.findFirst({
      where: and(
        eq(schema.telegramOutbox.id, claim.id),
        eq(schema.telegramOutbox.orgId, claim.orgId),
        eq(schema.telegramOutbox.status, "processing"),
        eq(schema.telegramOutbox.lockToken, claim.claimToken),
      ),
    });
    if (!item || !isTelegramNotificationPayload(item.payload)) return null;
    const payload = item.payload;
    const connection = item.connectionId
      ? await tx.query.telegramConnections.findFirst({
          where: and(
            eq(schema.telegramConnections.id, item.connectionId),
            eq(schema.telegramConnections.orgId, claim.orgId),
            isNull(schema.telegramConnections.revokedAt),
          ),
        })
      : await tx.query.telegramConnections.findFirst({
          where: and(
            eq(schema.telegramConnections.orgId, claim.orgId),
            eq(schema.telegramConnections.userId, item.userId),
            isNull(schema.telegramConnections.revokedAt),
          ),
        });
    const preferences = await tx.query.telegramPreferences.findFirst({
      where: and(
        eq(schema.telegramPreferences.orgId, claim.orgId),
        eq(schema.telegramPreferences.userId, item.userId),
      ),
    });
    return { item, payload, connection, preferences };
  });
}

/** Envia um lote reservado; mensagens inválidas/desativadas são descartadas. */
export async function processTelegramOutbox(limit = 20): Promise<{
  claimed: number;
  sent: number;
  failed: number;
}> {
  const client = getTelegramClient();
  if (!client) return { claimed: 0, sent: 0, failed: 0 };
  const claims = await claimTelegramOutbox(limit);
  let sent = 0;
  let failed = 0;
  for (const claim of claims) {
    try {
      const record = await readClaim(claim);
      if (
        !record?.connection ||
        !preferenceEnabled(record.payload.preference, record.preferences)
      ) {
        await finishTelegramOutbox(claim, { success: true });
        continue;
      }
      if (
        record.preferences &&
        isQuietMinute(
          zonedMinute(new Date(), record.preferences.timezone).minutes,
          record.preferences.quietHoursStart,
          record.preferences.quietHoursEnd,
        )
      ) {
        await deferTelegramOutbox(claim, 15);
        continue;
      }
      const inlineKeyboard: InlineKeyboardButton[][] | undefined =
        record.payload.keyboard?.map((row) =>
          row.map((button) => ({
            text: button.text,
            ...(button.url ? { url: button.url } : {}),
            ...(button.callbackData ? { callback_data: button.callbackData } : {}),
          })),
        );
      await client.sendMessage(record.connection.chatId, record.payload.text, {
        ...(inlineKeyboard
          ? { replyMarkup: { inline_keyboard: inlineKeyboard } }
          : {}),
      });
      await finishTelegramOutbox(claim, { success: true });
      sent++;
    } catch (error) {
      await finishTelegramOutbox(claim, { success: false, error }).catch(() => false);
      failed++;
    }
  }
  return { claimed: claims.length, sent, failed };
}

function dueDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function queueMemberSchedule(
  orgId: string,
  member: {
    userId: string;
    timezone: string;
    dailySummary: boolean;
    dailySummaryTime: string;
    deadlineReminders: boolean;
    closingNotifications: boolean;
  },
  now: Date,
): Promise<number> {
  const local = zonedMinute(now, member.timezone);
  const endOfLocalDate = new Date(`${local.date}T23:59:59.999Z`);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  const scheduledNow = isScheduledMinute(local, member.dailySummaryTime);
  return withOrgTx(orgId, async (tx) => {
    let queued = 0;
    if (member.deadlineReminders && scheduledNow) {
      const tasks = await tx.query.tasks.findMany({
        where: and(
          eq(schema.tasks.orgId, orgId),
          eq(schema.tasks.assigneeId, member.userId),
          notInArray(schema.tasks.status, ["completed", "cancelled"]),
          lte(schema.tasks.dueDate, endOfLocalDate),
        ),
        columns: { id: true, title: true, dueDate: true, xpValue: true },
        orderBy: [asc(schema.tasks.dueDate)],
        limit: 25,
      });
      for (const task of tasks) {
        if (!task.dueDate) continue;
        const overdue = dueDateKey(task.dueDate) < local.date;
        await enqueueTelegramNotification(tx, {
          orgId,
          userId: member.userId,
          eventType: overdue ? "task_overdue" : "task_deadline",
          dedupeKey: `task-deadline:${task.id}:${local.date}`,
          payload: notificationPayload(
            "deadlines",
            `${overdue ? "⏰ Missão atrasada" : "📅 Missão vence hoje"}\n\n${task.title}\nPrazo: ${dueDateLabel(task.dueDate)}\nRecompensa: ${task.xpValue} XP`,
            [[{ text: "Abrir missão", url: taskUrl(task.id, baseUrl) }]],
          ),
        });
        queued++;
      }
    }

    if (member.closingNotifications && scheduledNow) {
      const closings = await tx
        .select({
          title: schema.accountingClosings.title,
          dueDate: schema.accountingClosings.dueDate,
          clientName: schema.clients.name,
        })
        .from(schema.accountingClosings)
        .innerJoin(schema.clients, eq(schema.accountingClosings.clientId, schema.clients.id))
        .where(
          and(
            eq(schema.accountingClosings.orgId, orgId),
            notInArray(schema.accountingClosings.status, ["completed"]),
            lte(schema.accountingClosings.dueDate, local.date),
          ),
        )
        .orderBy(asc(schema.accountingClosings.dueDate))
        .limit(10);
      if (closings.length) {
        const lines = closings.map(
          (closing) => `• ${closing.clientName} — ${closing.title} (${closing.dueDate})`,
        );
        await enqueueTelegramNotification(tx, {
          orgId,
          userId: member.userId,
          eventType: "closing_deadline",
          dedupeKey: `closing-deadlines:${member.userId}:${local.date}`,
          payload: notificationPayload(
            "closings",
            `📚 Fechamentos pendentes\n\n${lines.join("\n")}`,
            [[{ text: "Abrir fechamentos", url: appUrl("/closings", baseUrl) }]],
          ),
        });
        queued++;
      }
    }

    if (member.dailySummary && scheduledNow) {
      const clanMemberships = await tx
        .select({ clanId: schema.clanMemberships.clanId })
        .from(schema.clanMemberships)
        .innerJoin(
          schema.clans,
          and(
            eq(schema.clans.id, schema.clanMemberships.clanId),
            eq(schema.clans.orgId, schema.clanMemberships.orgId),
          ),
        )
        .where(
          and(
            eq(schema.clanMemberships.orgId, orgId),
            eq(schema.clanMemberships.userId, member.userId),
            eq(schema.clans.orgId, orgId),
            eq(schema.clans.active, true),
          ),
        );
      const [openTasks] = await tx
        .select({ total: count() })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.orgId, orgId),
            eq(schema.tasks.assigneeId, member.userId),
            notInArray(schema.tasks.status, ["completed", "cancelled"]),
          ),
        );
      const [availableClanTasks] = clanMemberships.length
        ? await tx
            .select({ total: count() })
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.orgId, orgId),
                inArray(
                  schema.tasks.clanId,
                  clanMemberships.map((membership) => membership.clanId),
                ),
                isNull(schema.tasks.assigneeId),
                notInArray(schema.tasks.status, ["completed", "cancelled"]),
              ),
            )
        : [{ total: 0 }];
      const [xp] = await tx
        .select({ total: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int` })
        .from(schema.xpLedger)
        .where(
          and(
            eq(schema.xpLedger.orgId, orgId),
            eq(schema.xpLedger.userId, member.userId),
          ),
        );
      await enqueueTelegramNotification(tx, {
        orgId,
        userId: member.userId,
        eventType: "daily_summary",
        dedupeKey: `daily-summary:${member.userId}:${local.date}`,
        payload: notificationPayload(
          "daily_summary",
          `🛡️ Resumo da Guilda\n\n${openTasks?.total ?? 0} missão(ões) em aberto com você\n${availableClanTasks?.total ?? 0} missão(ões) disponível(is) nos seus clãs\n${xp?.total ?? 0} XP no total`,
          baseUrl ? [[{ text: "Abrir Guilda", url: new URL("/dashboard", baseUrl).toString() }]] : undefined,
        ),
      });
      queued++;
    }
    return queued;
  });
}

/** Agenda lembretes/resumos de todas as organizações, sempre entrando no RLS. */
export async function queueScheduledTelegramNotifications(now = new Date()): Promise<number> {
  const organizations = await db.query.organization.findMany({ columns: { id: true } });
  let queued = 0;
  for (const organization of organizations) {
    const members = await withOrgTx(organization.id, (tx) =>
      tx
        .select({
          userId: schema.telegramConnections.userId,
          timezone: schema.telegramPreferences.timezone,
          dailySummary: schema.telegramPreferences.dailySummary,
          dailySummaryTime: schema.telegramPreferences.dailySummaryTime,
          deadlineReminders: schema.telegramPreferences.deadlineReminders,
          closingNotifications: schema.telegramPreferences.closingNotifications,
        })
        .from(schema.telegramConnections)
        .innerJoin(
          schema.telegramPreferences,
          and(
            eq(schema.telegramPreferences.orgId, schema.telegramConnections.orgId),
            eq(schema.telegramPreferences.userId, schema.telegramConnections.userId),
          ),
        )
        .where(
          and(
            eq(schema.telegramConnections.orgId, organization.id),
            isNull(schema.telegramConnections.revokedAt),
          ),
        ),
    );
    for (const member of members) {
      try {
        queued += await queueMemberSchedule(organization.id, member, now);
      } catch (error) {
        console.error("Falha ao agendar notificações Telegram", {
          orgId: organization.id,
          userId: member.userId,
          error: error instanceof Error ? error.message : "erro desconhecido",
        });
      }
    }
  }
  return queued;
}

export async function runTelegramWorkerCycle(): Promise<void> {
  if (!getTelegramClient()) return;
  await queueScheduledTelegramNotifications();
  const result = await processTelegramOutbox();
  if (result.failed > 0) {
    console.warn("Telegram outbox com falhas", result);
  }
}
