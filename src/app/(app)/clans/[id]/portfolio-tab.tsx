import { and, asc, desc, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { fiscalProfileMissingFields } from "@/domain/fiscal-control";
import { summarizePortfolio } from "@/domain/fiscal-portfolio";

import type { ClanMemberView } from "./page";
import { FiscalControlTab } from "./fiscal-control-tab";
import { FiscalWorkspaceNav } from "./fiscal-workspace-nav";
import {
  PortfolioBoard,
  type PortfolioBucketView,
  type PortfolioClientView,
} from "./portfolio-board";

/**
 * A carteira do clã Fiscal: quais empresas estão sob responsabilidade de quem.
 *
 * A tela mostra a Guilda inteira de empresas — inclusive as que ninguém pegou,
 * que são o motivo de a tela existir. Empresa inativa só aparece se ainda
 * estiver presa a alguém, para poder ser limpa.
 */
export async function PortfolioTab({
  orgId,
  clanId,
  memberships,
  viewerId,
  canManage,
  requestedView,
  requestedYear,
  requestedMonth,
}: {
  orgId: string;
  clanId: string;
  memberships: readonly ClanMemberView[];
  viewerId: string;
  canManage: boolean;
  requestedView?: string;
  requestedYear?: string;
  requestedMonth?: string;
}) {
  const view = requestedView === "control" ? "control" : "portfolio";
  if (view === "control") {
    return (
      <div className="grid gap-4">
        <FiscalWorkspaceNav clanId={clanId} active="control" />
        <FiscalControlTab
          orgId={orgId}
          clanId={clanId}
          viewerId={viewerId}
          canManage={canManage}
          memberships={memberships}
          requestedYear={requestedYear}
          requestedMonth={requestedMonth}
        />
      </div>
    );
  }

  const { rows, historyRows } = await withOrgTx(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        taxRegime: schema.clients.taxRegime,
        active: schema.clients.active,
        holderId: schema.fiscalPortfolios.userId,
        holderName: schema.user.name,
        pendingFiscalAssignment: schema.clients.pendingFiscalAssignment,
        pendingFiscalNote: schema.clients.pendingFiscalNote,
        suggestedFiscalOwnerId: schema.clients.suggestedFiscalOwnerId,
        profileId: schema.fiscalClientProfiles.id,
        profileVersion: schema.fiscalClientProfiles.version,
        movementsApplicability:
          schema.fiscalClientProfiles.movementsApplicability,
        incomingApplicability:
          schema.fiscalClientProfiles.incomingApplicability,
        outgoingApplicability:
          schema.fiscalClientProfiles.outgoingApplicability,
        guideApplicability: schema.fiscalClientProfiles.guideApplicability,
        nfsApplicability: schema.fiscalClientProfiles.nfsApplicability,
        factorRApplicability:
          schema.fiscalClientProfiles.factorRApplicability,
        deliveryChannel: schema.fiscalClientProfiles.deliveryChannel,
        revenueReference: schema.fiscalClientProfiles.revenueReference,
        permanentNotes: schema.fiscalClientProfiles.permanentNotes,
      })
      .from(schema.clients)
      .leftJoin(
        schema.fiscalPortfolios,
        and(
          eq(schema.fiscalPortfolios.orgId, schema.clients.orgId),
          eq(schema.fiscalPortfolios.clientId, schema.clients.id),
        ),
      )
      .leftJoin(schema.user, eq(schema.user.id, schema.fiscalPortfolios.userId))
      .leftJoin(
        schema.fiscalClientProfiles,
        and(
          eq(schema.fiscalClientProfiles.orgId, schema.clients.orgId),
          eq(schema.fiscalClientProfiles.clientId, schema.clients.id),
        ),
      )
      .where(eq(schema.clients.orgId, orgId))
      .orderBy(asc(schema.clients.name));

    const historyRows = await tx
      .select({
        id: schema.fiscalClientProfileEvents.id,
        clientId: schema.fiscalClientProfileEvents.clientId,
        version: schema.fiscalClientProfileEvents.version,
        eventType: schema.fiscalClientProfileEvents.eventType,
        changedFields: schema.fiscalClientProfileEvents.changedFields,
        actorName: schema.user.name,
        createdAt: schema.fiscalClientProfileEvents.createdAt,
      })
      .from(schema.fiscalClientProfileEvents)
      .leftJoin(schema.user, eq(schema.user.id, schema.fiscalClientProfileEvents.actorId))
      .where(eq(schema.fiscalClientProfileEvents.orgId, orgId))
      .orderBy(desc(schema.fiscalClientProfileEvents.createdAt))
      .limit(1000);
    return { rows, historyRows };
  });

  const relevant = rows.filter((row) => row.active || row.holderId);
  const memberIds = new Set(memberships.map((membership) => membership.userId));

  const summary = summarizePortfolio(
    memberships.map((membership) => ({
      userId: membership.userId,
      name: membership.name,
    })),
    relevant.map((row) => ({
      clientId: row.id,
      clientName: row.name,
      // Quem saiu do clã não é dono válido: a empresa precisa voltar à fila.
      holderId: row.holderId && memberIds.has(row.holderId) ? row.holderId : null,
    })),
  );

  const detailById = new Map(relevant.map((row) => [row.id, row]));
  const historyByClient = new Map<string, typeof historyRows>();
  for (const event of historyRows) {
    const current = historyByClient.get(event.clientId) ?? [];
    if (current.length < 5) current.push(event);
    historyByClient.set(event.clientId, current);
  }
  const toView = (clientId: string, clientName: string): PortfolioClientView => {
    const detail = detailById.get(clientId);
    const profileExists = Boolean(detail?.profileId);
    const movementsApplicability = detail?.movementsApplicability ?? "unknown";
    const incomingApplicability = detail?.incomingApplicability ?? "unknown";
    const outgoingApplicability = detail?.outgoingApplicability ?? "unknown";
    const guideApplicability = detail?.guideApplicability ?? "unknown";
    const nfsApplicability = detail?.nfsApplicability ?? "unknown";
    const factorRApplicability = detail?.factorRApplicability ?? "unknown";
    const deliveryChannel = detail?.deliveryChannel ?? null;
    return {
      id: clientId,
      name: clientName,
      taxRegime: detail?.taxRegime ?? "simples",
      active: detail?.active ?? true,
      profile: {
        id: detail?.profileId ?? null,
        version: detail?.profileVersion ?? 1,
        movementsApplicability,
        incomingApplicability,
        outgoingApplicability,
        guideApplicability,
        nfsApplicability,
        factorRApplicability,
        deliveryChannel,
        revenueReference: detail?.revenueReference ?? null,
        permanentNotes:
          detail?.permanentNotes ?? detail?.pendingFiscalNote ?? null,
        missingFields: fiscalProfileMissingFields({
          profileExists,
          movementsApplicability,
          incomingApplicability,
          outgoingApplicability,
          guideApplicability,
          nfsApplicability,
          factorRApplicability,
          deliveryChannel,
        }),
        history: (historyByClient.get(clientId) ?? []).map((event) => ({
          ...event,
          createdAt: event.createdAt.toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          }),
        })),
      },
    };
  };

  const buckets: PortfolioBucketView[] = summary.buckets
    .map((bucket) => ({
      userId: bucket.userId,
      name: bucket.name,
      isLeader:
        memberships.find((membership) => membership.userId === bucket.userId)
          ?.isLeader ?? false,
      clients: bucket.clients.map((client) =>
        toView(client.clientId, client.clientName),
      ),
    }))
    .sort(
      (left, right) =>
        right.clients.length - left.clients.length ||
        left.name.localeCompare(right.name, "pt-BR"),
    );

  // Empresas presas a quem não é mais do clã: aparecem à parte, com nome, para
  // o clã redistribuir — some da carteira da pessoa mas não some da tela.
  const strandedRows = relevant.filter(
    (row) => row.holderId && !memberIds.has(row.holderId),
  );
  const strandedIds = new Set(strandedRows.map((row) => row.id));
  const stranded = strandedRows.map((row) => ({
    client: toView(row.id, row.name),
    holderName: row.holderName ?? "pessoa removida",
  }));

  // Cliente novo (qualquer via de cadastro) sem carteira ainda: ganha bloco
  // próprio, à frente do "sem responsável" comum — é decisão da equipe, não
  // fila normal. A pessoa sugerida só é usada se ainda for do clã hoje.
  const memberNameById = new Map(
    memberships.map((membership) => [membership.userId, membership.name]),
  );
  const orphanClients = summary.orphans.filter(
    (client) => !strandedIds.has(client.clientId),
  );
  const awaiting = orphanClients
    .filter((client) => detailById.get(client.clientId)?.pendingFiscalAssignment)
    .map((client) => {
      const detail = detailById.get(client.clientId);
      const suggestedOwnerId = detail?.suggestedFiscalOwnerId ?? null;
      return {
        client: toView(client.clientId, client.clientName),
        note:
          detail?.permanentNotes ?? detail?.pendingFiscalNote ?? null,
        suggestedOwnerId:
          suggestedOwnerId && memberNameById.has(suggestedOwnerId)
            ? suggestedOwnerId
            : null,
      };
    });
  const awaitingIds = new Set(awaiting.map((row) => row.client.id));
  const orphans = orphanClients
    .filter((client) => !awaitingIds.has(client.clientId))
    .map((client) => toView(client.clientId, client.clientName));

  return (
    <div className="grid gap-4">
      <FiscalWorkspaceNav clanId={clanId} active="portfolio" />
      <PortfolioBoard
        clanId={clanId}
        canManage={canManage}
        members={memberships.map((membership) => ({
          userId: membership.userId,
          name: membership.name,
        }))}
        buckets={buckets}
        awaiting={awaiting}
        orphans={orphans}
        stranded={stranded}
        totalClients={relevant.length}
        averagePerMember={summary.averagePerMember}
      />
    </div>
  );
}
