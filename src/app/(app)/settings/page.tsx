import { asc, eq } from "drizzle-orm";
import { Crown, Settings, Shield, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
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
import { canManageClanMembership } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { getActiveMember, requireOrgSession } from "@/lib/session";

import { ClanMembershipManager } from "./clan-membership-manager";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");

  // A composição dos clãs define o que cada pessoa enxerga — por isso vive
  // aqui, atrás do papel, e não na tela do clã (decisão de 2026-08-18).
  if (!canManageClanMembership({ role: viewer.role as OrgRole, leadsThisClan: false })) {
    redirect("/dashboard");
  }

  const { clans, orgMembers } = await withOrgTx(session.orgId, async (tx) => {
    const clanRows = await tx.query.clans.findMany({
      where: eq(schema.clans.orgId, session.orgId),
      with: { memberships: { with: { user: { columns: { name: true } } } } },
      orderBy: [asc(schema.clans.name)],
    });
    const memberRows = await tx
      .select({ userId: schema.member.userId, name: schema.user.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, session.orgId))
      .orderBy(asc(schema.user.name));
    return { clans: clanRows, orgMembers: memberRows };
  });
  const orgMemberIds = new Set(orgMembers.map((row) => row.userId));

  const semClan = orgMembers.filter(
    (orgMember) =>
      !clans.some((clan) =>
        clan.memberships.some(
          (membership) => membership.userId === orgMember.userId,
        ),
      ),
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Configurações"
        icon={Settings}
        description="Ajustes da Guilda restritos a quem administra. Cada pessoa só enxerga os clãs em que está vinculada — o que você define aqui decide o que ela vê."
      />

      {semClan.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-destructive/50 bg-destructive/5 p-4 text-sm">
          <Shield className="size-4 shrink-0 text-destructive" aria-hidden />
          <span className="font-medium">
            <span className="font-mono tabular-nums">{semClan.length}</span>{" "}
            {semClan.length === 1 ? "pessoa" : "pessoas"} sem clã:
          </span>
          <span className="text-muted-foreground">
            {semClan.map((person) => person.name).join(", ")}. Sem vínculo, a aba
            Clãs fica vazia para {semClan.length === 1 ? "ela" : "elas"}.
          </span>
        </div>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2>Composição dos clãs</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Quem entra, quem sai, quem lidera e qual é o clã principal de cada
              pessoa.
            </p>
          </div>
          <Link
            href="/members"
            className="flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <Users className="size-4" aria-hidden /> Membros da Guilda
          </Link>
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
              const leaders = memberships.filter(
                (membership) => membership.isLeader,
              );

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
                          {memberships.length}{" "}
                          {memberships.length === 1 ? "integrante" : "integrantes"}
                          {leaders.length === 0 && clan.active
                            ? " · sem líder"
                            : null}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {leaders.length > 0 ? (
                          <Badge variant="default" className="gap-1">
                            <Crown className="size-3" aria-hidden />
                            {leaders.length}
                          </Badge>
                        ) : null}
                        <Badge variant={clan.active ? "secondary" : "outline"}>
                          {clan.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
