import { asc, eq } from "drizzle-orm";
import { ArrowUpRight, Flag, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { filterVisibleClans, resolveClanEntry } from "@/domain/clan-access";
import { isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { getActiveMember, requireOrgSession } from "@/lib/session";

export const metadata: Metadata = { title: "Meu clã" };

export default async function ClansPage() {
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const role = viewer.role as OrgRole;
  const viewerIsAdmin = isAdminRole(role);

  const { clans, myClanIds } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const clanRows = await tx.query.clans.findMany({
        where: eq(schema.clans.orgId, session.orgId),
        with: {
          memberships: { columns: { userId: true } },
        },
        orderBy: [asc(schema.clans.name)],
      });
      return {
        clans: clanRows,
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
    <div className="grid gap-8">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center border border-primary/45 bg-primary/10 [clip-path:polygon(0.45rem_0,100%_0,100%_calc(100%-0.45rem),calc(100%-0.45rem)_100%,0_100%,0_0.45rem)]">
          <Flag className="size-5 text-primary" aria-hidden />
        </span>
        <div>
          <p className="hud-label text-[10px]">
            {viewerIsAdmin ? "Áreas de trabalho" : "Seus espaços"}
          </p>
          <h1 className="mt-1 font-heading text-3xl font-semibold tracking-wide">
            {viewerIsAdmin ? "Clãs" : "Meus clãs"}
          </h1>
        </div>
      </div>

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
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((clan) => (
            <Link
              key={clan.id}
              href={`/clans/${clan.id}`}
              aria-label={`Abrir clã ${clan.name}`}
              className="group relative flex min-h-36 flex-col justify-between overflow-hidden border border-border bg-card/75 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [clip-path:polygon(0.7rem_0,100%_0,100%_calc(100%-0.7rem),calc(100%-0.7rem)_100%,0_100%,0_0.7rem)]"
            >
              <span
                aria-label={clan.active ? "Clã ativo" : "Clã inativo"}
                className={
                  clan.active
                    ? "size-2 bg-primary [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]"
                    : "size-2 border border-muted-foreground/60 [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]"
                }
              />
              <div className="flex items-end justify-between gap-4">
                <h2 className="font-heading text-2xl font-medium tracking-wide text-foreground">
                  {clan.name}
                </h2>
                <span className="grid size-9 shrink-0 place-items-center border border-border bg-background/50 text-muted-foreground transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                  <ArrowUpRight className="size-4" aria-hidden />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
