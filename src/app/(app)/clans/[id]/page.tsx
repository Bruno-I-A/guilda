import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Crown, Diamond } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { CLAN_TAB_DESCRIPTIONS, parseClanTab } from "@/lib/clan-tabs";
import { CUSTOMER_SUCCESS_CLAN_SLUG } from "@/lib/clans/rules";
import { initials } from "@/lib/people";
import { getActiveMember, requireOrgSession } from "@/lib/session";

import { ClanTabNav } from "./clan-tab-nav";
import { ClosingsTab, type ClosingsTabParams } from "./closings-tab";
import { CommitmentsTab } from "./commitments-tab";
import { MembersTab } from "./members-tab";
import { MeiTab } from "./mei-tab";
import { MissionsTab } from "./missions-tab";
import { PortfolioTab } from "./portfolio-tab";
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
      meiYear?: string;
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
    meiYear,
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
  const isActiveClanMember =
    clan.active &&
    memberships.some((membership) => membership.userId === session.user.id);
  const clanFacts = { role, leadsThisClan, isActiveClanMember };
  const activeTab = parseClanTab(tab, clan.slug);
  const leaders = memberships.filter((membership) => membership.isLeader);
  const shownAvatars = memberships.slice(0, 6);
  const hiddenAvatars = memberships.length - shownAvatars.length;

  return (
    <div className="grid gap-5">
      <header className="relative grid gap-4 border-b border-border/80 pb-5">
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

        {/* Identidade + formação numa linha: o nome de um lado, quem faz
            parte do outro. A composição vem das Configurações; aqui é só
            leitura, e por isso cabe no cabeçalho de toda aba. */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid size-10 shrink-0 rotate-45 place-items-center border border-primary/50 bg-primary/5"
              aria-hidden
            >
              <span className="size-2.5 border border-primary -rotate-45" />
            </span>
            <div className="min-w-0">
              <p className="hud-label mb-1">Clã</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="truncate">{clan.name}</h1>
                {leadsThisClan ? <Badge variant="default">Liderança</Badge> : null}
                {!clan.active ? <Badge variant="outline">Inativo</Badge> : null}
              </div>
            </div>
          </div>

          <Link
            href={`/clans/${clan.id}?tab=members`}
            aria-label="Ver integrantes do clã"
            className="flex items-center gap-3 border border-border/70 bg-card/30 py-2 pr-4 pl-2 transition-colors hover:border-primary/50 hover:bg-accent/30 [clip-path:polygon(0.5rem_0,100%_0,100%_calc(100%-0.5rem),calc(100%-0.5rem)_100%,0_100%,0_0.5rem)]"
          >
            <span className="flex -space-x-2">
              {shownAvatars.map((membership) => (
                <Avatar
                  key={membership.userId}
                  className="size-8 border-2 border-background"
                  title={membership.name}
                >
                  <AvatarFallback className="text-xs">
                    {initials(membership.name)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {hiddenAvatars > 0 ? (
                <span className="grid size-8 place-items-center rounded-full border-2 border-background bg-secondary font-mono text-xs">
                  +{hiddenAvatars}
                </span>
              ) : null}
            </span>
            <span className="grid text-xs leading-tight">
              <span className="font-medium">
                {memberships.length}{" "}
                {memberships.length === 1 ? "integrante" : "integrantes"}
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {leaders.length > 0 ? (
                  <>
                    <Crown className="size-3 text-primary" aria-hidden />
                    {leaders.map((leader) => leader.name.split(" ")[0]).join(", ")}
                  </>
                ) : (
                  "sem liderança definida"
                )}
              </span>
            </span>
          </Link>
        </div>
      </header>

      <div className="grid gap-2">
        <ClanTabNav
          clanId={clan.id}
          clanSlug={clan.slug}
          clanName={clan.name}
          active={activeTab}
        />
        <p className="text-sm text-muted-foreground">
          {CLAN_TAB_DESCRIPTIONS[activeTab]}
        </p>
      </div>

      {activeTab === "missions" ? (
        <MissionsTab
          orgId={session.orgId}
          clanId={clan.id}
          memberships={memberships}
          canDistribute={canDistributeClanTasks(clanFacts)}
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

      {activeTab === "commitments" ? (
        <CommitmentsTab
          orgId={session.orgId}
          clanId={clan.id}
          canManage={canManageClanCommitments(clanFacts)}
          requestedYear={distributionYear}
        />
      ) : null}

      {activeTab === "portfolio" ? (
        <PortfolioTab
          orgId={session.orgId}
          clanId={clan.id}
          memberships={memberships}
          viewerId={session.user.id}
          canManage={canManageFiscalPortfolio(clanFacts)}
          requestedView={fiscalView}
          requestedYear={fiscalYear}
          requestedMonth={fiscalMonth}
        />
      ) : null}

      {activeTab === "mei" ? (
        <MeiTab
          orgId={session.orgId}
          clanId={clan.id}
          canManage={canManageFiscalPortfolio(clanFacts)}
          requestedYear={meiYear}
        />
      ) : null}

      {activeTab === "installments" ? (
        <FiscalInstallmentTab
          orgId={session.orgId}
          clanId={clan.id}
          canManage={canManageFiscalPortfolio(clanFacts)}
          requestedYear={fiscalYear}
          requestedMonth={fiscalMonth}
        />
      ) : null}

      {activeTab === "fees" ? (
        <OfficeFeeTab
          orgId={session.orgId}
          clanId={clan.id}
          viewerId={session.user.id}
          canManage={canManageFiscalPortfolio(clanFacts)}
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
    </div>
  );
}
