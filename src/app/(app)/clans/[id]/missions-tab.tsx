import { and, asc, eq, inArray } from "drizzle-orm";
import { ChevronRight, ListChecks } from "lucide-react";

import { MissionRow } from "@/components/mission-row";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { initials } from "@/lib/people";
import { isOverdue } from "@/lib/task-ui";

import type { ClanMemberView } from "./page";
import { ClanEmptyState, ClanSectionHeading, ClanStatusStrip } from "./clan-ui";
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
 * A mesa do clã: quem ainda não tem dono, quem está com o quê e quanto
 * cada integrante já carrega.
 */
export async function MissionsTab({
  orgId,
  clanId,
  memberships,
  canDistribute,
  canQuickComplete,
}: {
  orgId: string;
  clanId: string;
  memberships: readonly ClanMemberView[];
  canDistribute: boolean;
  canQuickComplete: boolean;
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
      <ClanStatusStrip
        items={[
          {
            label: openTasks.length === 1 ? "missão aberta" : "missões abertas",
            value: openTasks.length,
            detail: openTasks.length === 0 ? "nenhum trabalho pendente" : "carga atual do clã",
          },
          {
            label: orphans.length === 0 ? "tudo atribuído" : "sem responsável",
            value: orphans.length === 0 ? "✓" : orphans.length,
            detail: orphans.length === 0 ? "fila sob controle" : "aguardando distribuição",
            tone: orphans.length === 0 ? "positive" : "warning",
          },
          {
            label: overdueCount === 0 ? "tudo em dia" : "atrasadas",
            value: overdueCount === 0 ? "✓" : overdueCount,
            detail: overdueCount === 0 ? "nenhum prazo vencido" : "exigem atenção",
            tone: overdueCount === 0 ? "positive" : "danger",
          },
        ]}
      />

      <section className="grid gap-3">
        <ClanSectionHeading count={assigned.length}>Em andamento</ClanSectionHeading>
        {assigned.length === 0 ? (
          <ClanEmptyState
            icon={<ListChecks className="size-6" aria-hidden />}
            title="Nenhuma missão em andamento"
            description="As missões assumidas pelo clã aparecem aqui."
            compact
          />
        ) : (
          <ul className="grid gap-1.5">
            {/* A mesma linha de missão do resto do app: trilho de status,
                prazo e chip de XP são os sinais de triagem, e a mesa é a
                tela de triagem por excelência. */}
            {assigned.map((task) => (
              <li key={task.id}>
                <MissionRow
                  variant="compact"
                  task={{
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    xpValue: task.xpValue,
                    dueDate: task.dueDate,
                    clientName: task.client?.name ?? null,
                    assigneeName: task.assignee?.name ?? null,
                  }}
                  trailing={
                    <Avatar className="size-6 shrink-0">
                      <AvatarFallback className="text-xs" aria-hidden>
                        {initials(task.assignee?.name ?? "?")}
                      </AvatarFallback>
                    </Avatar>
                  }
                  after={
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <DistributionBoard
        clanId={clanId}
        canDistribute={canDistribute}
        canQuickComplete={canQuickComplete}
        groups={boardGroups}
        members={members}
      />
    </div>
  );
}
