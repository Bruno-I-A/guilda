import "server-only";

import { and, asc, count, eq, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { enqueueMemberNotice } from "./enqueue";
import { dueDateLabel, taskPath } from "./links";
import { isScheduledMinute, zonedMinute } from "./schedule-time";

type Person = Readonly<{
  userId: string;
  timezone: string;
  dailySummary: boolean;
  dailySummaryTime: string;
  deadlineReminders: boolean;
  closingNotifications: boolean;
}>;

function dueDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Lembretes do dia de uma pessoa, no horário do resumo dela (padrão 08:00).
 * As chaves são diárias: rodar de novo no mesmo minuto não duplica.
 */
async function queuePerson(orgId: string, person: Person, now: Date): Promise<number> {
  const local = zonedMinute(now, person.timezone);
  if (!isScheduledMinute(local, person.dailySummaryTime)) return 0;
  const endOfLocalDate = new Date(`${local.date}T23:59:59.999Z`);
  return withOrgTx(orgId, async (tx) => {
    let queued = 0;
    if (person.deadlineReminders) {
      const tasks = await tx.query.tasks.findMany({
        where: and(
          eq(schema.tasks.orgId, orgId),
          eq(schema.tasks.assigneeId, person.userId),
          notInArray(schema.tasks.status, ["completed", "cancelled"]),
          lte(schema.tasks.dueDate, endOfLocalDate),
        ),
        columns: { id: true, title: true, dueDate: true, xpValue: true },
        orderBy: [asc(schema.tasks.dueDate)],
        limit: 25,
      });
      for (const task of tasks) {
        if (!task.dueDate) continue;
        await enqueueMemberNotice(tx, {
          orgId,
          userId: person.userId,
          dedupeKey: `task-deadline:${task.id}:${local.date}`,
          preference: "deadlines",
          notice: {
            family: "deadline",
            title: task.title,
            overdue: dueDateKey(task.dueDate) < local.date,
            due: dueDateLabel(task.dueDate),
            xp: task.xpValue,
            path: taskPath(task.id),
          },
        });
        queued++;
      }
    }

    if (person.closingNotifications) {
      const closings = await tx
        .select({ title: schema.accountingClosings.title, dueDate: schema.accountingClosings.dueDate, clientName: schema.clients.name })
        .from(schema.accountingClosings)
        .innerJoin(schema.clients, eq(schema.accountingClosings.clientId, schema.clients.id))
        .where(and(
          eq(schema.accountingClosings.orgId, orgId),
          notInArray(schema.accountingClosings.status, ["completed"]),
          lte(schema.accountingClosings.dueDate, local.date),
        ))
        .orderBy(asc(schema.accountingClosings.dueDate))
        .limit(10);
      if (closings.length) {
        await enqueueMemberNotice(tx, {
          orgId,
          userId: person.userId,
          dedupeKey: `closing-deadlines:${person.userId}:${local.date}`,
          preference: "closings",
          notice: {
            family: "general",
            heading: "Fechamentos pendentes",
            summary: `${closings.length} ${closings.length === 1 ? "fechamento vencido ou vencendo hoje" : "fechamentos vencidos ou vencendo hoje"}`,
            detail: closings.map((closing) => `${closing.clientName}, ${closing.title} (${closing.dueDate})`).join("; "),
            path: "closings",
          },
        });
        queued++;
      }
    }

    if (person.dailySummary) {
      const clanIds = (await tx
        .select({ clanId: schema.clanMemberships.clanId })
        .from(schema.clanMemberships)
        .innerJoin(schema.clans, and(eq(schema.clans.id, schema.clanMemberships.clanId), eq(schema.clans.orgId, schema.clanMemberships.orgId), eq(schema.clans.active, true)))
        .where(and(eq(schema.clanMemberships.orgId, orgId), eq(schema.clanMemberships.userId, person.userId))))
        .map((row) => row.clanId);
      const [open] = await tx
        .select({ total: count() })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.orgId, orgId), eq(schema.tasks.assigneeId, person.userId), notInArray(schema.tasks.status, ["completed", "cancelled"])));
      const [available] = clanIds.length
        ? await tx
            .select({ total: count() })
            .from(schema.tasks)
            .where(and(eq(schema.tasks.orgId, orgId), inArray(schema.tasks.clanId, clanIds), isNull(schema.tasks.assigneeId), notInArray(schema.tasks.status, ["completed", "cancelled"])))
        : [{ total: 0 }];
      const [xp] = await tx
        .select({ total: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int` })
        .from(schema.xpLedger)
        .where(and(eq(schema.xpLedger.orgId, orgId), eq(schema.xpLedger.userId, person.userId)));
      await enqueueMemberNotice(tx, {
        orgId,
        userId: person.userId,
        dedupeKey: `daily-summary:${person.userId}:${local.date}`,
        preference: "daily_summary",
        notice: { family: "daily_summary", open: open?.total ?? 0, available: available?.total ?? 0, xp: xp?.total ?? 0, path: "dashboard" },
      });
      queued++;
    }
    return queued;
  });
}

/**
 * Agenda os lembretes de todas as organizações, sempre entrando no RLS. Só
 * quem tem o número confirmado e ainda é da organização; sem preferência
 * salva valem os padrões da tabela.
 */
export async function queueScheduledMemberNotices(now = new Date()): Promise<number> {
  const organizations = await db.query.organization.findMany({ columns: { id: true } });
  let queued = 0;
  for (const organization of organizations) {
    const people = await withOrgTx(organization.id, (tx) =>
      tx
        .select({
          userId: schema.memberWhatsAppConnections.userId,
          timezone: schema.memberNotificationPreferences.timezone,
          dailySummary: schema.memberNotificationPreferences.dailySummary,
          dailySummaryTime: schema.memberNotificationPreferences.dailySummaryTime,
          deadlineReminders: schema.memberNotificationPreferences.deadlineReminders,
          closingNotifications: schema.memberNotificationPreferences.closingNotifications,
        })
        .from(schema.memberWhatsAppConnections)
        .innerJoin(schema.member, and(eq(schema.member.organizationId, schema.memberWhatsAppConnections.orgId), eq(schema.member.userId, schema.memberWhatsAppConnections.userId)))
        .leftJoin(schema.memberNotificationPreferences, and(
          eq(schema.memberNotificationPreferences.orgId, schema.memberWhatsAppConnections.orgId),
          eq(schema.memberNotificationPreferences.userId, schema.memberWhatsAppConnections.userId),
        ))
        .where(and(
          eq(schema.memberWhatsAppConnections.orgId, organization.id),
          eq(schema.memberWhatsAppConnections.enabled, true),
          isNotNull(schema.memberWhatsAppConnections.verifiedAt),
        )),
    );
    for (const row of people) {
      const person: Person = {
        userId: row.userId,
        timezone: row.timezone ?? "America/Sao_Paulo",
        dailySummary: row.dailySummary ?? false,
        dailySummaryTime: row.dailySummaryTime ?? "08:00:00",
        deadlineReminders: row.deadlineReminders ?? true,
        closingNotifications: row.closingNotifications ?? false,
      };
      try {
        queued += await queuePerson(organization.id, person, now);
      } catch (error) {
        console.error("Falha ao agendar os lembretes do WhatsApp", {
          orgId: organization.id,
          error: error instanceof Error ? error.message : "erro desconhecido",
        });
      }
    }
  }
  return queued;
}
