import "server-only";

import { and, eq } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { authorizeTaskTransfer, resolveAssigneeClan } from "@/domain/clans";
import type { TaskStatus } from "@/domain/task-state";
import { loadClanScopedFacts } from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { createTaskRecord } from "@/lib/tasks/create";
import { transitionTaskForActor } from "@/lib/tasks/transition-service";

import type { McpActor } from "./access";

export type McpCommandResult =
  | { ok: true; mission_id: string; status?: TaskStatus; updated_at?: string }
  | { ok: false; error: string };

async function existingReceipt(
  actor: McpActor,
  idempotencyKey: string,
): Promise<McpCommandResult | null> {
  return withOrgTx(actor.orgId, async (tx) => {
    const [receipt] = await tx
      .select({ result: schema.mcpCommandReceipts.result })
      .from(schema.mcpCommandReceipts)
      .where(and(
        eq(schema.mcpCommandReceipts.orgId, actor.orgId),
        eq(schema.mcpCommandReceipts.agentKeyId, actor.agentKeyId),
        eq(schema.mcpCommandReceipts.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    return (receipt?.result as McpCommandResult | undefined) ?? null;
  });
}

async function saveReceipt(
  actor: McpActor,
  tool: string,
  idempotencyKey: string,
  result: McpCommandResult,
): Promise<McpCommandResult> {
  return withOrgTx(actor.orgId, async (tx) => {
    await tx
      .insert(schema.mcpCommandReceipts)
      .values({
        orgId: actor.orgId,
        agentKeyId: actor.agentKeyId,
        idempotencyKey,
        tool,
        result,
      })
      .onConflictDoNothing({
        target: [schema.mcpCommandReceipts.agentKeyId, schema.mcpCommandReceipts.idempotencyKey],
      });
    const [stored] = await tx
      .select({ result: schema.mcpCommandReceipts.result })
      .from(schema.mcpCommandReceipts)
      .where(and(
        eq(schema.mcpCommandReceipts.orgId, actor.orgId),
        eq(schema.mcpCommandReceipts.agentKeyId, actor.agentKeyId),
        eq(schema.mcpCommandReceipts.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    return (stored?.result as McpCommandResult | undefined) ?? result;
  });
}

export async function transitionMissionCommand(input: {
  actor: McpActor;
  tool: string;
  idempotencyKey: string;
  missionId: string;
  to: TaskStatus;
  allowedFrom: TaskStatus[];
  note?: string;
  creditXp?: boolean;
}): Promise<McpCommandResult> {
  const receipt = await existingReceipt(input.actor, input.idempotencyKey);
  if (receipt) return receipt;

  const changed = await transitionTaskForActor({
    actor: input.actor,
    taskId: input.missionId,
    to: input.to,
    allowedFrom: input.allowedFrom,
    note: input.note,
    creditXp: input.creditXp,
    audit: {
      agentKeyId: input.actor.agentKeyId,
      tool: input.tool,
      summary: `${input.to}; idempotency=${input.idempotencyKey}`,
    },
  });
  const result: McpCommandResult = changed.ok
    ? { ok: true, mission_id: input.missionId, status: input.to }
    : { ok: false, error: changed.error };

  // Uma concorrente pode ter terminado enquanto esta esperava o lock. Nesse
  // caso, prefira o recibo da intenção original em vez de devolver um falso
  // conflito para o retry do mesmo comando.
  if (!changed.ok) {
    const concurrent = await existingReceipt(input.actor, input.idempotencyKey);
    if (concurrent) return concurrent;
  }
  return saveReceipt(input.actor, input.tool, input.idempotencyKey, result);
}

export async function editMissionCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  missionId: string;
  expectedUpdatedAt: string;
  title: string;
  description?: string;
  dueDate?: string;
}): Promise<McpCommandResult> {
  const receipt = await existingReceipt(input.actor, input.idempotencyKey);
  if (receipt) return receipt;

  const result = await withOrgTx(input.actor.orgId, async (tx): Promise<McpCommandResult> => {
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.orgId, input.actor.orgId), eq(schema.tasks.id, input.missionId)))
      .for("update");
    if (!task) return { ok: false, error: "Missão não encontrada." };
    const admin = input.actor.role === "owner" || input.actor.role === "admin";
    if (task.creatorId !== input.actor.userId && !admin) {
      return { ok: false, error: "Apenas quem criou a missão ou um admin pode editá-la." };
    }
    if (!["pending", "in_progress", "rejected"].includes(task.status)) {
      return { ok: false, error: "Missões em aprovação, concluídas ou canceladas não podem ser editadas." };
    }
    if (task.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
      return { ok: false, error: "A missão mudou desde a leitura. Consulte-a novamente antes de editar." };
    }
    const dueDate = input.dueDate
      ? /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
        ? new Date(`${input.dueDate}T12:00:00Z`)
        : new Date(input.dueDate)
      : null;
    const now = new Date();
    await tx
      .update(schema.tasks)
      .set({ title: input.title, description: input.description ?? null, dueDate, updatedAt: now })
      .where(and(eq(schema.tasks.orgId, input.actor.orgId), eq(schema.tasks.id, task.id)));
    await tx.insert(schema.mcpAuditEvents).values({
      orgId: input.actor.orgId,
      agentKeyId: input.actor.agentKeyId,
      actingUserId: input.actor.userId,
      tool: "editar_missao",
      resourceType: "mission",
      resourceId: task.id,
      success: true,
      summary: `Título, descrição ou prazo; idempotency=${input.idempotencyKey}`,
    });
    return { ok: true, mission_id: task.id, updated_at: now.toISOString() };
  });
  return saveReceipt(input.actor, "editar_missao", input.idempotencyKey, result);
}

async function activeMemberships(tx: OrgTx, actor: McpActor, userId: string) {
  await lockActiveClansForMembershipRead(tx, actor.orgId);
  return tx
    .select({ clanId: schema.clanMemberships.clanId, isPrimary: schema.clanMemberships.isPrimary })
    .from(schema.clanMemberships)
    .innerJoin(schema.clans, and(eq(schema.clans.orgId, schema.clanMemberships.orgId), eq(schema.clans.id, schema.clanMemberships.clanId)))
    .innerJoin(schema.member, and(eq(schema.member.organizationId, schema.clanMemberships.orgId), eq(schema.member.userId, schema.clanMemberships.userId)))
    .where(and(
      eq(schema.clanMemberships.orgId, actor.orgId),
      eq(schema.clanMemberships.userId, userId),
      eq(schema.clans.active, true),
    ));
}

export async function createMissionCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  title: string;
  description?: string;
  priority: number;
  difficulty: number;
  dueDate?: string;
  clientId?: string;
  assigneeId?: string;
  clanId?: string;
}): Promise<McpCommandResult> {
  return withOrgTx(input.actor.orgId, async (tx): Promise<McpCommandResult> => {
    const [receipt] = await tx
      .select({ result: schema.mcpCommandReceipts.result })
      .from(schema.mcpCommandReceipts)
      .where(and(
        eq(schema.mcpCommandReceipts.orgId, input.actor.orgId),
        eq(schema.mcpCommandReceipts.agentKeyId, input.actor.agentKeyId),
        eq(schema.mcpCommandReceipts.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    if (receipt) return receipt.result as McpCommandResult;

    if (input.clientId) {
      const [client] = await tx
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(and(eq(schema.clients.orgId, input.actor.orgId), eq(schema.clients.id, input.clientId)))
        .limit(1);
      if (!client) return { ok: false, error: "Empresa não encontrada." };
    }

    const assigneeId: string | null = input.assigneeId ?? null;
    let clanId: string;
    if (assigneeId) {
      const memberships = await activeMemberships(tx, input.actor, assigneeId);
      const resolved = resolveAssigneeClan(memberships, input.clanId);
      if (!resolved.ok) return { ok: false, error: resolved.reason };
      clanId = resolved.clanId;
    } else if (input.clanId) {
      const [clan] = await tx
        .select({ id: schema.clans.id })
        .from(schema.clans)
        .where(and(eq(schema.clans.orgId, input.actor.orgId), eq(schema.clans.id, input.clanId), eq(schema.clans.active, true)))
        .limit(1);
      if (!clan) return { ok: false, error: "Clã ativo não encontrado." };
      clanId = clan.id;
    } else {
      return { ok: false, error: "Informe uma pessoa responsável ou um clã." };
    }

    const dueDate = input.dueDate
      ? /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
        ? new Date(`${input.dueDate}T12:00:00Z`)
        : new Date(input.dueDate)
      : null;
    const task = await createTaskRecord(tx, {
      orgId: input.actor.orgId,
      creatorId: input.actor.userId,
      assigneeId,
      clanId,
      clientId: input.clientId ?? null,
      title: input.title,
      description: input.description,
      priority: input.priority,
      difficulty: input.difficulty,
      dueDate,
    });
    const result: McpCommandResult = { ok: true, mission_id: task.id, status: "pending" };
    await tx.insert(schema.mcpAuditEvents).values({
      orgId: input.actor.orgId,
      agentKeyId: input.actor.agentKeyId,
      actingUserId: input.actor.userId,
      tool: "criar_missao",
      resourceType: "mission",
      resourceId: task.id,
      success: true,
      summary: `Missão criada; idempotency=${input.idempotencyKey}`,
    });
    await tx.insert(schema.mcpCommandReceipts).values({
      orgId: input.actor.orgId,
      agentKeyId: input.actor.agentKeyId,
      idempotencyKey: input.idempotencyKey,
      tool: "criar_missao",
      result,
    });
    return result;
  });
}

export async function transferMissionCommand(input: {
  actor: McpActor;
  idempotencyKey: string;
  missionId: string;
  expectedUpdatedAt: string;
  assigneeId: string;
  clanId?: string;
  note?: string;
}): Promise<McpCommandResult> {
  const existing = await existingReceipt(input.actor, input.idempotencyKey);
  if (existing) return existing;
  const result = await withOrgTx(input.actor.orgId, async (tx): Promise<McpCommandResult> => {
    const [task] = await tx.select().from(schema.tasks).where(and(eq(schema.tasks.orgId, input.actor.orgId), eq(schema.tasks.id, input.missionId))).for("update");
    if (!task) return { ok: false, error: "Missão não encontrada." };
    if (task.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
      return { ok: false, error: "A missão mudou desde a leitura. Consulte-a novamente antes de transferir." };
    }
    const memberships = await activeMemberships(tx, input.actor, input.assigneeId);
    const destination = resolveAssigneeClan(memberships, input.clanId);
    if (!destination.ok) return { ok: false, error: destination.reason };
    const [rhFlow] = await tx
      .select({ id: schema.companyFlows.id })
      .from(schema.companyFlows)
      .where(and(eq(schema.companyFlows.orgId, input.actor.orgId), eq(schema.companyFlows.rhVerificationTaskId, task.id)))
      .limit(1);
    if (rhFlow && task.clanId && destination.clanId !== task.clanId) {
      return { ok: false, error: "A verificação da folha e do pró-labore deve permanecer no clã RH." };
    }
    let actorIsClanMember = false;
    if (task.clanId) {
      actorIsClanMember = (await loadClanScopedFacts(tx, input.actor.orgId, task.clanId, input.actor.userId, input.actor.role)).facts.isActiveClanMember;
    }
    const decision = authorizeTaskTransfer({
      actor: { id: input.actor.userId, role: input.actor.role },
      task: { assigneeId: task.assigneeId, clanId: task.clanId, status: task.status },
      destination: { assigneeId: input.assigneeId, clanId: destination.clanId, assigneeIsActiveMember: true },
      actorIsActiveMemberOfTaskClan: actorIsClanMember,
    });
    if (!decision.allowed) return { ok: false, error: decision.reason };
    const now = new Date();
    await tx.update(schema.tasks).set({ assigneeId: input.assigneeId, clanId: destination.clanId, updatedAt: now }).where(and(eq(schema.tasks.orgId, input.actor.orgId), eq(schema.tasks.id, task.id)));
    await tx.insert(schema.taskTransfers).values({
      orgId: input.actor.orgId,
      taskId: task.id,
      actorId: input.actor.userId,
      fromAssigneeId: task.assigneeId,
      toAssigneeId: input.assigneeId,
      fromClanId: task.clanId,
      toClanId: destination.clanId,
      note: input.note ?? null,
    });
    await tx.insert(schema.mcpAuditEvents).values({
      orgId: input.actor.orgId,
      agentKeyId: input.actor.agentKeyId,
      actingUserId: input.actor.userId,
      tool: "transferir_missao",
      resourceType: "mission",
      resourceId: task.id,
      success: true,
      summary: `Responsável alterado; idempotency=${input.idempotencyKey}`,
    });
    return { ok: true, mission_id: task.id, status: task.status, updated_at: now.toISOString() };
  });
  return saveReceipt(input.actor, "transferir_missao", input.idempotencyKey, result);
}
