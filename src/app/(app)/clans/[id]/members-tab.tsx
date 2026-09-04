import { and, eq, inArray } from "drizzle-orm";
import { Crown, Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { initials } from "@/lib/people";
import { isOverdue } from "@/lib/task-ui";

import type { ClanMemberView } from "./page";
import { ClanEmptyState, ClanSectionHeading, ClanStatusStrip } from "./clan-ui";

const OPEN_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "rejected",
] as const;

/**
 * Quem é do clã e quanto cada pessoa carrega. Somente leitura: a composição
 * do clã é definida nas Configurações, por admin/owner.
 */
export async function MembersTab({
  orgId,
  clanId,
  memberships,
  viewerId,
}: {
  orgId: string;
  clanId: string;
  memberships: readonly ClanMemberView[];
  viewerId: string;
}) {
  const openTasks = await withOrgTx(orgId, (tx) =>
    tx
      .select({
        assigneeId: schema.tasks.assigneeId,
        dueDate: schema.tasks.dueDate,
        status: schema.tasks.status,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.orgId, orgId),
          eq(schema.tasks.clanId, clanId),
          inArray(schema.tasks.status, [...OPEN_STATUSES]),
        ),
      ),
  );

  const rows = memberships.map((membership) => {
    const own = openTasks.filter((task) => task.assigneeId === membership.userId);
    return {
      ...membership,
      openCount: own.length,
      overdueCount: own.filter((task) => isOverdue(task.dueDate, task.status))
        .length,
    };
  });

  const leaders = rows.filter((row) => row.isLeader).length;

  return (
    <div className="grid gap-4">
      <ClanStatusStrip
        items={[
          {
            label: rows.length === 1 ? "integrante" : "integrantes",
            value: rows.length,
            detail: "composição atual",
          },
          {
            label: leaders === 1 ? "liderança definida" : leaders > 1 ? "lideranças definidas" : "sem liderança",
            value: leaders === 0 ? "!" : leaders,
            detail: leaders === 0 ? "requer configuração" : "coordenação do clã",
            tone: leaders === 0 ? "warning" : "positive",
          },
          {
            label: "missões abertas",
            value: openTasks.length,
            detail: "carga total da equipe",
          },
        ]}
      />

      <ClanSectionHeading>Formação do clã</ClanSectionHeading>

      {rows.length === 0 ? (
        <ClanEmptyState
          icon={<Users className="size-6" aria-hidden />}
          title="Nenhuma pessoa vinculada"
          description="A composição deste clã é definida nas Configurações da Guilda."
        />
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.userId}
              className="clan-operational-row flex min-h-16 items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs" aria-hidden>
                    {initials(row.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{row.name}</span>
                    {row.userId === viewerId ? (
                      <Badge variant="outline" className="shrink-0">
                        você
                      </Badge>
                    ) : null}
                  </span>
                  {row.isLeader ? (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <Crown className="size-3" aria-hidden /> Líder do clã
                    </span>
                  ) : row.functionTitle ? (
                    <span className="text-xs text-muted-foreground">
                      {row.functionTitle}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3 text-sm">
                <span className="text-right">
                  <strong className="block font-mono leading-none">
                    {row.openCount}
                  </strong>
                  <span className="text-xs text-muted-foreground">abertas</span>
                </span>
                {row.overdueCount > 0 ? (
                  <span className="text-right text-destructive">
                    <strong className="block font-mono leading-none">
                      {row.overdueCount}
                    </strong>
                    <span className="text-xs">atrasadas</span>
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
