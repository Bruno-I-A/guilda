import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { authorizeTransition, type OrgRole, type TaskStatus } from "@/domain/task-state";
import { findCompanyFlowTaskLink } from "@/lib/company-flows/managed-task";
import type { ActionResult } from "@/lib/action-context";
import { syncClosingFromTask } from "@/lib/closings/task-sync";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { syncCommitmentPeriodFromTask } from "@/lib/commitments/task-sync";
import { deactivateClosureClientWhenTasksFinish } from "@/lib/informatives/closure-completion";
import { enqueueMemberNotice } from "@/lib/notices/enqueue";
import { taskPath } from "@/lib/notices/links";
import { taskButton } from "@/lib/notices/notice";

export interface TaskActor {
  orgId: string;
  userId: string;
  role: OrgRole;
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

    const companyFlowLink = await findCompanyFlowTaskLink(
      tx,
      actor.orgId,
      task.id,
    );
    const rhFlow = companyFlowLink?.kind === "rh_verification"
      ? companyFlowLink
      : null;
    if (rhFlow && rhFlow.flowStatus !== "cancelled") {
      if (input.to === "cancelled") {
        return { ok: false, error: "Esta é a verificação obrigatória do RH. Cancele o Fluxo de baixa para cancelar a missão." };
      }
      if (!["sent_to_corporate", "in_progress"].includes(rhFlow.flowStatus)) {
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
        managedByCompanyFlow: companyFlowLink?.kind === "managed",
        companyFlowRhVerification:
          companyFlowLink?.kind === "rh_verification",
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

    if (input.to === "awaiting_approval") {
      const [person] = await tx
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, actor.userId))
        .limit(1);
      await enqueueMemberNotice(tx, {
        orgId: actor.orgId,
        userId: task.creatorId,
        dedupeKey: `task-event:${event.id}:awaiting`,
        preference: "approvals",
        notice: {
          family: "approval",
          who: person?.name ?? "A pessoa responsável",
          title: task.title,
          xp: task.xpValue,
          ...(input.note ? { note: input.note } : {}),
          path: taskPath(task.id),
          taskId: task.id,
        },
      });
    } else if (input.to === "completed" && task.assigneeId && task.assigneeId !== actor.userId) {
      const approved = task.status === "awaiting_approval";
      await enqueueMemberNotice(tx, {
        orgId: actor.orgId,
        userId: task.assigneeId,
        dedupeKey: `task-event:${event.id}:completed`,
        preference: "xp",
        notice: {
          family: "mission_update",
          title: task.title,
          update: approved ? `Entrega aprovada, +${task.xpValue} XP` : `Missão concluída, +${task.xpValue} XP`,
          ...(approved && input.note ? { detail: `Comentário: ${input.note}` } : {}),
          path: taskPath(task.id),
        },
      });
    } else if (input.to === "rejected" && task.assigneeId) {
      await enqueueMemberNotice(tx, {
        orgId: actor.orgId,
        userId: task.assigneeId,
        dedupeKey: `task-event:${event.id}:rejected`,
        preference: "approvals",
        notice: {
          family: "mission_update",
          title: task.title,
          update: "Missão devolvida para ajustes",
          detail: `Motivo: ${input.note ?? "consulte a missão"}`,
          path: taskPath(task.id),
          button: taskButton("resume", task.id),
        },
      });
    // Início e retomada não avisam quem pediu (2026-11-25, pedido do Bruno): só missão
    // nova, entrega e conclusão.
    } else if (input.to === "cancelled" && task.assigneeId && task.assigneeId !== actor.userId) {
      await enqueueMemberNotice(tx, {
        orgId: actor.orgId,
        userId: task.assigneeId,
        dedupeKey: `task-event:${event.id}:cancelled`,
        preference: "tasks",
        notice: {
          family: "mission_update",
          title: task.title,
          update: "Missão cancelada",
          ...(input.note ? { detail: `Motivo: ${input.note}` } : {}),
          path: taskPath(task.id),
        },
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
