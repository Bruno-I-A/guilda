import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, ArrowRightLeft, CalendarClock, Star, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { isTransferableTaskStatus } from "@/domain/clans";
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
import { cn } from "@/lib/utils";

import { TaskActionBar } from "./task-action-bar";

export const metadata: Metadata = { title: "Missão" };

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

  const { task, viewerClanMembership, candidateMemberships } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const taskRow = await tx.query.tasks.findFirst({
        where: and(eq(schema.tasks.id, id), eq(schema.tasks.orgId, session.orgId)),
        with: {
          assignee: { columns: { id: true, name: true } },
          creator: { columns: { id: true, name: true } },
          clan: { columns: { id: true, name: true, active: true } },
          events: {
            with: { actor: { columns: { name: true } } },
            orderBy: [asc(schema.taskEvents.createdAt)],
          },
          transfers: {
            with: {
              actor: { columns: { name: true } },
              fromAssignee: { columns: { name: true } },
              toAssignee: { columns: { name: true } },
              fromClan: { columns: { name: true } },
              toClan: { columns: { name: true } },
            },
            orderBy: [asc(schema.taskTransfers.createdAt)],
          },
        },
      });

      if (!taskRow) {
        return { task: null, viewerClanMembership: null, candidateMemberships: [] };
      }

      const [viewerMembership, candidates] = await Promise.all([
        taskRow.clanId
          ? tx.query.clanMemberships.findFirst({
              where: and(
                eq(schema.clanMemberships.orgId, session.orgId),
                eq(schema.clanMemberships.clanId, taskRow.clanId),
                eq(schema.clanMemberships.userId, session.user.id),
              ),
              columns: { isLeader: true },
            })
          : Promise.resolve(undefined),
        tx
          .select({
            userId: schema.clanMemberships.userId,
            name: schema.user.name,
            clanId: schema.clanMemberships.clanId,
            clanName: schema.clans.name,
            isPrimary: schema.clanMemberships.isPrimary,
          })
          .from(schema.clanMemberships)
          .innerJoin(
            schema.clans,
            and(
              eq(schema.clans.id, schema.clanMemberships.clanId),
              eq(schema.clans.orgId, schema.clanMemberships.orgId),
            ),
          )
          .innerJoin(
            schema.member,
            and(
              eq(schema.member.userId, schema.clanMemberships.userId),
              eq(schema.member.organizationId, schema.clanMemberships.orgId),
            ),
          )
          .innerJoin(schema.user, eq(schema.user.id, schema.clanMemberships.userId))
          .where(
            and(
              eq(schema.clanMemberships.orgId, session.orgId),
              eq(schema.clans.orgId, session.orgId),
              eq(schema.clans.active, true),
              eq(schema.member.organizationId, session.orgId),
            ),
          )
          .orderBy(asc(schema.user.name), asc(schema.clans.name)),
      ]);

      return {
        task: taskRow,
        viewerClanMembership: viewerMembership ?? null,
        candidateMemberships: candidates,
      };
    },
  );
  if (!task) notFound();

  const context = {
    actor: { id: session.user.id, role: member.role as OrgRole },
    task: {
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      status: task.status,
    },
  };
  const isAdmin = member.role === "admin" || member.role === "owner";
  const viewerIsLeader = Boolean(viewerClanMembership?.isLeader);
  const can = {
    claim:
      task.status === "pending" &&
      !task.assigneeId &&
      Boolean(task.clanId) &&
      Boolean(task.clan?.active) &&
      Boolean(viewerClanMembership),
    start:
      task.status === "pending" &&
      authorizeTransition("in_progress", context).allowed,
    resume:
      task.status === "rejected" &&
      authorizeTransition("in_progress", context).allowed,
    complete:
      task.status === "in_progress" &&
      authorizeTransition("completed", context).allowed,
    approve:
      task.status === "awaiting_approval" &&
      authorizeTransition("completed", context).allowed,
    reject:
      task.status === "awaiting_approval" &&
      authorizeTransition("rejected", context).allowed,
    cancel:
      ["pending", "in_progress", "awaiting_approval", "rejected"].includes(task.status) &&
      authorizeTransition("cancelled", context).allowed,
    edit:
      ["pending", "in_progress", "rejected"].includes(task.status) &&
      (task.creatorId === session.user.id || isAdmin),
    revert:
      task.status === "completed" &&
      authorizeTransition("in_progress", context).allowed,
    transfer:
      isTransferableTaskStatus(task.status) &&
      (isAdmin || viewerIsLeader || task.assigneeId === session.user.id),
  };

  const membershipsByUser = new Map<
    string,
    (typeof candidateMemberships)[number][]
  >();
  for (const candidate of candidateMemberships) {
    const current = membershipsByUser.get(candidate.userId) ?? [];
    current.push(candidate);
    membershipsByUser.set(candidate.userId, current);
  }

  const transferCandidates = isAdmin
    ? [...membershipsByUser.values()]
        .map((memberships) => {
          const primary = memberships.filter((membership) => membership.isPrimary);
          const resolved = primary.length === 1
            ? primary[0]
            : memberships.length === 1
              ? memberships[0]
              : null;
          return resolved
            ? {
                userId: resolved.userId,
                name: resolved.name,
                clanName: resolved.clanName,
              }
            : null;
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .filter((candidate) => candidate.userId !== task.assigneeId)
    : candidateMemberships
        .filter(
          (candidate) =>
            candidate.clanId === task.clanId && candidate.userId !== task.assigneeId,
        )
        .filter(
          (candidate, index, candidates) =>
            candidates.findIndex((item) => item.userId === candidate.userId) === index,
        )
        .map((candidate) => ({
          userId: candidate.userId,
          name: candidate.name,
          clanName: candidate.clanName,
        }));

  const awaitingMyApproval = task.status === "awaiting_approval" && can.approve;
  const lastRejection = [...task.events]
    .reverse()
    .find((event) => event.toStatus === "rejected");
  const overdue = isOverdue(task.dueDate, task.status);
  const timeline = [
    ...task.events.map((event) => ({ kind: "event" as const, date: event.createdAt, event })),
    ...task.transfers.map((transfer) => ({
      kind: "transfer" as const,
      date: transfer.createdAt,
      transfer,
    })),
  ].sort((left, right) => left.date.getTime() - right.date.getTime());

  return (
    <div className="grid gap-5">
      <div>
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Missões
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="max-w-xl font-sans text-2xl font-semibold leading-tight tracking-tight">
            {task.title}
          </h1>
          <Badge className={STATUS_BADGE_CLASSES[task.status]}>
            {STATUS_LABELS[task.status]}
          </Badge>
        </div>
      </div>

      {awaitingMyApproval ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
          <p className="font-medium">Esta missão ainda usa o fluxo legado de aprovação.</p>
          <p>
            Ao aprovar, {task.assignee?.name ?? "a pessoa responsável"} recebe {task.xpValue} XP.
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
        <div className="panel-cut panel-cut-sm flex items-center gap-3 bg-gold/10 p-4 text-sm shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--gold)_35%,transparent)]">
          <Star className="size-5 shrink-0 text-gold" aria-hidden />
          <div>
            <p className="font-medium">Missão concluída — você ganhou {task.xpValue} XP! 🎉</p>
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
          assigneeName: task.assignee?.name ?? null,
          clanId: task.clanId,
          clanName: task.clan?.name ?? null,
        }}
        can={can}
        transferCandidates={transferCandidates}
        restrictTransferToTaskClan={!isAdmin}
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
              {timeline.map((item, index) => {
                if (item.kind === "event") {
                  const event = item.event;
                  return (
                    <div key={`event-${event.id}`} className="relative flex gap-3 pb-5 last:pb-0">
                      {index < timeline.length - 1 ? (
                        <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border" />
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
                          {event.fromStatus === "completed" && event.toStatus === "in_progress" ? (
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
                  );
                }

                const transfer = item.transfer;
                const wasClaim = !transfer.fromAssigneeId && transfer.toAssigneeId === transfer.actorId;
                return (
                  <div key={`transfer-${transfer.id}`} className="relative flex gap-3 pb-5 last:pb-0">
                    {index < timeline.length - 1 ? (
                      <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border" />
                    ) : null}
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="text-[10px]">
                        {initials(transfer.actor.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 pt-1">
                      <p className="text-sm">
                        <span className="font-medium">{transfer.actor.name}</span>{" "}
                        {wasClaim ? (
                          <>assumiu a missão pelo clã {transfer.toClan.name}</>
                        ) : (
                          <>
                            transferiu a missão de{" "}
                            <span className="font-medium">
                              {transfer.fromAssignee?.name ?? "Sem responsável"}
                            </span>{" "}
                            para{" "}
                            <span className="font-medium">
                              {transfer.toAssignee?.name ?? "Sem responsável"}
                            </span>
                            {transfer.fromClan?.name !== transfer.toClan.name ? (
                              <span className="text-muted-foreground">
                                {` (${transfer.fromClan?.name ?? "Sem clã"} → ${transfer.toClan.name})`}
                              </span>
                            ) : null}
                          </>
                        )}
                      </p>
                      {transfer.note ? (
                        <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/60 px-2.5 py-1.5 text-sm text-muted-foreground">
                          {transfer.note}
                        </p>
                      ) : null}
                      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ArrowRightLeft className="size-3" aria-hidden />
                        {formatDateTime(transfer.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
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
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Clã</span>
              <span className="inline-flex items-center gap-1 font-medium">
                <UsersRound className="size-4" aria-hidden />
                {task.clan?.name ?? "Sem clã"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Responsável</span>
              <span className={cn("font-medium", !task.assignee && "text-muted-foreground")}>
                {task.assignee?.name ?? "Sem responsável"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
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
                <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
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
