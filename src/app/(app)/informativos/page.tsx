import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { companyFlowInformativeText } from "@/domain/company-flow";
import { canHandleInformatives, isAdminRole } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { informativeDraftPayloadSchema } from "@/lib/ai/informative-schema";
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

  const { pendingDraft, clans, members, leadsAnyClan } = await withOrgTx(
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
        .select({ id: schema.clans.id, name: schema.clans.name })
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
        leadsAnyClan: leadership.length > 0,
      };
    },
  );

  const canHandle = canHandleInformatives({ role, leadsAnyClan });
  const flowForInformative = flowId && isAdminRole(role)
    ? await withOrgTx(session.orgId, async (tx) => {
        const [row] = await tx
          .select({ flow: schema.companyFlows, existingClientName: schema.clients.name })
          .from(schema.companyFlows)
          .leftJoin(
            schema.clients,
            and(
              eq(schema.clients.orgId, schema.companyFlows.orgId),
              eq(schema.clients.id, schema.companyFlows.existingClientId),
            ),
          )
          .where(
            and(
              eq(schema.companyFlows.orgId, session.orgId),
              eq(schema.companyFlows.id, flowId),
              eq(schema.companyFlows.status, "informative_drafting"),
              isNull(schema.companyFlows.informativeId),
            ),
          );
        return row ?? null;
      })
    : null;
  const initialFlowText = flowForInformative
    ? companyFlowInformativeText({
        ...flowForInformative.flow,
        existingClientName: flowForInformative.existingClientName ?? null,
      })
    : "";

  // O payload é JSONB: validar antes de renderizar, nunca confiar na forma.
  let draft: DraftView | null = null;
  if (pendingDraft) {
    const parsed = informativeDraftPayloadSchema.safeParse(pendingDraft.payload);
    if (parsed.success && pendingDraft.expiresAt > new Date()) {
      draft = {
        informativeId: pendingDraft.id,
        expiresAt: pendingDraft.expiresAt.toISOString(),
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
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-wide">
          Informativos
        </h1>
        <p className="text-muted-foreground">
          Cole o informativo, confira o destino de cada linha e confirme. Nada é
          criado antes da sua confirmação.
        </p>
      </div>

      {canHandle ? (
        <InformativePanel
          draft={draft}
          clans={clans}
          members={members}
          initialSourceText={initialFlowText}
          flowId={flowForInformative?.flow.id}
        />
      ) : (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Processar informativo é função de líder de clã, admin ou owner.
        </p>
      )}
    </div>
  );
}
