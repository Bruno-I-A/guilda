import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { TaskStatus } from "@/domain/task-state";
import { CLOSING_YEAR_XP } from "@/domain/xp";

/** Mantém a campanha anual consistente com a missão que materializa o fechamento. */
export async function syncAnnualClosingFromTask(
  tx: OrgTx,
  input: {
    task: schema.Task;
    fromStatus: TaskStatus;
    toStatus: TaskStatus;
    changedAt: Date;
  },
): Promise<void> {
  const { task } = input;
  if (!task.closingYearId) return;

  if (input.toStatus === "completed") {
    const closed = await tx
      .update(schema.accountingClosingYears)
      .set({
        closedAt: input.changedAt,
        closedBy: task.assigneeId,
        closedByTaskId: task.id,
        updatedAt: input.changedAt,
      })
      .where(
        and(
          eq(schema.accountingClosingYears.id, task.closingYearId),
          eq(schema.accountingClosingYears.orgId, task.orgId),
          isNull(schema.accountingClosingYears.closedAt),
        ),
      )
      .returning({ id: schema.accountingClosingYears.id });

    if (closed.length > 0) {
      await tx
        .insert(schema.xpLedger)
        .values({
          orgId: task.orgId,
          userId: task.assigneeId,
          closingYearId: task.closingYearId,
          amount: CLOSING_YEAR_XP,
          reason: "closing_year_closed",
        })
        .onConflictDoNothing();
    }
    return;
  }

  if (input.fromStatus === "completed") {
    await tx
      .update(schema.accountingClosingYears)
      .set({
        closedAt: null,
        closedBy: null,
        closedByTaskId: null,
        defisCompletedAt: null,
        defisCompletedBy: null,
        updatedAt: input.changedAt,
      })
      .where(
        and(
          eq(schema.accountingClosingYears.id, task.closingYearId),
          eq(schema.accountingClosingYears.orgId, task.orgId),
          eq(schema.accountingClosingYears.closedByTaskId, task.id),
        ),
      );
  }
}
