import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { type OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * A baixa mantém a empresa ativa enquanto existem missões pendentes. O lock
 * da empresa serializa as conclusões simultâneas da mesma baixa: a última
 * delas sempre enxerga as anteriores concluídas antes de inativar o cliente.
 */
export async function deactivateClosureClientWhenTasksFinish(
  tx: OrgTx,
  input: { orgId: string; informativeId: string | null },
): Promise<boolean> {
  if (!input.informativeId) return false;

  const [flow] = await tx
    .select({ existingClientId: schema.companyFlows.existingClientId })
    .from(schema.companyFlows)
    .where(
      and(
        eq(schema.companyFlows.orgId, input.orgId),
        eq(schema.companyFlows.informativeId, input.informativeId),
        eq(schema.companyFlows.kind, "closure"),
      ),
    )
    .for("update");
  if (!flow?.existingClientId) return false;

  const [client] = await tx
    .select({ id: schema.clients.id, active: schema.clients.active })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.orgId, input.orgId),
        eq(schema.clients.id, flow.existingClientId),
      ),
    )
    .for("update");
  if (!client?.active) return false;

  const [unfinished] = await tx
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.orgId, input.orgId),
        eq(schema.tasks.informativeId, input.informativeId),
        ne(schema.tasks.status, "completed"),
      ),
    )
    .limit(1);
  if (unfinished) return false;

  const [deactivated] = await tx
    .update(schema.clients)
    .set({ active: false })
    .where(
      and(
        eq(schema.clients.orgId, input.orgId),
        eq(schema.clients.id, client.id),
        eq(schema.clients.active, true),
      ),
    )
    .returning({ id: schema.clients.id });
  return Boolean(deactivated);
}
