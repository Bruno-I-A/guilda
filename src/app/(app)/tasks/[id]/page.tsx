import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { ArrowLeft, CalendarClock, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { authorizeTransition, type OrgRole } from "@/domain/task-state";
import { initials } from "@/lib/people";
import { getActiveMember, requireOrgSession } from "@/lib/session";
import {
  DIFFICULTY_LABELS,
  eventLabel,
  formatDateTime,
  formatDueDate,
  isOverdue,
  PRIORITY_LABELS,
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
} from "@/lib/task-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { TaskActionBar } from "./task-action-bar";

export const metadata: Metadata = { title: "Tarefa" };

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) redirect("/onboarding");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const task = await withOrgTx(session.orgId, (tx) =>
    tx.query.tasks.findFirst({
      where: and(eq(schema.tasks.id, id), eq(schema.tasks.orgId, session.orgId)),
      with: {
        assignee: { columns: { id: true, name: true } },
        creator: { columns: { id: true, name: true } },
        events: {
          with: { actor: { columns: { name: true } } },
          orderBy: [asc(schema.taskEvents.createdAt)],
        },
      },
    }),
  );
  if (!task) notFound();

  // Contexto de autorização do VISITANTE (as actions revalidam tudo).
  let orgHasOtherApprover = false;
  if (task.creatorId === task.assigneeId) {
    const others = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, session.orgId),
          ne(schema.member.userId, session.user.id),
          inArray(schema.member.role, ["admin", "owner"]),
        ),
      )
      .limit(1);
    orgHasOtherApprover = others.length > 0;
  }

  const ctx = {
    actor: { id: session.user.id, role: member.role as OrgRole },
    task: {
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      status: task.status,
    },
    orgHasOtherApprover,
  };

  const isAdmin = member.role === "admin" || member.role === "owner";
  const can = {
    start: task.status === "pending" && authorizeTransition("in_progress", ctx).allowed,
    resume: task.status === "rejected" && authorizeTransition("in_progress", ctx).allowed,
    submit:
      task.status === "in_progress" &&
      authorizeTransition("awaiting_approval", ctx).allowed,
    approve:
      task.status === "awaiting_approval" &&
      authorizeTransition("completed", ctx).allowed,
    reject:
      task.status === "awaiting_approval" &&
      authorizeTransition("rejected", ctx).allowed,
    cancel:
      ["pending", "in_progress", "awaiting_approval", "rejected"].includes(task.status) &&
      authorizeTransition("cancelled", ctx).allowed,
    edit:
      ["pending", "in_progress", "rejected"].includes(task.status) &&
      (task.creatorId === session.user.id || isAdmin),
    revert:
      task.status === "completed" && authorizeTransition("in_progress", ctx).allowed,
  };

  const awaitingMyApproval = task.status === "awaiting_approval" && can.approve;
  const lastRejection = [...task.events]
    .reverse()
    .find((e) => e.toStatus === "rejected");
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div className="grid gap-5">
      <div>
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Tarefas
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="max-w-xl text-2xl font-semibold leading-tight">
            {task.title}
          </h1>
          <Badge className={STATUS_BADGE_CLASSES[task.status]}>
            {STATUS_LABELS[task.status]}
          </Badge>
        </div>
      </div>

      {awaitingMyApproval ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
          <p className="font-medium">Esta tarefa aguarda a sua aprovação.</p>
          <p>
            Ao aprovar, {task.assignee.name} recebe {task.xpValue} XP. Se algo
            precisa de ajuste, rejeite com uma nota explicando.
          </p>
        </div>
      ) : null}

      {task.status === "rejected" && lastRejection?.note ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium">Devolvida para ajustes</p>
          <p className="whitespace-pre-wrap">{lastRejection.note}</p>
        </div>
      ) : null}

      {task.status === "completed" && task.assigneeId === session.user.id ? (
        <div className="frame-carved flex items-center gap-3 rounded-lg bg-gold/10 p-4 text-sm">
          <Star className="size-5 shrink-0 text-gold" aria-hidden />
          <div>
            <p className="font-medium">Entrega aprovada — você ganhou {task.xpValue} XP! 🎉</p>
            <p>
              Confira seu progresso no{" "}
              <Link href="/profile" className="font-medium underline underline-offset-4">
                perfil
              </Link>{" "}
              e sua posição no{" "}
              <Link href="/leaderboard" className="font-medium underline underline-offset-4">
                ranking
              </Link>
              .
            </p>
          </div>
        </div>
      ) : null}

      <TaskActionBar
        task={{
          id: task.id,
          title: task.title,
          description: task.description ?? "",
          dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "",
          xpValue: task.xpValue,
          assigneeName: task.assignee.name,
        }}
        can={can}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid content-start gap-4">
          {task.description ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Descrição</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {task.description}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Linha do tempo</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0">
              {task.events.map((event, index) => (
                <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < task.events.length - 1 ? (
                    <span
                      aria-hidden
                      className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border"
                    />
                  ) : null}
                  <Avatar className="size-8 shrink-0">
                    <AvatarFallback className="text-[10px]">
                      {initials(event.actor.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 pt-1">
                    <p className="text-sm">
                      <span className="font-medium">{event.actor.name}</span>{" "}
                      {eventLabel(event.fromStatus, event.toStatus)}
                      {event.toStatus === "completed" ? (
                        <span className="ml-1.5 font-mono font-semibold text-gold">
                          +{task.xpValue} XP
                        </span>
                      ) : null}
                      {event.fromStatus === "completed" &&
                      event.toStatus === "in_progress" ? (
                        <span className="ml-1.5 font-semibold text-destructive">
                          −{task.xpValue} XP
                        </span>
                      ) : null}
                    </p>
                    {event.note ? (
                      <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/60 px-2.5 py-1.5 text-sm text-muted-foreground">
                        {event.note}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Detalhes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Recompensa</span>
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-gold">
                <Star className="size-4" aria-hidden /> {task.xpValue} XP
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Responsável</span>
              <span className="font-medium">{task.assignee.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Criada por</span>
              <span className="font-medium">{task.creator.name}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Prioridade</span>
              <span>{PRIORITY_LABELS[task.priority]}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Dificuldade</span>
              <span>{DIFFICULTY_LABELS[task.difficulty]}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Prazo</span>
              {task.dueDate ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    overdue && "font-medium text-destructive",
                  )}
                >
                  <CalendarClock className="size-4" aria-hidden />
                  {overdue ? "atrasada · " : ""}
                  {formatDueDate(task.dueDate)}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Criada em</span>
              <span>{formatDateTime(task.createdAt)}</span>
            </div>
            {task.completedAt ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Concluída em</span>
                <span>{formatDateTime(task.completedAt)}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
