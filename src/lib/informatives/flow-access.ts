import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canPrepareCompanyFlowInformative } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import { holdsClanDuty } from "@/lib/clans/duties";
import { SOCIETARIO_CLAN_SLUG } from "@/lib/clans/rules";

/** A atribuição do clã e a missão só autorizam o Informativo do seu Fluxo. */
export async function canAccessCompanyFlowInformative(
  tx: OrgTx,
  actor: { orgId: string; userId: string; role: OrgRole },
  target: { flowId?: string; informativeId?: string },
): Promise<boolean> {
  const targetCondition = target.flowId
    ? eq(schema.companyFlows.id, target.flowId)
    : target.informativeId
      ? eq(schema.companyFlows.informativeId, target.informativeId)
      : null;
  if (!targetCondition) return false;

  const [row] = await tx
    .select({
      clanId: schema.companyFlows.societarioClanId,
      taskAssigneeId: schema.tasks.assigneeId,
    })
    .from(schema.companyFlows)
    .innerJoin(schema.clans, and(
      eq(schema.clans.orgId, schema.companyFlows.orgId),
      eq(schema.clans.id, schema.companyFlows.societarioClanId),
    ))
    .leftJoin(schema.tasks, and(
      eq(schema.tasks.orgId, schema.companyFlows.orgId),
      eq(schema.tasks.id, schema.companyFlows.informativeTaskId),
    ))
    .where(and(
      eq(schema.companyFlows.orgId, actor.orgId),
      targetCondition,
      eq(schema.clans.active, true),
      eq(schema.clans.slug, SOCIETARIO_CLAN_SLUG),
    ))
    .limit(1);
  if (!row) return false;

  const [holdsInformativeDuty, membership] = await Promise.all([
    holdsClanDuty(tx, actor.orgId, row.clanId, actor.userId, "informative"),
    tx.query.clanMemberships.findFirst({
      where: and(
        eq(schema.clanMemberships.orgId, actor.orgId),
        eq(schema.clanMemberships.clanId, row.clanId),
        eq(schema.clanMemberships.userId, actor.userId),
      ),
      columns: { id: true },
    }),
  ]);
  return canPrepareCompanyFlowInformative({
    role: actor.role,
    holdsInformativeDuty,
    isInformativeTaskAssignee: Boolean(membership && row.taskAssigneeId === actor.userId),
  });
}
