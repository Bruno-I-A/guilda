import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { ListTodo, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MissionRow } from "@/components/mission-row";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { TASK_STATUSES, type TaskStatus } from "@/domain/task-state";
import { requireOrgSession } from "@/lib/session";
import { upcomingWeekBounds } from "@/lib/task-ui";

import { TaskFilters, type TaskScope } from "./task-filters";

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

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string | string[];
    clan?: string | string[];
    person?: string | string[];
    status?: string | string[];
    due?: string | string[];
  }>;
}) {
  const session = await requireOrgSession();
  const params = await searchParams;
  const scope = parseScope(single(params.scope));
  const status = parseStatus(single(params.status));
  const due = parseDue(single(params.due));

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
      <PageHeader
        title="Missões"
        description="Acompanhe o trabalho individual, dos seus clãs ou de toda a Guilda."
        action={
          <Button asChild>
            <Link href="/tasks/new">
              <Plus aria-hidden /> Nova missão
            </Link>
          </Button>
        }
      />

      <TaskFilters
        scope={scope}
        status={status}
        due={due}
        clans={clans}
        members={members}
        clanId={clanId}
        personId={personId}
      />

      {taskList.length === 0 ? (
        <div className="panel-cut flex flex-col items-center gap-3 p-12 text-center">
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
          {taskList.map((task) => (
            <li key={task.id}>
              {/* A lista completa: é a tela de triagem, então abre os dois
                  grupos de metadado (estado e atribuição). */}
              <MissionRow
                task={{
                  ...task,
                  clanName: task.clan?.name ?? null,
                  assigneeName: task.assignee?.name ?? null,
                }}
                variant="full"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
