import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  canClaimCompanyFlow,
  canCreateCompanyFlow,
  canPrepareCompanyFlowInformative,
  canReturnCompanyFlow,
} from "@/domain/guild-permissions";
import { holdsClanDuty } from "@/lib/clans/duties";
import { isActiveClanMember } from "@/lib/clans/facts";

import {
  CompanyFlowBoard,
  type CompanyFlowView,
} from "./company-flow-board";

export async function CompanyFlowTab({
  orgId,
  clanId,
  viewerId,
  role,
  leadsThisClan,
}: {
  orgId: string;
  clanId: string;
  viewerId: string;
  role: "owner" | "admin" | "member";
  leadsThisClan: boolean;
}) {
  const { flows, events, clients, viewerIsCorporateMember, holdsInformativeDuty } = await withOrgTx(orgId, async (tx) => {
    const [flows, viewerIsCorporateMember, clients] = await Promise.all([
      tx
        .select({
          flow: schema.companyFlows,
          existingClientName: schema.clients.name,
          assignedName: schema.user.name,
          secretId: schema.companyFlowSecrets.id,
          rhVerificationTaskStatus: schema.tasks.status,
          rhVerificationCompletedAt: schema.tasks.completedAt,
          createdByName: schema.user.name,
        })
        .from(schema.companyFlows)
        .leftJoin(
          schema.clients,
          and(
            eq(schema.clients.orgId, schema.companyFlows.orgId),
            eq(schema.clients.id, schema.companyFlows.existingClientId),
          ),
        )
        .leftJoin(schema.user, eq(schema.user.id, schema.companyFlows.assignedTo))
        .leftJoin(
          schema.companyFlowSecrets,
          and(
            eq(schema.companyFlowSecrets.orgId, schema.companyFlows.orgId),
            eq(schema.companyFlowSecrets.flowId, schema.companyFlows.id),
          ),
        )
        .leftJoin(
          schema.tasks,
          and(
            eq(schema.tasks.orgId, schema.companyFlows.orgId),
            eq(schema.tasks.id, schema.companyFlows.rhVerificationTaskId),
          ),
        )
        .where(
          and(
            eq(schema.companyFlows.orgId, orgId),
            eq(schema.companyFlows.societarioClanId, clanId),
          ),
        )
        .orderBy(desc(schema.companyFlows.updatedAt)),
      isActiveClanMember(tx, orgId, clanId, viewerId),
      // Só o que o seletor precisa. A ficha completa (QSA, endereço, CNAEs
      // secundários, histórico de regime — cinco colunas JSONB por empresa) é
      // carregada sob demanda para a empresa escolhida, em
      // `loadCompanyFlowClientRecord`. Mandar tudo de todas as empresas ativas
      // a cada abertura da aba era o custo de abrir o Fluxo.
      tx
        .select({
          id: schema.clients.id,
          name: schema.clients.name,
          cnpj: schema.clients.cnpj,
          taxRegime: schema.clients.taxRegime,
        })
        .from(schema.clients)
        .where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.active, true)))
        .orderBy(asc(schema.clients.name)),
    ]);

    const creatorIds = [...new Set(flows.map((row) => row.flow.createdBy))];
    const creatorNames = creatorIds.length > 0
      ? await tx
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, creatorIds))
      : [];
    const namesById = new Map(creatorNames.map((person) => [person.id, person.name]));
    const flowIds = flows.map((row) => row.flow.id);
    const events = flowIds.length > 0
      ? await tx
          .select({
            id: schema.companyFlowEvents.id,
            flowId: schema.companyFlowEvents.flowId,
            eventType: schema.companyFlowEvents.eventType,
            note: schema.companyFlowEvents.note,
            actorName: schema.user.name,
            createdAt: schema.companyFlowEvents.createdAt,
          })
          .from(schema.companyFlowEvents)
          .innerJoin(schema.user, eq(schema.user.id, schema.companyFlowEvents.actorId))
          .where(and(eq(schema.companyFlowEvents.orgId, orgId), inArray(schema.companyFlowEvents.flowId, flowIds)))
          .orderBy(desc(schema.companyFlowEvents.createdAt))
      : [];

    return {
      flows: flows.map((row) => ({ ...row, createdByName: namesById.get(row.flow.createdBy) ?? "Pessoa removida" })),
      events,
      clients,
      viewerIsCorporateMember,
      holdsInformativeDuty: await holdsClanDuty(tx, orgId, clanId, viewerId, "informative"),
    };
  });

  const historyByFlow = new Map<string, typeof events>();
  for (const event of events) {
    const history = historyByFlow.get(event.flowId) ?? [];
    if (history.length < 12) history.push(event);
    historyByFlow.set(event.flowId, history);
  }
  const actorFacts = {
    role,
    leadsThisClan,
    isActiveClanMember: viewerIsCorporateMember,
    isActiveCorporateMember: viewerIsCorporateMember,
    holdsInformativeDuty,
  };
  const rows: CompanyFlowView[] = flows.map((row) => ({
    ...row.flow,
    existingClientName: row.existingClientName ?? null,
    assignedName: row.assignedName ?? null,
    createdByName: row.createdByName,
    createdAt: row.flow.createdAt.toISOString(),
    updatedAt: row.flow.updatedAt.toISOString(),
    returnedAt: row.flow.returnedAt?.toISOString() ?? null,
    completedAt: row.flow.completedAt?.toISOString() ?? null,
    rhVerificationTaskStatus: row.rhVerificationTaskStatus ?? null,
    rhVerificationCompletedAt: row.rhVerificationCompletedAt?.toISOString() ?? null,
    hasGovSecret: Boolean(row.secretId),
    isAssignedToViewer: row.flow.assignedTo === viewerId,
    canClaim: canClaimCompanyFlow({
      ...actorFacts,
      isAssignedToFlow: row.flow.assignedTo === viewerId,
    }),
    canReturn: canReturnCompanyFlow({
      ...actorFacts,
      isAssignedToFlow: row.flow.assignedTo === viewerId,
    }),
    canPrepareInformative: canPrepareCompanyFlowInformative(actorFacts),
    canCancel: canCreateCompanyFlow(actorFacts),
    canDelete: canCreateCompanyFlow(actorFacts),
    history: (historyByFlow.get(row.flow.id) ?? []).map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  }));

  return (
    <CompanyFlowBoard
      clanId={clanId}
      canCreate={canCreateCompanyFlow(actorFacts)}
      clients={clients}
      rows={rows}
    />
  );
}
