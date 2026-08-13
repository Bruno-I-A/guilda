import "server-only";

import { and, eq, isNull, ne } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { TaskStatus } from "@/domain/task-state";
import { CLOSING_YEAR_XP } from "@/domain/xp";

/** Mantém períodos e encerramentos anuais consistentes com a missão vinculada. */
export async function syncClosingFromTask(
  tx: OrgTx,
  input: {
    task: schema.Task;
    fromStatus: TaskStatus;
    toStatus: TaskStatus;
    changedAt: Date;
  },
): Promise<void> {
  const { task } = input;

  if (task.closingId) {
    if (input.toStatus === "completed") {
      await tx
        .update(schema.accountingClosings)
        .set({
          status: "completed",
          completedBy: task.assigneeId,
          completedAt: input.changedAt,
          completedByTaskId: task.id,
          updatedAt: input.changedAt,
        })
        .where(
          and(
            eq(schema.accountingClosings.id, task.closingId),
            eq(schema.accountingClosings.orgId, task.orgId),
            ne(schema.accountingClosings.status, "completed"),
          ),
        );
    } else if (input.fromStatus === "completed") {
      const otherCompleted = await tx.query.tasks.findFirst({
        where: and(
          eq(schema.tasks.orgId, task.orgId),
          eq(schema.tasks.closingId, task.closingId),
          eq(schema.tasks.status, "completed"),
          ne(schema.tasks.id, task.id),
        ),
        columns: { id: true, assigneeId: true, completedAt: true },
      });
      await tx
        .update(schema.accountingClosings)
        .set(
          otherCompleted
            ? {
                completedBy: otherCompleted.assigneeId,
                completedAt: otherCompleted.completedAt ?? input.changedAt,
                completedByTaskId: otherCompleted.id,
                updatedAt: input.changedAt,
              }
            : {
                status: "pending",
                completedBy: null,
                completedAt: null,
                completedByTaskId: null,
                updatedAt: input.changedAt,
              },
        )
        .where(
          and(
            eq(schema.accountingClosings.id, task.closingId),
            eq(schema.accountingClosings.orgId, task.orgId),
            eq(schema.accountingClosings.completedByTaskId, task.id),
          ),
        );
    }
  }

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
    const otherCompleted = await tx.query.tasks.findFirst({
      where: and(
        eq(schema.tasks.orgId, task.orgId),
        eq(schema.tasks.closingYearId, task.closingYearId),
        eq(schema.tasks.status, "completed"),
        ne(schema.tasks.id, task.id),
      ),
      columns: { id: true, assigneeId: true, completedAt: true },
    });
    await tx
      .update(schema.accountingClosingYears)
      .set(
        otherCompleted
          ? {
              closedAt: otherCompleted.completedAt ?? input.changedAt,
              closedBy: otherCompleted.assigneeId,
              closedByTaskId: otherCompleted.id,
              updatedAt: input.changedAt,
            }
          : {
              closedAt: null,
              closedBy: null,
              closedByTaskId: null,
              defisCompletedAt: null,
              defisCompletedBy: null,
              updatedAt: input.changedAt,
            },
      )
      .where(
        and(
          eq(schema.accountingClosingYears.id, task.closingYearId),
          eq(schema.accountingClosingYears.orgId, task.orgId),
          eq(schema.accountingClosingYears.closedByTaskId, task.id),
        ),
      );
  }
}
