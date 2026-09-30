import "server-only";

import { and, eq, or } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * A missão é governada por um Fluxo Societário?
 *
 * O vínculo mora no Fluxo (`processing_task_id` / `informative_task_id`), então
 * a busca é reversa — os dois índices únicos parciais a tornam barata. Existe
 * como helper porque TODO caminho que autoriza transição de missão precisa
 * deste fato (web, Telegram, MCP): uma cópia esquecida num deles reabre o
 * desvio que deixava o Fluxo parado enquanto a missão esperava aprovação.
 */
export async function isTaskManagedByCompanyFlow(
  tx: OrgTx,
  orgId: string,
  taskId: string,
): Promise<boolean> {
  const [flow] = await tx
    .select({ id: schema.companyFlows.id })
    .from(schema.companyFlows)
    .where(
      and(
        eq(schema.companyFlows.orgId, orgId),
        or(
          eq(schema.companyFlows.processingTaskId, taskId),
          eq(schema.companyFlows.informativeTaskId, taskId),
        ),
      ),
    )
    .limit(1);
  return Boolean(flow);
}
