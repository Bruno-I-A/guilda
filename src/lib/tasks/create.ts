import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { calculateTaskXp } from "@/domain/xp";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { encodeTaskCallback } from "@/lib/telegram/endpoint";
import {
  enqueueTelegramNotificationIfEnabled,
  notificationPayload,
} from "@/lib/telegram/notifications";
import { dueDateLabel, taskUrl } from "@/lib/telegram/notification-payload";

export type CreateTaskRecordInput = {
  orgId: string;
  creatorId: string;
  assigneeId: string | null;
  /** Temporariamente opcional para manter compatibilidade com integrações legadas. */
  clanId?: string | null;
  clientId?: string | null;
  /** Informativo que originou a missão — agrupa o pacote da empresa. */
  informativeId?: string | null;
  closingId?: string | null;
  closingYearId?: string | null;
  /** Período de distribuição de lucros que originou esta missão. */
  commitmentPeriodId?: string | null;
  title: string;
  description?: string | null;
  priority: number;
  difficulty: number;
  dueDate?: Date | null;
};

/** Núcleo transacional compartilhado pela UI e pela confirmação via Telegram. */
export async function createTaskRecord(
  tx: OrgTx,
  input: CreateTaskRecordInput,
): Promise<{ id: string; xpValue: number }> {
  if (!input.assigneeId && !input.clanId) {
    throw new Error("A missão precisa ter uma pessoa responsável ou um clã.");
  }
  if (input.clanId) {
    await lockActiveClansForMembershipRead(tx, input.orgId);
    const [destination] = await tx
      .select({ clanId: schema.clans.id })
      .from(schema.clans)
      .leftJoin(
        schema.clanMemberships,
        and(
          eq(schema.clanMemberships.orgId, schema.clans.orgId),
          eq(schema.clanMemberships.clanId, schema.clans.id),
          input.assigneeId
            ? eq(schema.clanMemberships.userId, input.assigneeId)
            : undefined,
        ),
      )
      .leftJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.clans.orgId),
          input.assigneeId ? eq(schema.member.userId, input.assigneeId) : undefined,
        ),
      )
      .where(
        and(
          eq(schema.clans.orgId, input.orgId),
          eq(schema.clans.id, input.clanId),
          eq(schema.clans.active, true),
          input.assigneeId
            ? and(
                eq(schema.clanMemberships.userId, input.assigneeId),
                eq(schema.member.userId, input.assigneeId),
              )
            : undefined,
        ),
      )
      .limit(1);
    if (!destination) {
      throw new Error(
        input.assigneeId
          ? "A pessoa responsável não possui mais vínculo ativo com o clã."
          : "O clã de destino não está mais ativo.",
      );
    }
  }
  const xpValue = calculateTaskXp(input.difficulty, input.priority);
  const [task] = await tx
    .insert(schema.tasks)
    .values({
      orgId: input.orgId,
      creatorId: input.creatorId,
      assigneeId: input.assigneeId,
      clanId: input.clanId ?? null,
      clientId: input.clientId ?? null,
      informativeId: input.informativeId ?? null,
      closingId: input.closingId ?? null,
      closingYearId: input.closingYearId ?? null,
      commitmentPeriodId: input.commitmentPeriodId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      difficulty: input.difficulty,
      xpValue,
      status: "pending",
      dueDate: input.dueDate ?? null,
    })
    .returning({ id: schema.tasks.id });

  await tx.insert(schema.taskEvents).values({
    orgId: input.orgId,
    taskId: task.id,
    actorId: input.creatorId,
    fromStatus: null,
    toStatus: "pending",
  });

  if (input.assigneeId) {
    await enqueueTelegramNotificationIfEnabled(tx, {
      orgId: input.orgId,
      userId: input.assigneeId,
      eventType: "task_assigned",
      dedupeKey: `task:${task.id}:assigned`,
      payload: notificationPayload(
        "tasks",
        `⚔️ Nova missão atribuída\n\n${input.title}\nPrazo: ${dueDateLabel(input.dueDate ?? null)}\nRecompensa: ${xpValue} XP`,
        [[
          {
            text: "Iniciar missão",
            callbackData: encodeTaskCallback("start", task.id),
          },
          {
            text: "Abrir na Guilda",
            url: taskUrl(
              task.id,
              process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL,
            ),
          },
        ]],
      ),
    });
  } else if (input.clanId) {
    const leaders = await tx
      .select({ userId: schema.clanMemberships.userId })
      .from(schema.clanMemberships)
      .innerJoin(
        schema.clans,
        and(
          eq(schema.clans.id, schema.clanMemberships.clanId),
          eq(schema.clans.orgId, schema.clanMemberships.orgId),
        ),
      )
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.userId, schema.clanMemberships.userId),
          eq(schema.member.organizationId, schema.clanMemberships.orgId),
        ),
      )
      .where(
        and(
          eq(schema.clanMemberships.orgId, input.orgId),
          eq(schema.clanMemberships.clanId, input.clanId),
          eq(schema.clanMemberships.isLeader, true),
          eq(schema.clans.orgId, input.orgId),
          eq(schema.clans.active, true),
          eq(schema.member.organizationId, input.orgId),
        ),
      );

    for (const leader of leaders) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: input.orgId,
        userId: leader.userId,
        eventType: "task_clan_created",
        dedupeKey: `task:${task.id}:clan-created:leader:${leader.userId}`,
        payload: notificationPayload(
          "tasks",
          `🛡️ Nova missão para o seu clã\n\n${input.title}\nPrazo: ${dueDateLabel(input.dueDate ?? null)}\nRecompensa: ${xpValue} XP`,
          [[
            {
              text: "Abrir na Guilda",
              url: taskUrl(
                task.id,
                process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL,
              ),
            },
          ]],
        ),
      });
    }
  }

  return { id: task.id, xpValue };
}
