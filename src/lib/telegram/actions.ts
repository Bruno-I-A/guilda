import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  authorizeTransition,
  type OrgRole,
  type TaskStatus,
} from "@/domain/task-state";
import { syncClosingFromTask } from "@/lib/closings/task-sync";
import { syncCommitmentPeriodFromTask } from "@/lib/commitments/task-sync";

import type { TaskCallbackAction } from "./endpoint";
import { encodeTaskCallback } from "./endpoint";
import { notificationPayload, enqueueTelegramNotificationIfEnabled } from "./notifications";
import { taskUrl } from "./notification-payload";
import { TASK_ACTION_TRANSITIONS } from "./task-action-intent";

export type TelegramTaskActionResult =
  | { ok: true; title: string; status: TaskStatus }
  | { ok: false; error: string };

function isOrgRole(value: string): value is OrgRole {
  return value === "owner" || value === "admin" || value === "member";
}

/**
 * Transição chamada pelo bot com ator explícito. Repete as garantias do
 * fluxo web: associação atual, tenant/RLS, lock, máquina de estados, auditoria
 * e crédito idempotente de XP na mesma transação.
 */
export async function runTelegramTaskAction(input: {
  orgId: string;
  userId: string;
  taskId: string;
  action: TaskCallbackAction;
  note?: string;
}): Promise<TelegramTaskActionResult> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(schema.member.organizationId, input.orgId),
      eq(schema.member.userId, input.userId),
    ),
    columns: { role: true },
  });
  if (!membership || !isOrgRole(membership.role)) {
    return { ok: false, error: "Seu acesso a esta guilda não está mais ativo." };
  }
  const role = membership.role;

  const intent = TASK_ACTION_TRANSITIONS[input.action];
  return withOrgTx(input.orgId, async (tx): Promise<TelegramTaskActionResult> => {
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, input.taskId),
          eq(schema.tasks.orgId, input.orgId),
        ),
      )
      .for("update");

    if (!task) return { ok: false, error: "Missão não encontrada." };
    if (!intent.allowedFrom.includes(task.status)) {
      return {
        ok: false,
        error: "A missão mudou de estado. Consulte a lista novamente.",
      };
    }
    if (intent.to === "cancelled") {
      const [linkedRhVerificationFlow] = await tx
        .select({ id: schema.companyFlows.id, status: schema.companyFlows.status })
        .from(schema.companyFlows)
        .where(and(
          eq(schema.companyFlows.orgId, input.orgId),
          eq(schema.companyFlows.rhVerificationTaskId, task.id),
        ))
        .limit(1);
      if (
        linkedRhVerificationFlow &&
        linkedRhVerificationFlow.status !== "cancelled"
      ) {
        return {
          ok: false,
          error: "Esta é a verificação obrigatória do RH. Cancele o Fluxo de baixa para cancelar a missão.",
        };
      }
    }
    if (intent.to === "completed" && !task.assigneeId) {
      return {
        ok: false,
        error: "Atribua a missão a uma pessoa antes de concluí-la.",
      };
    }

    const decision = authorizeTransition(intent.to, {
      actor: { id: input.userId, role },
      task: {
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        status: task.status,
      },
    });
    if (!decision.allowed) return { ok: false, error: decision.reason };
    if (input.action === "reject" && (!input.note || input.note.trim().length < 3)) {
      return { ok: false, error: "Informe o motivo da rejeição." };
    }

    const now = new Date();
    await tx
      .update(schema.tasks)
      .set({
        status: intent.to,
        updatedAt: now,
        completedAt: intent.to === "completed" ? now : task.completedAt,
      })
      .where(
        and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, input.orgId)),
      );

    const [event] = await tx
      .insert(schema.taskEvents)
      .values({
        orgId: input.orgId,
        taskId: task.id,
        actorId: input.userId,
        fromStatus: task.status,
        toStatus: intent.to,
        note: input.note?.trim().slice(0, 2000) ?? null,
      })
      .returning({ id: schema.taskEvents.id });

    if (intent.to === "completed" && task.assigneeId) {
      await tx
        .insert(schema.xpLedger)
        .values({
          orgId: input.orgId,
          userId: task.assigneeId,
          taskId: task.id,
          taskEventId: event.id,
          amount: task.xpValue,
          reason: "task_completed",
        })
        .onConflictDoNothing();
    }
    await syncClosingFromTask(tx, {
      task,
      fromStatus: task.status,
      toStatus: intent.to,
      changedAt: now,
    });
    await syncCommitmentPeriodFromTask(tx, {
      task,
      fromStatus: task.status,
      toStatus: intent.to,
      changedAt: now,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
    if (intent.to === "awaiting_approval") {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: input.orgId,
        userId: task.creatorId,
        eventType: "task_awaiting_approval",
        dedupeKey: `task-event:${event.id}:awaiting`,
        payload: notificationPayload(
          "approvals",
          `🛡️ Missão aguardando aprovação\n\n${task.title}\nRecompensa: ${task.xpValue} XP`,
          [[
            { text: "Aprovar", callbackData: encodeTaskCallback("approve", task.id) },
            { text: "Abrir", url: taskUrl(task.id, baseUrl) },
          ]],
        ),
      });
    } else if (intent.to === "completed" && task.assigneeId) {
      const completionEventType =
        task.status === "awaiting_approval" ? "task_approved" : "task_completed";
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: input.orgId,
        userId: task.assigneeId,
        eventType: completionEventType,
        dedupeKey: `task-event:${event.id}:completed`,
        payload: notificationPayload(
          "xp",
          `🏆 Missão concluída\n\n${task.title}\n+${task.xpValue} XP`,
          [[{ text: "Ver missão", url: taskUrl(task.id, baseUrl) }]],
        ),
      });
    } else if (intent.to === "rejected" && task.assigneeId) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: input.orgId,
        userId: task.assigneeId,
        eventType: "task_rejected",
        dedupeKey: `task-event:${event.id}:rejected`,
        payload: notificationPayload(
          "approvals",
          `↩️ Missão devolvida para ajustes\n\n${task.title}\nMotivo: ${input.note?.trim()}`,
          [[
            { text: "Retomar", callbackData: encodeTaskCallback("start", task.id) },
            { text: "Abrir", url: taskUrl(task.id, baseUrl) },
          ]],
        ),
      });
    } else if (
      intent.to === "cancelled" &&
      task.assigneeId &&
      task.assigneeId !== input.userId
    ) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: input.orgId,
        userId: task.assigneeId,
        eventType: "task_cancelled",
        dedupeKey: `task-event:${event.id}:cancelled`,
        payload: notificationPayload(
          "tasks",
          `🛑 Missão cancelada\n\n${task.title}${input.note ? `\nMotivo: ${input.note.trim()}` : ""}`,
          [[{ text: "Ver missão", url: taskUrl(task.id, baseUrl) }]],
        ),
      });
    }

    return { ok: true, title: task.title, status: intent.to };
  });
}
