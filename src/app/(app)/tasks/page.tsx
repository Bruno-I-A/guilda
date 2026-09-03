import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { CalendarClock, ListTodo, Plus, Star, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pips } from "@/components/pips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { TASK_STATUSES, type TaskStatus } from "@/domain/task-state";
import { requireOrgSession } from "@/lib/session";
import {
  formatDueDate,
  isOverdue,
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
  STATUS_RAIL_CLASSES,
  upcomingWeekBounds,
} from "@/lib/task-ui";
import { cn } from "@/lib/utils";

import { TaskFilters, type TaskOrigin, type TaskScope } from "./task-filters";

export const metadata: Metadata = { title: "Missões" };

const SCOPES = ["mine", "my_clans", "clan", "person", "created", "all"] as const;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseScope(value: string | undefined): TaskScope {
  return SCOPES.includes(value as TaskScope) ? (value as TaskScope) : "mine";
}

function parseStatus(value: string | undefined): TaskStatus | "all" {
  return TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : "all";
}

function parseDue(value: string | undefined): "all" | "overdue" | "week" {
  return value === "overdue" || value === "week" ? value : "all";
}

function parseOrigin(value: string | undefined): TaskOrigin {
  return value === "standalone" || value === "informative" ? value : "all";
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string | string[];
    clan?: string | string[];
    person?: string | string[];
    status?: string | string[];
    due?: string | string[];
    origin?: string | string[];
  }>;
}) {
  const session = await requireOrgSession();
  const params = await searchParams;
  const scope = parseScope(single(params.scope));
  const status = parseStatus(single(params.status));
  const due = parseDue(single(params.due));
  const origin = parseOrigin(single(params.origin));

  const { clans, members, myClanIds } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const [clanRows, memberRows, myMemberships] = await Promise.all([
        tx
          .select({ id: schema.clans.id, name: schema.clans.name })
          .from(schema.clans)
          .where(and(eq(schema.clans.orgId, session.orgId), eq(schema.clans.active, true)))
          .orderBy(asc(schema.clans.name)),
        tx
          .select({ userId: schema.member.userId, name: schema.user.name })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, session.orgId))
          .orderBy(asc(schema.user.name)),
        tx
          .select({ clanId: schema.clanMemberships.clanId })
          .from(schema.clanMemberships)
          .innerJoin(
            schema.clans,
            and(
              eq(schema.clans.id, schema.clanMemberships.clanId),
              eq(schema.clans.orgId, schema.clanMemberships.orgId),
            ),
          )
          .where(
            and(
              eq(schema.clanMemberships.orgId, session.orgId),
              eq(schema.clanMemberships.userId, session.user.id),
              eq(schema.clans.orgId, session.orgId),
              eq(schema.clans.active, true),
            ),
          ),
      ]);
      return {
        clans: clanRows,
        members: memberRows,
        myClanIds: myMemberships.map((membership) => membership.clanId),
      };
    },
  );

  const requestedClanId = single(params.clan);
  const clanId = clans.some((clan) => clan.id === requestedClanId)
    ? requestedClanId
    : undefined;
  const requestedPersonId = single(params.person);
  const personId = members.some((member) => member.userId === requestedPersonId)
    ? requestedPersonId
    : undefined;
  const filters = new URLSearchParams();
  if (scope !== "mine") filters.set("scope", scope);
  if (scope === "clan" && clanId) filters.set("clan", clanId);
  if (scope === "person" && personId) filters.set("person", personId);
  if (status !== "all") filters.set("status", status);
  if (due !== "all") filters.set("due", due);
  if (origin !== "all") filters.set("origin", origin);
  const filteredTasksHref = filters.size > 0 ? `/tasks?${filters}` : "/tasks";

  const conditions: SQL[] = [eq(schema.tasks.orgId, session.orgId)];
  if (scope === "mine") {
    conditions.push(eq(schema.tasks.assigneeId, session.user.id));
  } else if (scope === "my_clans") {
    conditions.push(
      myClanIds.length > 0
        ? inArray(schema.tasks.clanId, myClanIds)
        : sql<boolean>`false`,
    );
  } else if (scope === "clan") {
    conditions.push(clanId ? eq(schema.tasks.clanId, clanId) : sql<boolean>`false`);
  } else if (scope === "person") {
    conditions.push(
      personId ? eq(schema.tasks.assigneeId, personId) : sql<boolean>`false`,
    );
  } else if (scope === "created") {
    conditions.push(eq(schema.tasks.creatorId, session.user.id));
  }
  if (status !== "all") conditions.push(eq(schema.tasks.status, status));
  // informativeId preenchido = missão que veio de um pacote de Informativo.
  if (origin === "standalone") {
    conditions.push(isNull(schema.tasks.informativeId));
  } else if (origin === "informative") {
    conditions.push(isNotNull(schema.tasks.informativeId));
  }
  if (due === "overdue") {
    conditions.push(
      lt(schema.tasks.dueDate, new Date()),
      notInArray(schema.tasks.status, ["completed", "cancelled"]),
    );
  } else if (due === "week") {
    const week = upcomingWeekBounds();
    conditions.push(
      gte(schema.tasks.dueDate, week.from),
      lte(schema.tasks.dueDate, week.to),
      notInArray(schema.tasks.status, ["completed", "cancelled"]),
    );
  }

  const taskList = await withOrgTx(session.orgId, (tx) =>
    tx.query.tasks.findMany({
      where: and(...conditions),
      with: {
        assignee: { columns: { name: true } },
        creator: { columns: { name: true } },
        clan: { columns: { name: true } },
      },
      orderBy: [desc(schema.tasks.createdAt)],
      limit: 200,
    }),
  );

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-wide">Missões</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe o trabalho individual, dos seus clãs ou de toda a Guilda.
          </p>
        </div>
        <Button asChild>
          <Link href="/tasks/new">
            <Plus aria-hidden /> Nova missão
          </Link>
        </Button>
      </div>

      <TaskFilters
        origin={origin}
        scope={scope}
        status={status}
        due={due}
        clans={clans}
        members={members}
        clanId={clanId}
        personId={personId}
      />

      {taskList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <ListTodo className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Nenhuma missão por aqui</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Não há missões com esta combinação de escopo, status e prazo.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/tasks/new">
              <Plus aria-hidden /> Criar missão
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-1.5">
          {taskList.map((task) => {
            const overdue = isOverdue(task.dueDate, task.status);
            return (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}?returnTo=${encodeURIComponent(filteredTasksHref)}`}
                  className={cn(
                    "panel-cut panel-cut-sm flex flex-col gap-1.5 border-l-2 px-4 py-3 transition-colors hover:bg-accent/40",
                    overdue ? "border-l-destructive" : STATUS_RAIL_CLASSES[task.status],
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate font-medium leading-snug">
                      {task.title}
                    </p>
                    <span className="chip-loot shrink-0">
                      <Star className="size-3" aria-hidden /> {task.xpValue} XP
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <Badge className={cn("h-4 px-1.5", STATUS_BADGE_CLASSES[task.status])}>
                      {STATUS_LABELS[task.status]}
                    </Badge>
                    <Pips value={task.priority} max={3} label="Prioridade" />
                    <Pips value={task.difficulty} max={5} label="Dificuldade" />
                    <span className="inline-flex items-center gap-1">
                      <UsersRound className="size-3.5" aria-hidden />
                      {task.clan?.name ?? "Sem clã"}
                    </span>
                    <span>
                      responsável: {task.assignee?.name ?? "Sem responsável"}
                    </span>
                    {task.dueDate ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          overdue && "font-medium text-destructive",
                        )}
                      >
                        <CalendarClock className="size-3.5" aria-hidden />
                        {overdue ? "atrasada · " : ""}
                        {formatDueDate(task.dueDate)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
