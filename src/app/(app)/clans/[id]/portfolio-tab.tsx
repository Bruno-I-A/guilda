import { and, asc, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { summarizePortfolio } from "@/domain/fiscal-portfolio";

import type { ClanMemberView } from "./page";
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
  canManage,
}: {
  orgId: string;
  clanId: string;
  memberships: readonly ClanMemberView[];
  canManage: boolean;
}) {
  const rows = await withOrgTx(orgId, (tx) =>
    tx
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        taxRegime: schema.clients.taxRegime,
        active: schema.clients.active,
        holderId: schema.fiscalPortfolios.userId,
        holderName: schema.user.name,
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
      .where(eq(schema.clients.orgId, orgId))
      .orderBy(asc(schema.clients.name)),
  );

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
  const toView = (clientId: string, clientName: string): PortfolioClientView => {
    const detail = detailById.get(clientId);
    return {
      id: clientId,
      name: clientName,
      taxRegime: detail?.taxRegime ?? "simples",
      active: detail?.active ?? true,
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
  // o líder redistribuir — some da carteira da pessoa mas não some da tela.
  const strandedRows = relevant.filter(
    (row) => row.holderId && !memberIds.has(row.holderId),
  );
  const strandedIds = new Set(strandedRows.map((row) => row.id));
  const stranded = strandedRows.map((row) => ({
    client: toView(row.id, row.name),
    holderName: row.holderName ?? "pessoa removida",
  }));

  return (
    <PortfolioBoard
      clanId={clanId}
      canManage={canManage}
      members={memberships.map((membership) => ({
        userId: membership.userId,
        name: membership.name,
      }))}
      buckets={buckets}
      orphans={summary.orphans
        // Sem dono válido elas também caem em `orphans`; aqui saem, porque
        // ganharam bloco próprio com o nome de quem as deixou para trás.
        .filter((client) => !strandedIds.has(client.clientId))
        .map((client) => toView(client.clientId, client.clientName))}
      stranded={stranded}
      totalClients={relevant.length}
      averagePerMember={summary.averagePerMember}
    />
  );
}
