import { or, and, asc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  CalendarClock,
  Inbox,
  Star,
  UsersRound,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { withOrgTx } from "@/db/org-tx";
import { clanTabHref } from "@/lib/clan-tabs";
import * as schema from "@/db/schema";
import { isTransferableTaskStatus } from "@/domain/clans";
import {
  authorizeTaskDeletion,
  authorizeTransition,
  type OrgRole,
} from "@/domain/task-state";
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

function returnToTasks(value: string | string[] | undefined): string {
  const returnTo = Array.isArray(value) ? value[0] : value;
  if (!returnTo) return "/tasks";

  try {
    const parsed = new URL(returnTo, "https://guilda.local");
    return parsed.origin === "https://guilda.local" && parsed.pathname === "/tasks"
      ? `${parsed.pathname}${parsed.search}`
      : "/tasks";
  } catch {
    return "/tasks";
  }
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const session = await requireOrgSession();
  const member = await getActiveMember();
  if (!member) redirect("/onboarding");

  const { id } = await params;
  const taskListHref = returnToTasks((await searchParams).returnTo);
  if (!z.uuid().safeParse(id).success) notFound();

  const { task, viewerClanMembership, candidateMemberships, fluxoVinculado } =
    await withOrgTx(
    session.orgId,
    async (tx) => {
      const taskRow = await tx.query.tasks.findFirst({
        where: and(eq(schema.tasks.id, id), eq(schema.tasks.orgId, session.orgId)),
        with: {
          assignee: { columns: { id: true, name: true } },
          creator: { columns: { id: true, name: true } },
          clan: { columns: { id: true, name: true, active: true } },
          client: { columns: { name: true } },
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
        return {
          task: null,
          viewerClanMembership: null,
          candidateMemberships: [],
          fluxoVinculado: null,
        };
      }

      // O vínculo mora no Fluxo (processing_task_id / informative_task_id), então
      // a busca é reversa. Os dois índices únicos parciais tornam isso barato.
      const [fluxoVinculado] = await tx
        .select({ clanId: schema.companyFlows.societarioClanId })
        .from(schema.companyFlows)
        .where(
          and(
            eq(schema.companyFlows.orgId, session.orgId),
            or(
              eq(schema.companyFlows.processingTaskId, taskRow.id),
              eq(schema.companyFlows.informativeTaskId, taskRow.id),
            ),
          ),
        )
        .limit(1);

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
        fluxoVinculado: fluxoVinculado ?? null,
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
  const viewerIsClanMember = Boolean(viewerClanMembership);
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
    submit:
      task.status === "in_progress" &&
      authorizeTransition("awaiting_approval", context).allowed,
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
    // Excluir é diferente de cancelar: apaga o registro por completo, e só
    // é permitido para missão que nunca passou por `→ completed` nem por
    // `task_transfers` (INSERT-only no banco — ver authorizeTaskDeletion).
    // Mesmos fatos usados pela Server Action; aqui só refletem a régua na UI.
    delete: authorizeTaskDeletion({
      actor: { id: session.user.id, role: member.role as OrgRole },
      task: {
        creatorId: task.creatorId,
        everCompleted: task.events.some((event) => event.toStatus === "completed"),
        everTransferred: task.transfers.length > 0,
      },
    }).allowed,
    revert:
      task.status === "completed" &&
      authorizeTransition("in_progress", context).allowed,
    transfer:
      isTransferableTaskStatus(task.status) &&
      (isAdmin || viewerIsClanMember || task.assigneeId === session.user.id),
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

  const lastRejection = [...task.events]
    .reverse()
    .find((event) => event.toStatus === "rejected");
  // O retorno da entrega e o comentário da aprovação são os dois lados do
  // ciclo de uma missão pedida a outra pessoa. Ficam em destaque, não só
  // enterrados na linha do tempo.
  const viewerIsCreator = task.creatorId === session.user.id;
  const viewerIsAssignee = task.assigneeId === session.user.id;
  const thirdParty = task.creatorId !== task.assigneeId;
  const delivery = [...task.events]
    .reverse()
    .find((event) => event.toStatus === "awaiting_approval");
  const approval = [...task.events]
    .reverse()
    .find(
      (event) =>
        event.toStatus === "completed" && event.fromStatus === "awaiting_approval",
    );
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
          href={taskListHref}
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

      {task.status === "awaiting_approval" ? (
        <div className="panel-cut panel-cut-sm grid gap-2 bg-warning/10 p-4 text-sm shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warning)_35%,transparent)]">
          <p className="hud-label !text-warning">
            Retorno de {delivery?.actor.name ?? task.assignee?.name ?? "quem entregou"}
            {delivery ? ` · ${formatDateTime(delivery.createdAt)}` : ""}
          </p>
          <p className="whitespace-pre-wrap">
            {delivery?.note ?? "Entregue sem retorno escrito."}
          </p>
          {can.approve ? (
            <p className="text-xs text-muted-foreground">
              Aprove para creditar {task.xpValue} XP a{" "}
              {task.assignee?.name ?? "quem entregou"}, ou devolva dizendo o que falta.
            </p>
          ) : viewerIsAssignee ? (
            <p className="text-xs text-muted-foreground">
              {task.creator.name} recebeu o retorno e decide a aprovação.
            </p>
          ) : null}
        </div>
      ) : null}

      {task.status === "completed" && thirdParty && viewerIsCreator && delivery ? (
        <div className="panel-cut panel-cut-sm grid gap-2 bg-card/60 p-4 text-sm">
          <p className="hud-label">
            Retorno de {delivery.actor.name} · {formatDateTime(delivery.createdAt)}
          </p>
          <p className="whitespace-pre-wrap">
            {delivery.note ?? "Entregue sem retorno escrito."}
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
          <div className="grid gap-1">
            <p className="font-medium">Missão concluída — você ganhou {task.xpValue} XP! 🎉</p>
            {approval?.note ? (
              <p className="whitespace-pre-wrap">
                <span className="font-medium">{approval.actor.name}:</span>{" "}
                {approval.note}
              </p>
            ) : null}
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
          creatorName: task.creator.name,
          clanId: task.clanId,
          clanName: task.clan?.name ?? null,
        }}
        can={can}
        transferCandidates={transferCandidates}
        restrictTransferToTaskClan={!isAdmin}
        returnTo={taskListHref}
        startDestination={
          fluxoVinculado ? clanTabHref(fluxoVinculado.clanId, "flow") : null
        }
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
            {/* De onde a missão veio decide onde ela é acompanhada: pacote
                de Informativo ou lista de avulsas. */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Origem</span>
              {task.informativeId ? (
                <Link
                  href="/tasks?view=informative"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <Inbox className="size-4" aria-hidden /> Informativo
                </Link>
              ) : (
                <span className="font-medium">Avulsa</span>
              )}
            </div>
            {task.client ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Empresa</span>
                <span className="inline-flex min-w-0 items-center gap-1 font-medium">
                  <Building2 className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{task.client.name}</span>
                </span>
              </div>
            ) : null}
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
