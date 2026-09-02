import "server-only";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * Quantas missões estão esperando uma ação DESTA pessoa. Alimenta o selo da
 * navegação, no mesmo desenho do contador do Mural.
 *
 * "Esperando" é deliberadamente estreito — três situações:
 *
 *  1. atribuída a ela e ainda não iniciada (`pending`) ou devolvida para
 *     ajuste (`rejected`);
 *  2. criada por ela e aguardando a sua aprovação (`awaiting_approval`);
 *  3. sem dono, `pending`, num clã que ela lidera — a fila de distribuição.
 *
 * `in_progress` NÃO conta: quem começou já sabe que tem trabalho, e selo que
 * nunca zera é selo que a pessoa aprende a ignorar. É o mesmo motivo pelo qual
 * o verificador de RLS não pode acusar falha falsa.
 *
 * O userId vem sempre da sessão, nunca do cliente.
 */
export async function countMissionsAwaitingUser(
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await withOrgTx(orgId, (tx) => {
    const clasQueLidera = tx
      .select({ clanId: schema.clanMemberships.clanId })
      .from(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, orgId),
          eq(schema.clanMemberships.userId, userId),
          eq(schema.clanMemberships.isLeader, true),
        ),
      );

    return tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.orgId, orgId),
          or(
            and(
              eq(schema.tasks.assigneeId, userId),
              inArray(schema.tasks.status, ["pending", "rejected"]),
            ),
            and(
              eq(schema.tasks.creatorId, userId),
              eq(schema.tasks.status, "awaiting_approval"),
            ),
            and(
              isNull(schema.tasks.assigneeId),
              eq(schema.tasks.status, "pending"),
              inArray(schema.tasks.clanId, clasQueLidera),
            ),
          ),
        ),
      );
  });
  return row?.total ?? 0;
}
