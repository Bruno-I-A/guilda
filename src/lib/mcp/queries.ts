import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, notInArray, or, type SQL } from "drizzle-orm";

import { withOrgTx, type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { isAdminRole } from "@/domain/guild-permissions";
import { authorizeTransition, type TaskStatus } from "@/domain/task-state";
import { mcpMissionTransitionTargets } from "@/domain/mcp-access";
import { isTaskManagedByCompanyFlow } from "@/lib/company-flows/managed-task";

import type { McpActor } from "./access";

export type MissionScope = "minhas" | "criadas_por_mim" | "fila_do_cla" | "todas_permitidas";

async function actorClanIds(tx: OrgTx, actor: McpActor): Promise<string[]> {
  if (isAdminRole(actor.role)) {
    const rows = await tx
      .select({ id: schema.clans.id })
      .from(schema.clans)
      .where(and(eq(schema.clans.orgId, actor.orgId), eq(schema.clans.active, true)));
    return rows.map((row) => row.id);
  }
  const rows = await tx
    .select({ id: schema.clanMemberships.clanId })
    .from(schema.clanMemberships)
    .innerJoin(
      schema.clans,
      and(
        eq(schema.clans.orgId, schema.clanMemberships.orgId),
        eq(schema.clans.id, schema.clanMemberships.clanId),
      ),
    )
    .where(
      and(
        eq(schema.clanMemberships.orgId, actor.orgId),
        eq(schema.clanMemberships.userId, actor.userId),
        eq(schema.clans.orgId, actor.orgId),
        eq(schema.clans.active, true),
      ),
    );
  return rows.map((row) => row.id);
}

function visibleTaskCondition(actor: McpActor, clanIds: string[]): SQL | undefined {
  if (isAdminRole(actor.role)) return undefined;
  const own = or(
    eq(schema.tasks.assigneeId, actor.userId),
    eq(schema.tasks.creatorId, actor.userId),
  );
  return clanIds.length > 0
    ? or(own, inArray(schema.tasks.clanId, clanIds))
    : own;
}

async function namesById(tx: OrgTx, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function guildContext(actor: McpActor) {
  return withOrgTx(actor.orgId, async (tx) => {
    const clanIds = await actorClanIds(tx, actor);
    const clans = clanIds.length === 0
      ? []
      : await tx
          .select({ id: schema.clans.id, name: schema.clans.name, slug: schema.clans.slug })
          .from(schema.clans)
          .where(and(eq(schema.clans.orgId, actor.orgId), inArray(schema.clans.id, clanIds)))
          .orderBy(asc(schema.clans.name));
    return {
      organization: { id: actor.orgId, name: actor.organizationName },
      represented_member: { id: actor.userId, name: actor.userName, role: actor.role },
      agent: { id: actor.agentKeyId, name: actor.agentName, scopes: actor.scopes },
      visible_clans: clans,
      hierarchy:
        actor.role === "owner"
          ? "nível máximo da organização"
          : actor.role === "admin"
            ? "administração, abaixo do owner"
            : "membro, limitado aos próprios vínculos e missões",
    };
  });
}

export async function missionSummary(actor: McpActor) {
  return withOrgTx(actor.orgId, async (tx) => {
    const clanIds = await actorClanIds(tx, actor);
    const visibility = visibleTaskCondition(actor, clanIds);
    const base = and(eq(schema.tasks.orgId, actor.orgId), visibility);
    const [byStatus, overdue, unassigned, mine] = await Promise.all([
      tx
        .select({ status: schema.tasks.status, total: count() })
        .from(schema.tasks)
        .where(base)
        .groupBy(schema.tasks.status),
      tx
        .select({ total: count() })
        .from(schema.tasks)
        .where(and(base, lt(schema.tasks.dueDate, new Date()), notInArray(schema.tasks.status, ["completed", "cancelled"]))),
      tx
        .select({ total: count() })
        .from(schema.tasks)
        .where(and(base, isNull(schema.tasks.assigneeId), notInArray(schema.tasks.status, ["completed", "cancelled"]))),
      tx
        .select({ total: count() })
        .from(schema.tasks)
        .where(and(base, eq(schema.tasks.assigneeId, actor.userId), notInArray(schema.tasks.status, ["completed", "cancelled"]))),
    ]);
    return {
      by_status: Object.fromEntries(byStatus.map((row) => [row.status, row.total])),
      overdue_open: overdue[0]?.total ?? 0,
      unassigned_open: unassigned[0]?.total ?? 0,
      assigned_to_me_open: mine[0]?.total ?? 0,
    };
  });
}

export async function listMissions(
  actor: McpActor,
  input: {
    scope: MissionScope;
    statuses?: TaskStatus[];
    clanId?: string;
    clientId?: string;
    assigneeId?: string;
    search?: string;
    limit: number;
    offset: number;
  },
) {
  return withOrgTx(actor.orgId, async (tx) => {
    const clanIds = await actorClanIds(tx, actor);
    if (input.clanId && !clanIds.includes(input.clanId)) return [];
    const conditions: Array<SQL | undefined> = [
      eq(schema.tasks.orgId, actor.orgId),
      visibleTaskCondition(actor, clanIds),
    ];
    if (input.scope === "minhas") conditions.push(eq(schema.tasks.assigneeId, actor.userId));
    if (input.scope === "criadas_por_mim") conditions.push(eq(schema.tasks.creatorId, actor.userId));
    if (input.scope === "fila_do_cla") {
      conditions.push(clanIds.length > 0 ? inArray(schema.tasks.clanId, clanIds) : eq(schema.tasks.id, "00000000-0000-0000-0000-000000000000"));
    }
    if (input.statuses?.length) conditions.push(inArray(schema.tasks.status, input.statuses));
    if (input.clanId) conditions.push(eq(schema.tasks.clanId, input.clanId));
    if (input.clientId) conditions.push(eq(schema.tasks.clientId, input.clientId));
    if (input.assigneeId) conditions.push(eq(schema.tasks.assigneeId, input.assigneeId));
    if (input.search) conditions.push(ilike(schema.tasks.title, `%${input.search}%`));

    const rows = await tx
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        status: schema.tasks.status,
        creatorId: schema.tasks.creatorId,
        assigneeId: schema.tasks.assigneeId,
        clanId: schema.tasks.clanId,
        clientId: schema.tasks.clientId,
        priority: schema.tasks.priority,
        difficulty: schema.tasks.difficulty,
        xpValue: schema.tasks.xpValue,
        dueDate: schema.tasks.dueDate,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(and(...conditions))
      .orderBy(asc(schema.tasks.dueDate), desc(schema.tasks.updatedAt))
      .limit(input.limit)
      .offset(input.offset);

    const [people, clans, clients] = await Promise.all([
      namesById(tx, rows.flatMap((row) => [row.creatorId, row.assigneeId ?? ""])),
      rows.some((row) => row.clanId)
        ? tx.select({ id: schema.clans.id, name: schema.clans.name }).from(schema.clans).where(and(eq(schema.clans.orgId, actor.orgId), inArray(schema.clans.id, rows.flatMap((row) => row.clanId ? [row.clanId] : []))))
        : Promise.resolve([]),
      rows.some((row) => row.clientId)
        ? tx.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(and(eq(schema.clients.orgId, actor.orgId), inArray(schema.clients.id, rows.flatMap((row) => row.clientId ? [row.clientId] : []))))
        : Promise.resolve([]),
    ]);
    const clanNames = new Map(clans.map((row) => [row.id, row.name]));
    const clientNames = new Map(clients.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      creator: { id: row.creatorId, name: people.get(row.creatorId) ?? null },
      assignee: row.assigneeId ? { id: row.assigneeId, name: people.get(row.assigneeId) ?? null } : null,
      clan: row.clanId ? { id: row.clanId, name: clanNames.get(row.clanId) ?? null } : null,
      client: row.clientId ? { id: row.clientId, name: clientNames.get(row.clientId) ?? null } : null,
      priority: row.priority,
      difficulty: row.difficulty,
      xp: row.xpValue,
      due_at: row.dueDate?.toISOString() ?? null,
      updated_at: row.updatedAt.toISOString(),
    }));
  });
}

export async function missionDetails(actor: McpActor, taskId: string) {
  return withOrgTx(actor.orgId, async (tx) => {
    const clanIds = await actorClanIds(tx, actor);
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.orgId, actor.orgId),
          eq(schema.tasks.id, taskId),
          visibleTaskCondition(actor, clanIds),
        ),
      )
      .limit(1);
    if (!task) return null;
    const [events, transfers] = await Promise.all([
      tx.select().from(schema.taskEvents).where(and(eq(schema.taskEvents.orgId, actor.orgId), eq(schema.taskEvents.taskId, task.id))).orderBy(asc(schema.taskEvents.createdAt)),
      tx.select().from(schema.taskTransfers).where(and(eq(schema.taskTransfers.orgId, actor.orgId), eq(schema.taskTransfers.taskId, task.id))).orderBy(asc(schema.taskTransfers.createdAt)),
    ]);
    const people = await namesById(tx, [
      task.creatorId,
      task.assigneeId ?? "",
      ...events.map((event) => event.actorId),
      ...transfers.flatMap((item) => [item.actorId, item.fromAssigneeId ?? "", item.toAssigneeId ?? ""]),
    ]);
    const lastCompletion = [...events].reverse().find((event) => event.toStatus === "completed");
    const transitionContext = {
      actor: { id: actor.userId, role: actor.role },
      task: {
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        status: task.status,
        completedAt: task.completedAt,
        completedBy: lastCompletion?.actorId ?? null,
        fromInformative: task.informativeId !== null,
        // `allowed_transitions` é contrato com o agente: anunciar "concluir"
        // numa missão do Fluxo seria mandá-lo contornar o Fluxo.
        managedByCompanyFlow: await isTaskManagedByCompanyFlow(
          tx,
          actor.orgId,
          task.id,
        ),
      },
    };
    const possible = mcpMissionTransitionTargets(task.status);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      creator: { id: task.creatorId, name: people.get(task.creatorId) ?? null },
      assignee: task.assigneeId ? { id: task.assigneeId, name: people.get(task.assigneeId) ?? null } : null,
      clan_id: task.clanId,
      client_id: task.clientId,
      priority: task.priority,
      difficulty: task.difficulty,
      xp: task.xpValue,
      due_at: task.dueDate?.toISOString() ?? null,
      updated_at: task.updatedAt.toISOString(),
      allowed_transitions: possible.filter((status) => authorizeTransition(status, transitionContext).allowed),
      timeline: events.map((event) => ({
        from: event.fromStatus,
        to: event.toStatus,
        note: event.note,
        actor: { id: event.actorId, name: people.get(event.actorId) ?? null },
        at: event.createdAt.toISOString(),
      })),
      transfers: transfers.map((item) => ({
        from_user_id: item.fromAssigneeId,
        to_user_id: item.toAssigneeId,
        from_clan_id: item.fromClanId,
        to_clan_id: item.toClanId,
        note: item.note,
        actor: { id: item.actorId, name: people.get(item.actorId) ?? null },
        at: item.createdAt.toISOString(),
      })),
    };
  });
}

export async function listVisibleClans(actor: McpActor) {
  return withOrgTx(actor.orgId, async (tx) => {
    const ids = await actorClanIds(tx, actor);
    if (ids.length === 0) return [];
    return tx
      .select({ id: schema.clans.id, name: schema.clans.name, slug: schema.clans.slug })
      .from(schema.clans)
      .where(and(eq(schema.clans.orgId, actor.orgId), inArray(schema.clans.id, ids)))
      .orderBy(asc(schema.clans.name));
  });
}

export async function searchClients(actor: McpActor, search: string, limit: number) {
  return withOrgTx(actor.orgId, (tx) =>
    tx
      .select({ id: schema.clients.id, name: schema.clients.name, cnpj: schema.clients.cnpj, active: schema.clients.active })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, actor.orgId), or(ilike(schema.clients.name, `%${search}%`), ilike(schema.clients.cnpj, `%${search.replace(/\D/g, "")}%`))))
      .orderBy(asc(schema.clients.name))
      .limit(limit),
  );
}

export async function listAssignableMembers(actor: McpActor, clanId?: string) {
  return withOrgTx(actor.orgId, async (tx) => {
    const visibleClanIds = await actorClanIds(tx, actor);
    if (clanId && !visibleClanIds.includes(clanId)) return [];
    const clanFilter = clanId ? [clanId] : visibleClanIds;
    if (clanFilter.length === 0) return [];
    const rows = await tx
      .select({ userId: schema.member.userId, name: schema.user.name, role: schema.member.role, clanId: schema.clanMemberships.clanId, clanName: schema.clans.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .innerJoin(schema.clanMemberships, and(eq(schema.clanMemberships.orgId, schema.member.organizationId), eq(schema.clanMemberships.userId, schema.member.userId)))
      .innerJoin(schema.clans, and(eq(schema.clans.orgId, schema.clanMemberships.orgId), eq(schema.clans.id, schema.clanMemberships.clanId)))
      .where(and(eq(schema.member.organizationId, actor.orgId), eq(schema.clans.active, true), inArray(schema.clans.id, clanFilter)))
      .orderBy(asc(schema.user.name), asc(schema.clans.name));
    return rows;
  });
}
