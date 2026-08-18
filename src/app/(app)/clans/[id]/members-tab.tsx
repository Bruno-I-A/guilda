import { and, eq, inArray } from "drizzle-orm";
import { Crown, Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { initials } from "@/lib/people";
import { isOverdue } from "@/lib/task-ui";

import type { ClanMemberView } from "./page";

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users className="size-4" aria-hidden />
          {rows.length} {rows.length === 1 ? "integrante" : "integrantes"}
        </span>
        <span className="flex items-center gap-1.5">
          <Crown className="size-4" aria-hidden />
          {leaders === 0
            ? "sem líder definido"
            : `${leaders} ${leaders === 1 ? "líder" : "líderes"}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma pessoa vinculada a este clã. A composição é definida nas
          Configurações da Guilda.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.userId}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card/50 p-3"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-8">
                  <AvatarFallback className="text-[10px]">
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
                  ) : null}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3 text-sm">
                <span className="text-right">
                  <strong className="block font-mono leading-none">
                    {row.openCount}
                  </strong>
                  <span className="text-[11px] text-muted-foreground">abertas</span>
                </span>
                {row.overdueCount > 0 ? (
                  <span className="text-right text-destructive">
                    <strong className="block font-mono leading-none">
                      {row.overdueCount}
                    </strong>
                    <span className="text-[11px]">atrasadas</span>
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
