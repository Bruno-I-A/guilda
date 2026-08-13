import "server-only";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { calculateTaskXp } from "@/domain/xp";
import { encodeTaskCallback } from "@/lib/telegram/endpoint";
import {
  enqueueTelegramNotificationIfEnabled,
  notificationPayload,
} from "@/lib/telegram/notifications";
import { dueDateLabel, taskUrl } from "@/lib/telegram/notification-payload";

export type CreateTaskRecordInput = {
  orgId: string;
  creatorId: string;
  assigneeId: string;
  clientId?: string | null;
  closingYearId?: string | null;
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
  const xpValue = calculateTaskXp(input.difficulty, input.priority);
  const [task] = await tx
    .insert(schema.tasks)
    .values({
      orgId: input.orgId,
      creatorId: input.creatorId,
      assigneeId: input.assigneeId,
      clientId: input.clientId ?? null,
      closingYearId: input.closingYearId ?? null,
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

  return { id: task.id, xpValue };
}
