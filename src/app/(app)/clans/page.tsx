import { asc, eq } from "drizzle-orm";
import { AlertTriangle, Crown, Flag, ListTodo, UserRoundX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { initials } from "@/lib/people";
import { getActiveMember, isAdminRole, requireOrgSession } from "@/lib/session";

import { ClanMembershipManager } from "./clan-membership-manager";

export const metadata: Metadata = { title: "Clãs" };

const OPEN_STATUSES = new Set([
  "pending",
  "in_progress",
  "awaiting_approval",
  "rejected",
]);

export default async function ClansPage() {
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const viewerIsAdmin = isAdminRole(viewer.role);

  const { clans, orgMembers } = await withOrgTx(session.orgId, async (tx) => {
    const [clanRows, memberRows] = await Promise.all([
      tx.query.clans.findMany({
        where: eq(schema.clans.orgId, session.orgId),
        with: {
          memberships: {
            with: { user: { columns: { name: true } } },
          },
          tasks: {
            columns: {
              status: true,
              assigneeId: true,
              dueDate: true,
            },
          },
        },
        orderBy: [asc(schema.clans.name)],
      }),
      tx
        .select({ userId: schema.member.userId, name: schema.user.name })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, session.orgId))
        .orderBy(asc(schema.user.name)),
    ]);
    return { clans: clanRows, orgMembers: memberRows };
  });
  const orgMemberIds = new Set(orgMembers.map((memberRow) => memberRow.userId));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-wide">
          <Flag className="size-6 text-primary" aria-hidden /> Clãs
        </h1>
        <p className="text-muted-foreground">
          As cinco áreas operacionais da Guilda, suas lideranças e missões em aberto.
        </p>
      </div>

      {clans.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Os clãs ainda não foram preparados para esta Guilda.
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {clans.map((clan) => {
            const memberships = clan.memberships
              .filter((membership) => orgMemberIds.has(membership.userId))
              .sort((left, right) =>
                left.user.name.localeCompare(right.user.name, "pt-BR"),
              );
            const leaders = memberships.filter((membership) => membership.isLeader);
            const openTasks = clan.tasks.filter((task) => OPEN_STATUSES.has(task.status));
            const unassigned = openTasks.filter((task) => !task.assigneeId).length;
            const overdue = openTasks.filter(
              (task) => task.dueDate && task.dueDate.getTime() < Date.now(),
            ).length;

            return (
              <Card key={clan.id} className="panel-cut texture-iron">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">
                        <Link
                          href={`/clans/${clan.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {clan.name}
                        </Link>
                      </CardTitle>
                      <CardDescription>
                        {memberships.length} {memberships.length === 1 ? "integrante" : "integrantes"}
                      </CardDescription>
                    </div>
                    <Badge variant={clan.active ? "secondary" : "outline"}>
                      {clan.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted/45 p-2.5">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ListTodo className="size-3.5" aria-hidden /> Abertas
                      </span>
                      <strong className="mt-1 block font-mono text-lg">{openTasks.length}</strong>
                    </div>
                    <div className="rounded-lg bg-muted/45 p-2.5">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <UserRoundX className="size-3.5" aria-hidden /> Sem responsável
                      </span>
                      <strong className="mt-1 block font-mono text-lg">{unassigned}</strong>
                    </div>
                    <div className="rounded-lg bg-muted/45 p-2.5">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <AlertTriangle className="size-3.5" aria-hidden /> Atrasadas
                      </span>
                      <strong className="mt-1 block font-mono text-lg">{overdue}</strong>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <p className="hud-label">Liderança</p>
                    {leaders.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {leaders.map((leader) => (
                          <Badge key={leader.id} variant="default" className="gap-1">
                            <Crown className="size-3" aria-hidden /> {leader.user.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-destructive">
                        <AlertTriangle className="size-4" aria-hidden /> Sem líder definido
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <p className="hud-label">Integrantes</p>
                    {memberships.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {memberships.map((membership) => (
                          <span
                            key={membership.id}
                            className="inline-flex items-center gap-1.5 rounded-full border bg-background/50 py-1 pr-2.5 pl-1 text-xs"
                          >
                            <Avatar className="size-5">
                              <AvatarFallback className="text-[8px]">
                                {initials(membership.user.name)}
                              </AvatarFallback>
                            </Avatar>
                            {membership.user.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Users className="size-4" aria-hidden /> Nenhuma pessoa vinculada
                      </p>
                    )}
                  </div>

                  <Link
                    href={`/clans/${clan.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border bg-background/40 px-3 py-2 text-sm font-medium hover:bg-accent/40"
                  >
                    Abrir a Mesa do Líder
                    {unassigned > 0 ? (
                      <span className="font-mono text-xs text-primary">
                        {unassigned} sem dono
                      </span>
                    ) : null}
                  </Link>

                  {/* Decisão 7: o líder gerencia os integrantes do próprio clã. */}
                  {viewerIsAdmin ||
                  memberships.some(
                    (membership) =>
                      membership.userId === session.user.id && membership.isLeader,
                  ) ? (
                    <ClanMembershipManager
                      clanId={clan.id}
                      clanName={clan.name}
                      memberships={memberships.map((membership) => ({
                        userId: membership.userId,
                        name: membership.user.name,
                        isLeader: membership.isLeader,
                        isPrimary: membership.isPrimary,
                      }))}
                      orgMembers={orgMembers}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
