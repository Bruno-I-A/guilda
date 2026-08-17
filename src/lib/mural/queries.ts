import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * Quantos avisos ativos exigem a confirmação DESTA pessoa e ainda não foram
 * confirmados. Alimenta o badge da navegação. O userId vem sempre da sessão.
 */
export async function countPendingNoticeAcks(
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await withOrgTx(orgId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.guildNotices)
      .leftJoin(
        schema.guildNoticeReads,
        and(
          eq(schema.guildNoticeReads.orgId, schema.guildNotices.orgId),
          eq(schema.guildNoticeReads.noticeId, schema.guildNotices.id),
          eq(schema.guildNoticeReads.userId, userId),
        ),
      )
      .where(
        and(
          eq(schema.guildNotices.orgId, orgId),
          eq(schema.guildNotices.requiresAck, true),
          isNull(schema.guildNotices.archivedAt),
          isNull(schema.guildNoticeReads.id),
        ),
      ),
  );
  return row?.total ?? 0;
}
