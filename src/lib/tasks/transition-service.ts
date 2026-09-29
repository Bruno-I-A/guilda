import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { authorizeTransition, type OrgRole, type TaskStatus } from "@/domain/task-state";
import type { ActionResult } from "@/lib/action-context";
import { syncClosingFromTask } from "@/lib/closings/task-sync";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { syncCommitmentPeriodFromTask } from "@/lib/commitments/task-sync";
import { deactivateClosureClientWhenTasksFinish } from "@/lib/informatives/closure-completion";
import { encodeTaskCallback } from "@/lib/telegram/endpoint";
import { notificationPayload, enqueueTelegramNotificationIfEnabled } from "@/lib/telegram/notifications";
import { taskUrl } from "@/lib/telegram/notification-payload";

export interface TaskActor {
  orgId: string;
  userId: string;
  role: OrgRole;
}

async function linkedRhFlow(tx: OrgTx, orgId: string, taskId: string) {
  const [flow] = await tx
    .select({ id: schema.companyFlows.id, status: schema.companyFlows.status })
    .from(schema.companyFlows)
    .where(and(eq(schema.companyFlows.orgId, orgId), eq(schema.companyFlows.rhVerificationTaskId, taskId)))
    .limit(1);
  return flow ?? null;
}

export async function creditTaskXp(
  tx: OrgTx,
  task: schema.Task,
  taskEventId: string,
): Promise<void> {
  if (!task.assigneeId) throw new Error("Invariante violada: missão concluída sem responsável.");
  await tx.insert(schema.xpLedger).values({
    orgId: task.orgId,
    userId: task.assigneeId,
    taskId: task.id,
    taskEventId,
    amount: task.xpValue,
    reason: "task_completed",
  });
}

export async function transitionTaskForActor(input: {
  actor: TaskActor;
  taskId: string;
  to: TaskStatus;
  allowedFrom: TaskStatus[];
  note?: string;
  creditXp?: boolean;
  sideEffect?: (tx: OrgTx, task: schema.Task, taskEventId: string) => Promise<void>;
  audit?: { agentKeyId: string; tool: string; summary?: string };
}): Promise<ActionResult<{ eventId: string; status: TaskStatus }>> {
  const { actor } = input;
  return withOrgTx(actor.orgId, async (tx): Promise<ActionResult<{ eventId: string; status: TaskStatus }>> => {
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, input.taskId), eq(schema.tasks.orgId, actor.orgId)))
      .for("update");
    if (!task) return { ok: false, error: "Missão não encontrada." };
    if (!input.allowedFrom.includes(task.status)) {
      return { ok: false, error: "A missão não está mais neste estado — consulte-a novamente." };
    }

    if (input.to === "completed" || input.to === "awaiting_approval") {
      const [informativeFlow] = await tx
        .select({ id: schema.companyFlows.id })
        .from(schema.companyFlows)
        .where(and(eq(schema.companyFlows.orgId, actor.orgId), eq(schema.companyFlows.informativeTaskId, task.id)))
        .limit(1);
      if (informativeFlow) {
        return { ok: false, error: "Esta missão acompanha o Informativo do Fluxo e é concluída automaticamente na confirmação." };
      }
    }

    const rhFlow = input.to === "cancelled" || (task.status === "completed" && input.to === "in_progress")
      ? await linkedRhFlow(tx, actor.orgId, task.id)
      : null;
    if (rhFlow && rhFlow.status !== "cancelled") {
      if (input.to === "cancelled") {
        return { ok: false, error: "Esta é a verificação obrigatória do RH. Cancele o Fluxo de baixa para cancelar a missão." };
      }
      if (!["sent_to_corporate", "in_progress"].includes(rhFlow.status)) {
        return { ok: false, error: "A confirmação do RH não pode ser revertida porque o Fluxo de baixa já avançou para o dono." };
      }
    }
    if (input.to === "completed" && !task.assigneeId) {
      return { ok: false, error: "A missão precisa ter uma pessoa responsável antes da conclusão." };
    }

    let completedBy: string | null = null;
    if (task.status === "completed" && input.to === "in_progress") {
      await lockActiveClansForMembershipRead(tx, actor.orgId);
      const [activeMember] = await tx
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(and(eq(schema.member.organizationId, actor.orgId), eq(schema.member.userId, task.assigneeId ?? "")))
        .limit(1);
      if (!activeMember) return { ok: false, error: "A pessoa responsável não pertence mais à organização." };
      if (task.clanId) {
        const [activeClanMembership] = await tx
          .select({ id: schema.clanMemberships.id })
          .from(schema.clanMemberships)
          .innerJoin(
            schema.clans,
            and(
              eq(schema.clans.orgId, schema.clanMemberships.orgId),
              eq(schema.clans.id, schema.clanMemberships.clanId),
            ),
          )
          .where(and(
            eq(schema.clanMemberships.orgId, actor.orgId),
            eq(schema.clanMemberships.clanId, task.clanId),
            eq(schema.clanMemberships.userId, task.assigneeId ?? ""),
            eq(schema.clans.active, true),
          ))
          .limit(1);
        if (!activeClanMembership) {
          return { ok: false, error: "A pessoa responsável não pertence mais ao clã ativo da missão." };
        }
      }
      const [completion] = await tx
        .select({ actorId: schema.taskEvents.actorId })
        .from(schema.taskEvents)
        .where(and(eq(schema.taskEvents.orgId, actor.orgId), eq(schema.taskEvents.taskId, task.id), eq(schema.taskEvents.toStatus, "completed")))
        .orderBy(desc(schema.taskEvents.createdAt))
        .limit(1);
      completedBy = completion?.actorId ?? null;
    }

    const decision = authorizeTransition(input.to, {
      actor: { id: actor.userId, role: actor.role },
      task: {
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        status: task.status,
        completedAt: task.completedAt,
        completedBy,
        fromInformative: task.informativeId !== null,
      },
    });
    if (!decision.allowed) return { ok: false, error: decision.reason };

    const now = new Date();
    await tx
      .update(schema.tasks)
      .set({
        status: input.to,
        updatedAt: now,
        completedAt: input.to === "completed" ? now : task.status === "completed" ? null : task.completedAt,
      })
      .where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, actor.orgId)));
    const [event] = await tx
      .insert(schema.taskEvents)
      .values({
        orgId: actor.orgId,
        taskId: task.id,
        actorId: actor.userId,
        fromStatus: task.status,
        toStatus: input.to,
        note: input.note ?? null,
      })
      .returning({ id: schema.taskEvents.id });

    if (input.creditXp) await creditTaskXp(tx, task, event.id);
    if (input.sideEffect) await input.sideEffect(tx, task, event.id);
    await syncClosingFromTask(tx, { task, fromStatus: task.status, toStatus: input.to, changedAt: now });
    await syncCommitmentPeriodFromTask(tx, { task, fromStatus: task.status, toStatus: input.to, changedAt: now });
    if (input.to === "completed") {
      await deactivateClosureClientWhenTasksFinish(tx, { orgId: actor.orgId, informativeId: task.informativeId });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
    if (input.to === "awaiting_approval") {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: actor.orgId,
        userId: task.creatorId,
        eventType: "task_awaiting_approval",
        dedupeKey: `task-event:${event.id}:awaiting`,
        payload: notificationPayload(
          "approvals",
          `🛡️ Entrega para sua aprovação\n\n${task.title}\nRecompensa: ${task.xpValue} XP${input.note ? `\n\nRetorno: ${input.note}` : ""}`,
          [[{ text: "Aprovar", callbackData: encodeTaskCallback("approve", task.id) }, { text: "Abrir", url: taskUrl(task.id, baseUrl) }]],
        ),
      });
    } else if (input.to === "completed" && task.assigneeId) {
      const approved = task.status === "awaiting_approval";
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: actor.orgId,
        userId: task.assigneeId,
        eventType: approved ? "task_approved" : "task_completed",
        dedupeKey: `task-event:${event.id}:completed`,
        payload: notificationPayload(
          "xp",
          approved
            ? `🏆 Entrega aprovada\n\n${task.title}\n+${task.xpValue} XP${input.note ? `\n\nComentário: ${input.note}` : ""}`
            : `🏆 Missão concluída\n\n${task.title}\n+${task.xpValue} XP`,
          [[{ text: "Ver missão", url: taskUrl(task.id, baseUrl) }]],
        ),
      });
    } else if (input.to === "rejected" && task.assigneeId) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: actor.orgId,
        userId: task.assigneeId,
        eventType: "task_rejected",
        dedupeKey: `task-event:${event.id}:rejected`,
        payload: notificationPayload(
          "approvals",
          `↩️ Missão devolvida para ajustes\n\n${task.title}\nMotivo: ${input.note ?? "Consulte a missão."}`,
          [[{ text: "Retomar", callbackData: encodeTaskCallback("start", task.id) }, { text: "Abrir", url: taskUrl(task.id, baseUrl) }]],
        ),
      });
    } else if (
      input.to === "in_progress" &&
      (task.status === "pending" || task.status === "rejected") &&
      task.creatorId !== actor.userId
    ) {
      const [person] = await tx
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, actor.userId))
        .limit(1);
      const verb = task.status === "rejected" ? "retomou" : "iniciou";
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: actor.orgId,
        userId: task.creatorId,
        eventType: "task_started",
        dedupeKey: `task-event:${event.id}:started`,
        payload: notificationPayload(
          "tasks",
          `▶️ ${person?.name ?? "A pessoa responsável"} ${verb} a missão\n\n${task.title}`,
          [[{ text: "Ver missão", url: taskUrl(task.id, baseUrl) }]],
        ),
      });
    }

    if (input.audit) {
      await tx.insert(schema.mcpAuditEvents).values({
        orgId: actor.orgId,
        agentKeyId: input.audit.agentKeyId,
        actingUserId: actor.userId,
        tool: input.audit.tool,
        resourceType: "mission",
        resourceId: task.id,
        success: true,
        summary: input.audit.summary ?? `${task.status} → ${input.to}`,
      });
    }

    return { ok: true, data: { eventId: event.id, status: input.to } };
  });
}
