import { asc, eq } from "drizzle-orm";
import { AlertTriangle, Crown, Flag, ListTodo, UserRoundX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { filterVisibleClans, resolveClanEntry } from "@/domain/clan-access";
import { isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { initials } from "@/lib/people";
import { getActiveMember, requireOrgSession } from "@/lib/session";

export const metadata: Metadata = { title: "Meu clã" };

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
  const role = viewer.role as OrgRole;
  const viewerIsAdmin = isAdminRole(role);

  const { clans, orgMemberIds, myClanIds } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const clanRows = await tx.query.clans.findMany({
        where: eq(schema.clans.orgId, session.orgId),
        with: {
          memberships: { with: { user: { columns: { name: true } } } },
          tasks: {
            columns: { status: true, assigneeId: true, dueDate: true },
          },
        },
        orderBy: [asc(schema.clans.name)],
      });
      const memberRows = await tx
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(eq(schema.member.organizationId, session.orgId));
      return {
        clans: clanRows,
        orgMemberIds: new Set(memberRows.map((row) => row.userId)),
        myClanIds: clanRows
          .filter((clan) =>
            clan.memberships.some(
              (membership) => membership.userId === session.user.id,
            ),
          )
          .map((clan) => clan.id),
      };
    },
  );

  // Um clã só: a listagem de um item é fricção pura — abre direto nele.
  const entry = resolveClanEntry({ role, memberClanIds: myClanIds });
  if (entry.outcome === "clan") {
    redirect(`/clans/${entry.clanId}`);
  }

  const visible = filterVisibleClans({ role, memberClanIds: myClanIds }, clans);

  return (
    <div className="grid gap-6">
      <PageHeader
        icon={Flag}
        title={viewerIsAdmin ? "Clãs" : "Meus clãs"}
        description={
          viewerIsAdmin
            ? "As áreas operacionais da Guilda, suas lideranças e missões em aberto."
            : "Os clãs em que você atua: missões, integrantes e campanhas do mês."
        }
      />

      {entry.outcome === "none" ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <Users className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Você ainda não faz parte de um clã</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Peça a um administrador da Guilda para vincular você ao seu clã. É o
            vínculo que libera as missões, a carteira e as campanhas da área.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Os clãs ainda não foram preparados para esta Guilda.
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {visible.map((clan) => {
            const memberships = clan.memberships
              .filter((membership) => orgMemberIds.has(membership.userId))
              .sort((left, right) =>
                left.user.name.localeCompare(right.user.name, "pt-BR"),
              );
            const leaders = memberships.filter((membership) => membership.isLeader);
            const openTasks = clan.tasks.filter((task) =>
              OPEN_STATUSES.has(task.status),
            );
            const unassigned = openTasks.filter((task) => !task.assigneeId).length;
            const overdue = openTasks.filter(
              (task) => task.dueDate && task.dueDate.getTime() < Date.now(),
            ).length;

            return (
              // <section> puro em vez de <Card>: o Card traz borda, raio e um
              // anel RETANGULAR que sobreviviam ao chanfro e deixavam tocos de
              // fio nos cantos — mais um `overflow-hidden` que clipava de novo.
              <section
                key={clan.id}
                className="panel-cut texture-iron grid gap-4 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate">
                      <Link
                        href={`/clans/${clan.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {clan.name}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {memberships.length}
                      </span>{" "}
                      {memberships.length === 1 ? "integrante" : "integrantes"}
                    </p>
                  </div>
                  <Badge
                    variant={clan.active ? "secondary" : "outline"}
                    className="shrink-0"
                  >
                    {clan.active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>

                {/* As três medidas ficam em `bg-muted` de propósito: dentro de
                    uma placa chanfrada, um `panel-cut` aninhado herdaria a cor
                    do próprio card e sumiria. */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted/45 p-2.5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ListTodo className="size-3.5 shrink-0" aria-hidden /> Abertas
                    </span>
                    <strong className="mt-1 block font-mono text-lg tabular-nums">
                      {openTasks.length}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-muted/45 p-2.5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <UserRoundX className="size-3.5 shrink-0" aria-hidden /> Sem
                      responsável
                    </span>
                    <strong className="mt-1 block font-mono text-lg tabular-nums">
                      {unassigned}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-muted/45 p-2.5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />{" "}
                      Atrasadas
                    </span>
                    <strong className="mt-1 block font-mono text-lg tabular-nums">
                      {overdue}
                    </strong>
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
                      <AlertTriangle className="size-4 shrink-0" aria-hidden /> Sem
                      líder definido
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
                          {/* `size="sm"` em vez de `size-5` + `text-[8px]`: o
                              próprio Avatar já casa iniciais e diâmetro. */}
                          <Avatar size="sm">
                            <AvatarFallback>
                              {initials(membership.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          {membership.user.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="size-4 shrink-0" aria-hidden /> Nenhuma
                      pessoa vinculada
                    </p>
                  )}
                </div>

                <Link
                  href={`/clans/${clan.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border bg-background/40 px-3 py-2 text-sm font-medium hover:bg-accent/40"
                >
                  Abrir o clã
                  {unassigned > 0 ? (
                    <span className="font-mono text-xs text-primary">
                      <span className="tabular-nums">{unassigned}</span> sem dono
                    </span>
                  ) : null}
                </Link>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
