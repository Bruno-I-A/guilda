import { and, asc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, ListTodo, UserRoundX } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { initials } from "@/lib/people";
import { isOverdue } from "@/lib/task-ui";

import type { ClanMemberView } from "./page";
import {
  DistributionBoard,
  type BoardGroup,
  type BoardMember,
} from "./distribution-board";

/** Missão ainda em jogo — as que contam para carga e distribuição. */
const OPEN_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "rejected",
] as const;

/**
 * A Mesa do Líder: quem ainda não tem dono, quem está com o quê e quanto
 * cada integrante já carrega.
 */
export async function MissionsTab({
  orgId,
  clanId,
  memberships,
  canDistribute,
}: {
  orgId: string;
  clanId: string;
  memberships: readonly ClanMemberView[];
  canDistribute: boolean;
}) {
  const { openTasks, suggestedUsers } = await withOrgTx(orgId, async (tx) => {
    const tasks = await tx.query.tasks.findMany({
      where: and(
        eq(schema.tasks.orgId, orgId),
        eq(schema.tasks.clanId, clanId),
        inArray(schema.tasks.status, [...OPEN_STATUSES]),
      ),
      with: {
        client: { columns: { id: true, name: true } },
        assignee: { columns: { id: true, name: true } },
        informative: { columns: { id: true, createdAt: true } },
        suggestions: { columns: { userId: true, rawName: true } },
      },
      orderBy: [asc(schema.tasks.createdAt)],
    });

    // Nomes das sugestões reconhecidas, resolvidos numa consulta só.
    const suggestedIds = [
      ...new Set(
        tasks.flatMap((task) =>
          task.suggestions
            .map((suggestion) => suggestion.userId)
            .filter((userId): userId is string => Boolean(userId)),
        ),
      ),
    ];
    const users = suggestedIds.length
      ? await tx
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, suggestedIds))
      : [];

    return { openTasks: tasks, suggestedUsers: users };
  });

  const nameById = new Map(suggestedUsers.map((row) => [row.id, row.name]));
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
      overdueCount: own.filter((task) => isOverdue(task.dueDate, task.status))
        .length,
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
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-muted/45 p-2.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ListTodo className="size-3.5" aria-hidden /> Abertas
          </span>
          <strong className="mt-1 block font-mono text-lg">
            {openTasks.length}
          </strong>
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
        clanId={clanId}
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
    </div>
  );
}
