import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  amendmentRequiresExternalRegistrationTask,
  companyFlowAmendmentChanges,
  companyFlowDisplayName,
} from "@/domain/company-flow";
import { canHandleInformatives } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { informativeDraftPayloadSchema } from "@/lib/ai/informative-schema";
import { companyFlowMissionPresets } from "@/lib/informatives/mission-presets";
import { informativeTasksRevision } from "@/lib/informatives/revision";
import { canAccessCompanyFlowInformative } from "@/lib/informatives/flow-access";
import { getActiveMember, requireOrgSession } from "@/lib/session";

import { InformativePanel, type DraftView } from "./informative-panel";

export const metadata: Metadata = { title: "Informativos" };

export default async function InformativosPage({
  searchParams,
}: {
  searchParams: Promise<{ flowId?: string }>;
}) {
  const session = await requireOrgSession();
  const viewer = await getActiveMember();
  if (!viewer) redirect("/onboarding");
  const role = viewer.role as OrgRole;
  const { flowId } = await searchParams;

  const { pendingDraft, clans, members, clients, leadsAnyClan } = await withOrgTx(
    session.orgId,
    async (tx) => {
      const draftRow = await tx
        .select()
        .from(schema.informatives)
        .where(
          and(
            eq(schema.informatives.orgId, session.orgId),
            eq(schema.informatives.requestedBy, session.user.id),
            eq(schema.informatives.status, "pending"),
          ),
        )
        .orderBy(desc(schema.informatives.createdAt))
        .limit(1);
      const clanRows = await tx
        .select({ id: schema.clans.id, name: schema.clans.name, slug: schema.clans.slug })
        .from(schema.clans)
        .where(
          and(
            eq(schema.clans.orgId, session.orgId),
            eq(schema.clans.active, true),
          ),
        )
        .orderBy(asc(schema.clans.name));
      const memberRows = await tx
        .select({ userId: schema.member.userId, name: schema.user.name })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, session.orgId))
        .orderBy(asc(schema.user.name));
      const clientRows = await tx
        .select({ id: schema.clients.id, name: schema.clients.name, cnpj: schema.clients.cnpj, taxRegime: schema.clients.taxRegime })
        .from(schema.clients)
        .where(and(eq(schema.clients.orgId, session.orgId), eq(schema.clients.active, true)))
        .orderBy(asc(schema.clients.name));
      const leadership = await tx
        .select({ id: schema.clanMemberships.id })
        .from(schema.clanMemberships)
        .innerJoin(
          schema.clans,
          and(
            eq(schema.clans.id, schema.clanMemberships.clanId),
            eq(schema.clans.orgId, schema.clanMemberships.orgId),
          ),
        )
        .where(
          and(
            eq(schema.clanMemberships.orgId, session.orgId),
            eq(schema.clanMemberships.userId, session.user.id),
            eq(schema.clanMemberships.isLeader, true),
            eq(schema.clans.active, true),
          ),
        )
        .limit(1);

      return {
        pendingDraft: draftRow[0] ?? null,
        clans: clanRows,
        members: memberRows,
        clients: clientRows,
        leadsAnyClan: leadership.length > 0,
      };
    },
  );

  const validFlowId = flowId && z.uuid().safeParse(flowId).success ? flowId : null;
  const canAccessFlow = validFlowId
    ? await withOrgTx(session.orgId, (tx) =>
        canAccessCompanyFlowInformative(tx, {
          orgId: session.orgId, userId: session.user.id, role,
        }, { flowId: validFlowId }),
      )
    : false;
  const canHandle = canHandleInformatives({ role, leadsAnyClan }) || canAccessFlow;
  const flowForInformative = validFlowId && canAccessFlow
    ? await withOrgTx(session.orgId, async (tx) => {
        const [row] = await tx
          .select({
            flow: schema.companyFlows,
            informative: schema.informatives,
            existingClientName: schema.clients.name,
            existingClientCnpj: schema.clients.cnpj,
            existingClientTaxRegime: schema.clients.taxRegime,
            rhVerificationTaskStatus: schema.tasks.status,
          })
          .from(schema.companyFlows)
          .leftJoin(
            schema.informatives,
            and(
              eq(schema.informatives.orgId, schema.companyFlows.orgId),
              eq(schema.informatives.id, schema.companyFlows.informativeId),
            ),
          )
          .leftJoin(
            schema.clients,
            and(
              eq(schema.clients.orgId, schema.companyFlows.orgId),
              eq(schema.clients.id, schema.companyFlows.existingClientId),
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
              eq(schema.companyFlows.orgId, session.orgId),
              eq(schema.companyFlows.id, validFlowId),
              or(
                and(
                  eq(schema.companyFlows.status, "informative_drafting"),
                  isNull(schema.companyFlows.informativeId),
                ),
                and(
                  eq(schema.companyFlows.status, "completed"),
                  eq(schema.informatives.status, "pending"),
                  eq(schema.informatives.requestedBy, session.user.id),
                ),
              ),
            ),
          );
        return row ?? null;
      })
    : null;
  const flowInput = flowForInformative
    ? {
        ...flowForInformative.flow,
        existingClientName: flowForInformative.existingClientName ?? null,
        existingClientCnpj: flowForInformative.existingClientCnpj ?? null,
        existingClientTaxRegime: flowForInformative.existingClientTaxRegime ?? null,
        rhVerificationConfirmed:
          Boolean(flowForInformative.flow.rhVerificationTaskId) &&
          flowForInformative.rhVerificationTaskStatus === "completed",
      }
    : null;
  const amendmentSummary = flowInput?.kind === "amendment"
    ? {
        companyName: flowInput.existingClientName ?? "Empresa não informada",
        changes: companyFlowAmendmentChanges(flowInput),
        observations: flowInput.requestDetails,
        hasExternalRegistrationTask:
          amendmentRequiresExternalRegistrationTask(flowInput),
      }
    : null;
  const flowMissionPresets = flowInput
    ? companyFlowMissionPresets({
        kind: flowInput.kind,
        amendmentRequiresExternalRegistration:
          amendmentRequiresExternalRegistrationTask(flowInput),
        rhVerificationConfirmed: flowInput.rhVerificationConfirmed,
        billingAmount: flowInput.billingAmount,
        billingDescription: flowInput.billingDescription,
      })
    : [];
  const flowSummary = flowInput
    ? {
        kind: flowInput.kind,
        companyName: companyFlowDisplayName(flowInput),
        observations: flowInput.requestDetails,
      }
    : null;

  // O payload é JSONB: validar antes de renderizar, nunca confiar na forma.
  let draft: DraftView | null = null;
  const selectedDraft = validFlowId ? flowForInformative?.informative : pendingDraft;
  if (selectedDraft) {
    const parsed = informativeDraftPayloadSchema.safeParse(selectedDraft.payload);
    if (parsed.success && selectedDraft.expiresAt > new Date()) {
      draft = {
        informativeId: selectedDraft.id,
        revision: informativeTasksRevision(parsed.data.tasks),
        expiresAt: selectedDraft.expiresAt.toISOString(),
        kind: parsed.data.kind,
        freeNotice: parsed.data.freeNotice,
        company: {
          legalName: parsed.data.company.legalName,
          cnpj: parsed.data.company.cnpj,
          taxRegime: parsed.data.company.taxRegime,
          createClient: parsed.data.company.createClient,
          cnaeDescription: parsed.data.company.cnaeDescription,
          openedAt: parsed.data.company.openedAt,
          pendingFiscalNote: parsed.data.company.pendingFiscalNote,
        },
        tasks: parsed.data.tasks.map((task, index) => ({
          index,
          title: task.title,
          description: task.description,
          assignmentType: task.assignmentType,
          clanId: task.clanId,
          clanName: task.clanName,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
          reason: "reason" in task ? task.reason : null,
        })),
        commitments: parsed.data.commitments.map((commitment) => ({
          clanName: commitment.clanName,
          title: commitment.title,
          cadence: commitment.cadence,
          notes: commitment.notes,
        })),
        observations: parsed.data.observations,
        unresolvedAssignees: parsed.data.unresolvedAssignees,
        warnings: parsed.data.warnings,
      };
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Informativos"
        description="Crie um aviso livre ou prepare missões por clã. Revise a prévia antes de publicar."
      />

      {canHandle && (!validFlowId || flowForInformative) ? (
        <InformativePanel
          key={flowForInformative?.flow.id ?? "informativo-geral"}
          draft={draft}
          clans={clans}
          members={members}
          clients={clients}
          flowId={flowForInformative?.flow.id}
          amendmentSummary={amendmentSummary}
          flowSummary={flowSummary}
          flowMissionPresets={flowMissionPresets}
          generalAccess={canHandleInformatives({ role, leadsAnyClan })}
          flowTaskId={flowForInformative?.flow.informativeTaskId}
          expiredDraftId={selectedDraft && !draft ? selectedDraft.id : null}
        />
      ) : (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {validFlowId && canAccessFlow
            ? "Este Fluxo não tem uma preparação disponível para você. Abra a missão para continuar."
            : "Processar informativo é função de líder de clã, admin ou owner, ou do responsável pelo Informativo deste Fluxo."}
        </p>
      )}
    </div>
  );
}
