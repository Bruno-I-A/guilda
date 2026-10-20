import "server-only";

import { and, eq, or } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

export type CompanyFlowTaskLink = {
  flowId: string;
  flowStatus: (typeof schema.companyFlows.$inferSelect)["status"];
  kind: "managed" | "rh_verification";
};

/**
 * Qual é o papel da missão dentro de um Fluxo Societário?
 *
 * As missões de processamento/Informativo são governadas pelo Fluxo e apenas
 * refletem o avanço dele. A verificação preventiva da baixa é diferente: o RH
 * trabalha e confirma pela própria missão, e essa conclusão libera o
 * Societário. Como todos os vínculos moram no Fluxo, a busca é reversa.
 */
export async function findCompanyFlowTaskLink(
  tx: OrgTx,
  orgId: string,
  taskId: string,
): Promise<CompanyFlowTaskLink | null> {
  const [flow] = await tx
    .select({
      id: schema.companyFlows.id,
      status: schema.companyFlows.status,
      processingTaskId: schema.companyFlows.processingTaskId,
      informativeTaskId: schema.companyFlows.informativeTaskId,
      rhVerificationTaskId: schema.companyFlows.rhVerificationTaskId,
    })
    .from(schema.companyFlows)
    .where(
      and(
        eq(schema.companyFlows.orgId, orgId),
        or(
          eq(schema.companyFlows.processingTaskId, taskId),
          eq(schema.companyFlows.informativeTaskId, taskId),
          eq(schema.companyFlows.rhVerificationTaskId, taskId),
        ),
      ),
    )
    .limit(1);
  if (!flow) return null;
  return {
    flowId: flow.id,
    flowStatus: flow.status,
    kind:
      flow.rhVerificationTaskId === taskId
        ? "rh_verification"
        : "managed",
  };
}

/** Mantido para os pontos que só precisam bloquear gestão fora do Fluxo. */
export async function isTaskManagedByCompanyFlow(
  tx: OrgTx,
  orgId: string,
  taskId: string,
): Promise<boolean> {
  return (await findCompanyFlowTaskLink(tx, orgId, taskId))?.kind === "managed";
}
