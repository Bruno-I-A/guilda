import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Diamond } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canViewClan } from "@/domain/clan-access";
import {
  canDistributeClanTasks,
  canQuickCompleteUnassignedInformativeTask,
  canManageClanCommitments,
  canManageFiscalPortfolio,
  isAdminRole,
} from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { parseClanTab } from "@/lib/clan-tabs";
import { CUSTOMER_SUCCESS_CLAN_SLUG } from "@/lib/clans/rules";
import { getActiveMember, requireOrgSession } from "@/lib/session";

import { CampaignsTab } from "./campaigns-tab";
import { ClanTabNav } from "./clan-tab-nav";
import { ClosingsTab, type ClosingsTabParams } from "./closings-tab";
import { CommitmentsTab } from "./commitments-tab";
import { MembersTab } from "./members-tab";
import { MissionsTab } from "./missions-tab";
import { PortfolioTab } from "./portfolio-tab";
import { CompanyDataTab } from "./company-data-tab";
import { CompanyFlowTab } from "./company-flow-tab";
import { FiscalInstallmentTab } from "./fiscal-installment-tab";
import { OfficeFeeTab } from "./office-fee-tab";

export const metadata: Metadata = { title: "Clã" };

export interface ClanMemberView {
  userId: string;
  name: string;
  isLeader: boolean;
  functionTitle: string | null;
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
        functionTitle: schema.clanMemberships.functionTitle,
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
    <div className="grid gap-5">
      <header className="relative grid gap-3 border-b border-border/80 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Quem tem um clã só chegou aqui direto; a listagem só serve a
            quem tem mais de um, e ao admin. */}
        {(myClanIds.length > 1 || isAdminRole(role)) && (
          <Link
            href="/clans"
            className="flex min-h-10 w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />{" "}
            {isAdminRole(role) ? "Clãs" : "Meus clãs"}
          </Link>
        )}
          <span className="hud-label hidden items-center gap-2 sm:flex">
            <Diamond className="size-3 text-primary" aria-hidden /> Área operacional
          </span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid size-10 shrink-0 rotate-45 place-items-center border border-primary/50 bg-primary/5"
              aria-hidden
            >
              <span className="size-2.5 border border-primary -rotate-45" />
            </span>
            <div className="min-w-0">
              <p className="hud-label mb-1">Clã</p>
              <h1 className="truncate font-heading text-2xl font-semibold tracking-wide sm:text-3xl">
                {clan.name}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {leadsThisClan ? <Badge variant="default">Liderança</Badge> : null}
            {!clan.active ? <Badge variant="outline">Inativo</Badge> : null}
          </div>
        </div>
      </header>

      <ClanTabNav clanId={clan.id} clanSlug={clan.slug} active={activeTab} />

      {activeTab === "missions" ? (
        <MissionsTab
          orgId={session.orgId}
          clanId={clan.id}
          memberships={memberships}
          canDistribute={canDistributeClanTasks({ role, leadsThisClan })}
          canQuickComplete={canQuickCompleteUnassignedInformativeTask({
            role,
            leadsThisClan,
            isActiveClanMember: memberships.some(
              (membership) => membership.userId === session.user.id,
            ),
            isCustomerSuccessClan:
              clan.slug === CUSTOMER_SUCCESS_CLAN_SLUG,
          })}
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
          requestedYear={fiscalYear}
          requestedMonth={fiscalMonth}
        />
      ) : null}

      {activeTab === "installments" ? (
        <FiscalInstallmentTab
          orgId={session.orgId}
          clanId={clan.id}
          canManage={canManageFiscalPortfolio({ role, leadsThisClan })}
          requestedYear={fiscalYear}
          requestedMonth={fiscalMonth}
        />
      ) : null}

      {activeTab === "fees" ? (
        <OfficeFeeTab
          orgId={session.orgId}
          clanId={clan.id}
          viewerId={session.user.id}
          canManage={canManageFiscalPortfolio({ role, leadsThisClan })}
          memberships={memberships}
          requestedView={feeView}
          requestedYear={fiscalYear}
          requestedMonth={fiscalMonth}
        />
      ) : null}

      {activeTab === "closings" ? (
        <ClosingsTab orgId={session.orgId} clanId={clan.id} params={filters} />
      ) : null}

      {activeTab === "flow" ? (
        <CompanyFlowTab
          orgId={session.orgId}
          clanId={clan.id}
          viewerId={session.user.id}
          role={role}
          leadsThisClan={leadsThisClan}
        />
      ) : null}

      {activeTab === "company-data" ? (
        <CompanyDataTab clanId={clan.id} />
      ) : null}
    </div>
  );
}
