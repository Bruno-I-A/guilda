import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canViewClan } from "@/domain/clan-access";
import {
  canDistributeClanTasks,
  canManageClanCommitments,
  canManageFiscalPortfolio,
  isAdminRole,
} from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { parseClanTab } from "@/lib/clan-tabs";
import { getActiveMember, requireOrgSession } from "@/lib/session";

import { CampaignsTab } from "./campaigns-tab";
import { ClanTabNav } from "./clan-tab-nav";
import { ClosingsTab, type ClosingsTabParams } from "./closings-tab";
import { CommitmentsTab } from "./commitments-tab";
import { MembersTab } from "./members-tab";
import { MissionsTab } from "./missions-tab";
import { PortfolioTab } from "./portfolio-tab";

export const metadata: Metadata = { title: "Clã" };

export interface ClanMemberView {
  userId: string;
  name: string;
  isLeader: boolean;
}

export default async function ClanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // Além da aba, a página carrega os filtros das seções que os usam
  // (Fechamentos filtra por ano, regime, busca e situação).
  searchParams: Promise<
    {
      tab?: string;
      distributionYear?: string;
      fiscalView?: string;
      feeView?: string;
      fiscalYear?: string;
      fiscalMonth?: string;
    } & ClosingsTabParams
  >;
}) {
  const { id } = await params;
  const {
    tab,
    distributionYear,
    fiscalView,
    feeView,
    fiscalYear,
    fiscalMonth,
    ...filters
  } = await searchParams;
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const role = viewer.role as OrgRole;

  const data = await withOrgTx(session.orgId, async (tx) => {
    const [clan] = await tx
      .select()
      .from(schema.clans)
      .where(and(eq(schema.clans.orgId, session.orgId), eq(schema.clans.id, id)));
    if (!clan) return null;

    // Só integrantes que ainda são membros da organização.
    const memberships = await tx
      .select({
        userId: schema.clanMemberships.userId,
        name: schema.user.name,
        isLeader: schema.clanMemberships.isLeader,
      })
      .from(schema.clanMemberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.clanMemberships.userId))
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.userId, schema.clanMemberships.userId),
          eq(schema.member.organizationId, schema.clanMemberships.orgId),
        ),
      )
      .where(
        and(
          eq(schema.clanMemberships.orgId, session.orgId),
          eq(schema.clanMemberships.clanId, id),
          eq(schema.member.organizationId, session.orgId),
        ),
      )
      .orderBy(asc(schema.user.name));

    // Vínculos do visitante — a régua de quem pode abrir este clã.
    const mine = await tx
      .select({ clanId: schema.clanMemberships.clanId })
      .from(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, session.orgId),
          eq(schema.clanMemberships.userId, session.user.id),
        ),
      );

    return {
      clan,
      memberships,
      myClanIds: mine.map((row) => row.clanId),
    };
  });

  if (!data) notFound();
  const { clan, memberships, myClanIds } = data;

  // Clã de outra pessoa é 404, não 403: quem não é do clã não precisa saber
  // que ele existe.
  if (!canViewClan({ role, memberClanIds: myClanIds }, clan.id)) notFound();

  const leadsThisClan =
    clan.active &&
    memberships.some(
      (membership) => membership.userId === session.user.id && membership.isLeader,
    );
  const activeTab = parseClanTab(tab, clan.slug);

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        {/* Quem tem um clã só chegou aqui direto; a listagem só serve a
            quem tem mais de um, e ao admin. */}
        {(myClanIds.length > 1 || isAdminRole(role)) && (
          <Link
            href="/clans"
            className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />{" "}
            {isAdminRole(role) ? "Clãs" : "Meus clãs"}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-wide">
            {clan.name}
          </h1>
          {leadsThisClan ? <Badge variant="default">Você lidera</Badge> : null}
          {!clan.active ? <Badge variant="outline">Inativo</Badge> : null}
        </div>
      </div>

      <ClanTabNav clanId={clan.id} clanSlug={clan.slug} active={activeTab} />

      {activeTab === "missions" ? (
        <MissionsTab
          orgId={session.orgId}
          clanId={clan.id}
          memberships={memberships}
          canDistribute={canDistributeClanTasks({ role, leadsThisClan })}
        />
      ) : null}

      {activeTab === "members" ? (
        <MembersTab
          orgId={session.orgId}
          clanId={clan.id}
          memberships={memberships}
          viewerId={session.user.id}
        />
      ) : null}

      {activeTab === "campaigns" ? (
        <CampaignsTab
          orgId={session.orgId}
          clanId={clan.id}
          canManage={canDistributeClanTasks({ role, leadsThisClan })}
          isFiscal={clan.slug === "fiscal"}
        />
      ) : null}

      {activeTab === "commitments" ? (
        <CommitmentsTab
          orgId={session.orgId}
          clanId={clan.id}
          canManage={canManageClanCommitments({ role, leadsThisClan })}
          requestedYear={distributionYear}
        />
      ) : null}

      {activeTab === "portfolio" ? (
        <PortfolioTab
          orgId={session.orgId}
          clanId={clan.id}
          memberships={memberships}
          viewerId={session.user.id}
          canManage={canManageFiscalPortfolio({ role, leadsThisClan })}
          requestedView={fiscalView}
          requestedFeeView={feeView}
          requestedYear={fiscalYear}
          requestedMonth={fiscalMonth}
        />
      ) : null}

      {activeTab === "closings" ? (
        <ClosingsTab orgId={session.orgId} clanId={clan.id} params={filters} />
      ) : null}
    </div>
  );
}
