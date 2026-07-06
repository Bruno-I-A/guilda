import { and, desc, eq, lt, lte, notInArray, type SQL } from "drizzle-orm";
import { CalendarClock, ListTodo, Plus, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pips } from "@/components/pips";
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
} from "@/lib/task-ui";
import { cn } from "@/lib/utils";

import { TaskFilters } from "./task-filters";

export const metadata: Metadata = { title: "Missões" };

const TABS = [
  { key: "mine", label: "Minhas" },
  { key: "created", label: "Criadas por mim" },
  { key: "all", label: "Todas" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function parseTab(value: string | undefined): TabKey {
  return TABS.some((t) => t.key === value) ? (value as TabKey) : "mine";
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
  searchParams: Promise<{ tab?: string; status?: string; due?: string }>;
}) {
  const session = await requireOrgSession();
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const status = parseStatus(params.status);
  const due = parseDue(params.due);

  const conditions: SQL[] = [eq(schema.tasks.orgId, session.orgId)];
  if (tab === "mine") {
    conditions.push(eq(schema.tasks.assigneeId, session.user.id));
  } else if (tab === "created") {
    conditions.push(eq(schema.tasks.creatorId, session.user.id));
  }
  if (status !== "all") {
    conditions.push(eq(schema.tasks.status, status));
  }
  if (due === "overdue") {
    conditions.push(
      lt(schema.tasks.dueDate, new Date()),
      notInArray(schema.tasks.status, ["completed", "cancelled"]),
    );
  } else if (due === "week") {
    const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    conditions.push(
      lte(schema.tasks.dueDate, inSevenDays),
      notInArray(schema.tasks.status, ["completed", "cancelled"]),
    );
  }

  const taskList = await withOrgTx(session.orgId, (tx) =>
    tx.query.tasks.findMany({
      where: and(...conditions),
      with: {
        assignee: { columns: { name: true } },
        creator: { columns: { name: true } },
      },
      orderBy: [desc(schema.tasks.createdAt)],
      limit: 200,
    }),
  );

  function tabHref(key: TabKey): string {
    const qs = new URLSearchParams();
    if (key !== "mine") qs.set("tab", key);
    if (status !== "all") qs.set("status", status);
    if (due !== "all") qs.set("due", due);
    const suffix = qs.toString();
    return suffix ? `/tasks?${suffix}` : "/tasks";
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-wide">Missões</h1>
        <Button asChild>
          <Link href="/tasks/new">
            <Plus aria-hidden /> Nova missão
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Filtrar por relação"
          className="flex rounded-lg border bg-muted/40 p-0.5"
        >
          {TABS.map(({ key, label }) => (
            <Link
              key={key}
              href={tabHref(key)}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <TaskFilters status={status} due={due} />
      </div>

      {taskList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <ListTodo className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Nenhuma missão por aqui</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {tab === "mine"
              ? "Você não tem missões com estes filtros. Crie uma ou ajuste os filtros."
              : "Nada encontrado com estes filtros."}
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
                  href={`/tasks/${task.id}`}
                  className={cn(
                    "panel-cut panel-cut-sm flex flex-col gap-1.5 border-l-2 px-4 py-3 transition-colors hover:bg-accent/40",
                    overdue
                      ? "border-l-destructive"
                      : STATUS_RAIL_CLASSES[task.status],
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
                    <span>
                      {tab === "mine"
                        ? `criada por ${task.creator.name}`
                        : `responsável: ${task.assignee.name}`}
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
