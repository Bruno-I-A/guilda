import { and, asc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, ArrowLeft, Crown, ListTodo, UserRoundX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canDistributeClanTasks } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { initials } from "@/lib/people";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import { isOverdue } from "@/lib/task-ui";

import { DistributionBoard, type BoardGroup, type BoardMember } from "./distribution-board";

export const metadata: Metadata = { title: "Mesa do Líder" };

/** Missão ainda em jogo — as que contam para carga e distribuição. */
const OPEN_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "rejected",
] as const;

export default async function ClanDeskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const role = viewer.role as OrgRole;

  const data = await withOrgTx(session.orgId, async (tx) => {
    const [clan] = await tx
      .select()
      .from(schema.clans)
      .where(and(eq(schema.clans.orgId, session.orgId), eq(schema.clans.id, id)));
    if (!clan) return null;

    const memberships = await tx
      .select({
        userId: schema.clanMemberships.userId,
        name: schema.user.name,
        isLeader: schema.clanMemberships.isLeader,
      })
      .from(schema.clanMemberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.clanMemberships.userId))
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.userId, schema.clanMemberships.userId),
          eq(schema.member.organizationId, schema.clanMemberships.orgId),
        ),
      )
      .where(
        and(
          eq(schema.clanMemberships.orgId, session.orgId),
          eq(schema.clanMemberships.clanId, id),
          eq(schema.member.organizationId, session.orgId),
        ),
      )
      .orderBy(asc(schema.user.name));

    const openTasks = await tx.query.tasks.findMany({
      where: and(
        eq(schema.tasks.orgId, session.orgId),
        eq(schema.tasks.clanId, id),
        inArray(schema.tasks.status, [...OPEN_STATUSES]),
      ),
      with: {
        client: { columns: { id: true, name: true } },
        assignee: { columns: { id: true, name: true } },
        informative: { columns: { id: true, createdAt: true } },
        suggestions: {
          columns: { userId: true, rawName: true },
        },
      },
      orderBy: [asc(schema.tasks.createdAt)],
    });

    // Nomes das sugestões reconhecidas, resolvidos numa consulta só.
    const suggestedIds = [
      ...new Set(
        openTasks.flatMap((task) =>
          task.suggestions
            .map((suggestion) => suggestion.userId)
            .filter((userId): userId is string => Boolean(userId)),
        ),
      ),
    ];
    const suggestedUsers = suggestedIds.length
      ? await tx
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, suggestedIds))
      : [];

    return { clan, memberships, openTasks, suggestedUsers };
  });

  if (!data) notFound();
  const { clan, memberships, openTasks, suggestedUsers } = data;

  const leadsThisClan =
    clan.active && memberships.some((m) => m.userId === session.user.id && m.isLeader);
  const canDistribute = canDistributeClanTasks({ role, leadsThisClan });

  const nameById = new Map(suggestedUsers.map((u) => [u.id, u.name]));

  const orphans = openTasks.filter((task) => !task.assigneeId);
  const assigned = openTasks.filter((task) => task.assigneeId);

  // Carga por integrante: o que transforma distribuir em decisão informada.
  const members: BoardMember[] = memberships.map((membership) => {
    const own = assigned.filter((task) => task.assigneeId === membership.userId);
    return {
      userId: membership.userId,
      name: membership.name,
      isLeader: membership.isLeader,
      openCount: own.length,
      overdueCount: own.filter((task) => isOverdue(task.dueDate, task.status)).length,
    };
  });

  // Agrupamento da fila: um bloco por informativo, avulsas no fim.
  const groups = new Map<string, BoardGroup>();
  for (const task of orphans) {
    const key = task.informativeId ?? "avulsas";
    const group = groups.get(key) ?? {
      key,
      informativeId: task.informativeId,
      label: task.client?.name ?? "Missões avulsas",
      tasks: [],
    };
    group.tasks.push({
      id: task.id,
      title: task.title,
      clientName: task.client?.name ?? null,
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      xpValue: task.xpValue,
      suggestions: task.suggestions.map((suggestion) => ({
        userId: suggestion.userId,
        name: suggestion.userId
          ? (nameById.get(suggestion.userId) ?? suggestion.rawName)
          : suggestion.rawName,
        recognized: Boolean(suggestion.userId),
      })),
    });
    groups.set(key, group);
  }
  const boardGroups = [...groups.values()].sort((left, right) => {
    if (left.key === "avulsas") return 1;
    if (right.key === "avulsas") return -1;
    return left.label.localeCompare(right.label, "pt-BR");
  });

  const overdueCount = openTasks.filter((task) =>
    isOverdue(task.dueDate, task.status),
  ).length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Link
          href="/clans"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Clãs
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-wide">
            {clan.name}
          </h1>
          {!clan.active ? <Badge variant="outline">Inativo</Badge> : null}
        </div>
        <p className="text-muted-foreground">
          A Mesa do Líder: quem ainda não tem dono, quem está com o quê e quanto
          cada integrante já carrega.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ListTodo className="size-3.5" aria-hidden /> Abertas
          </span>
          <strong className="mt-1 block font-mono text-lg">{openTasks.length}</strong>
        </div>
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <UserRoundX className="size-3.5" aria-hidden /> Sem responsável
          </span>
          <strong className="mt-1 block font-mono text-lg">{orphans.length}</strong>
        </div>
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5" aria-hidden /> Atrasadas
          </span>
          <strong className="mt-1 block font-mono text-lg">{overdueCount}</strong>
        </div>
      </div>

      <DistributionBoard
        clanId={clan.id}
        canDistribute={canDistribute}
        groups={boardGroups}
        members={members}
      />

      <section className="grid gap-3">
        <h2 className="hud-label">Em andamento</h2>
        {assigned.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhuma missão do clã em andamento.
          </p>
        ) : (
          <ul className="grid gap-2">
            {assigned.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card/50 p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="truncate font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                  {task.client ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {task.client.name}
                    </p>
                  ) : null}
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-sm">
                  <Avatar className="size-6">
                    <AvatarFallback className="text-[9px]">
                      {initials(task.assignee?.name ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline">{task.assignee?.name}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="hud-label">Carga do clã</h2>
        <ul className="grid gap-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card/50 p-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-[10px]">
                    {initials(member.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{member.name}</span>
                {member.isLeader ? (
                  <Crown className="size-3.5 shrink-0 text-primary" aria-hidden />
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-3 font-mono text-sm">
                <span title="Missões abertas">{member.openCount}</span>
                {member.overdueCount > 0 ? (
                  <span className="text-destructive" title="Atrasadas">
                    {member.overdueCount} atrasadas
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
