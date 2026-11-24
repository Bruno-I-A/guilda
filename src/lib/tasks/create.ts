import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { calculateTaskXp } from "@/domain/xp";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { enqueueClanNotice, enqueueMemberNotice } from "@/lib/notices/enqueue";
import { dueDateLabel, taskPath } from "@/lib/notices/links";
import { taskButton } from "@/lib/notices/notice";

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

/**
 * Missão de Informativo não avisa uma a uma: a confirmação manda um aviso
 * agrupado por pessoa (`enqueueInformativeAssignmentNotices`, 2026-11-24).
 */
export function shouldNotifyTaskCreation(
  informativeId: string | null | undefined,
): boolean {
  return !informativeId;
}

/**
 * Aviso de missão nova pelo WhatsApp: à pessoa responsável, com o botão
 * Iniciar; missão só do clã, a todos do clã. Quem cria para si mesmo não é
 * avisado da própria missão (2026-11-24).
 */
async function notifyTaskCreated(
  tx: OrgTx,
  input: {
    orgId: string;
    taskId: string;
    creatorId: string;
    assigneeId: string | null;
    clanId: string | null;
    title: string;
    dueDate: Date | null;
    xpValue: number;
  },
): Promise<void> {
  const [clan] = input.clanId
    ? await tx
        .select({ name: schema.clans.name })
        .from(schema.clans)
        .where(and(eq(schema.clans.orgId, input.orgId), eq(schema.clans.id, input.clanId)))
        .limit(1)
    : [];
  const context = clan ? `clã ${clan.name}` : undefined;
  if (input.assigneeId) {
    if (input.assigneeId === input.creatorId) return;
    await enqueueMemberNotice(tx, {
      orgId: input.orgId,
      userId: input.assigneeId,
      dedupeKey: `task:${input.taskId}:assigned`,
      preference: "tasks",
      notice: {
        family: "new_mission",
        heading: "Nova missão para você",
        title: input.title,
        ...(context ? { context } : {}),
        due: dueDateLabel(input.dueDate),
        xp: input.xpValue,
        path: taskPath(input.taskId),
        button: taskButton("start", input.taskId),
      },
    });
    return;
  }
  if (!input.clanId) return;
  await enqueueClanNotice(tx, {
    orgId: input.orgId,
    clanId: input.clanId,
    dedupeKey: `task:${input.taskId}:clan-created`,
    preference: "tasks",
    exceptUserIds: [input.creatorId],
    notice: {
      family: "new_mission",
      heading: clan ? `Nova missão para o clã ${clan.name}` : "Nova missão para o seu clã",
      title: input.title,
      ...(context ? { context } : {}),
      due: dueDateLabel(input.dueDate),
      xp: input.xpValue,
      path: taskPath(input.taskId),
    },
  });
}

/** Núcleo transacional compartilhado pela UI, pelo MCP e pelos Informativos. */
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

  if (shouldNotifyTaskCreation(input.informativeId)) {
    await notifyTaskCreated(tx, {
      orgId: input.orgId,
      taskId: task.id,
      creatorId: input.creatorId,
      assigneeId: input.assigneeId,
      clanId: input.clanId ?? null,
      title: input.title,
      dueDate: input.dueDate ?? null,
      xpValue,
    });
  }

  return { id: task.id, xpValue };
}
