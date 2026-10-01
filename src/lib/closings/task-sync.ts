import "server-only";

import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  TASK_STATUSES_THAT_CLOSE_PERIOD,
  taskClosesPeriod,
} from "@/domain/closing-from-task";
import type { TaskStatus } from "@/domain/task-state";
import {
  lockClosingYear,
  reconcileClosingYearLedger,
} from "./closing-year-xp";
import { updateClosingPeriod } from "./period-writes";
import { completedTaskAssigneeId } from "./task-sync-guards";

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
  if (input.toStatus === "completed") {
    completedTaskAssigneeId(task, "completed");
  }

  if (task.closingId) {
    // Um período acompanha se o TRABALHO está feito, não se a missão foi
    // aprovada: entregue aguardando aprovação já é balanço pronto, e é assim
    // que o período nasce quando gerado pela missão. Tratar só `completed`
    // deixava o período fechado quando a entrega era devolvida para ajuste —
    // o trabalho voltava a ser feito e o fechamento continuava dizendo que
    // estava pronto.
    const entrouEmTrabalhoFeito = taskClosesPeriod(input.toStatus);
    const saiuDeTrabalhoFeito =
      taskClosesPeriod(input.fromStatus) && !entrouEmTrabalhoFeito;

    if (entrouEmTrabalhoFeito) {
      const completedBy =
        input.toStatus === "completed"
          ? completedTaskAssigneeId(task, "completed")
          : task.assigneeId;
      await updateClosingPeriod(tx, {
        orgId: task.orgId,
        closingId: task.closingId,
        where: ne(schema.accountingClosings.status, "completed"),
        set: {
          status: "completed",
          completedBy,
          completedAt: input.changedAt,
          completedByTaskId: task.id,
          updatedAt: input.changedAt,
        },
      });
    } else if (saiuDeTrabalhoFeito) {
      const otherCompleted = await tx.query.tasks.findFirst({
        where: and(
          eq(schema.tasks.orgId, task.orgId),
          eq(schema.tasks.closingId, task.closingId),
          inArray(schema.tasks.status, [...TASK_STATUSES_THAT_CLOSE_PERIOD]),
          isNotNull(schema.tasks.assigneeId),
          ne(schema.tasks.id, task.id),
        ),
        columns: { id: true, assigneeId: true, completedAt: true },
      });
      const replacement = otherCompleted?.assigneeId ? otherCompleted : null;
      await updateClosingPeriod(tx, {
        orgId: task.orgId,
        closingId: task.closingId,
        where: eq(schema.accountingClosings.completedByTaskId, task.id),
        set: replacement
          ? {
              completedBy: replacement.assigneeId,
              completedAt: replacement.completedAt ?? input.changedAt,
              completedByTaskId: replacement.id,
              updatedAt: input.changedAt,
            }
          : {
              status: "pending",
              completedBy: null,
              completedAt: null,
              completedByTaskId: null,
              updatedAt: input.changedAt,
            },
      });
    }
  }

  if (!task.closingYearId) return;

  if (input.toStatus === "completed") {
    const closedBy = completedTaskAssigneeId(task, "completed");
    const [closed] = await tx
      .update(schema.accountingClosingYears)
      .set({
        closedAt: input.changedAt,
        closedBy,
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
      .returning({ closedBy: schema.accountingClosingYears.closedBy });

    await reconcileClosingYearLedger(tx, {
      orgId: task.orgId,
      closingYearId: task.closingYearId,
      closedBy: await settledClosingYearOwner(
        tx,
        task.orgId,
        task.closingYearId,
        closed,
      ),
    });
    return;
  }

  if (input.fromStatus === "completed") {
    const otherCompleted = await tx.query.tasks.findFirst({
      where: and(
        eq(schema.tasks.orgId, task.orgId),
        eq(schema.tasks.closingYearId, task.closingYearId),
        eq(schema.tasks.status, "completed"),
        isNotNull(schema.tasks.assigneeId),
        ne(schema.tasks.id, task.id),
      ),
      columns: { id: true, assigneeId: true, completedAt: true },
    });
    const replacement = otherCompleted?.assigneeId ? otherCompleted : null;
    const [reopened] = await tx
      .update(schema.accountingClosingYears)
      .set(
        replacement
          ? {
              closedAt: replacement.completedAt ?? input.changedAt,
              closedBy: replacement.assigneeId,
              closedByTaskId: replacement.id,
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
      )
      .returning({ closedBy: schema.accountingClosingYears.closedBy });

    // Este é o lado que faltava: o ano reabria e o crédito ficava com quem
    // teve o trabalho desfeito. A reconciliação estorna quem perdeu o ano e,
    // quando a missão substituta assume, credita quem ganhou — na mesma
    // passada, sem UPDATE no ledger.
    await reconcileClosingYearLedger(tx, {
      orgId: task.orgId,
      closingYearId: task.closingYearId,
      closedBy: await settledClosingYearOwner(
        tx,
        task.orgId,
        task.closingYearId,
        reopened,
      ),
    });
  }
}

/**
 * Quem ficou como dono do fechamento depois que o UPDATE do ano rodou.
 *
 * O UPDATE devolve linha (e a trava) quando afeta o ano. Quando não afeta, o
 * ano pertence a outra missão e precisa ser RELIDO com lock: a reconciliação
 * soma o ledger sem lock próprio e conta com a linha do ano já travada nesta
 * transação. Não assumir o `closedBy` que se tentou gravar — o gravado é o
 * que manda.
 */
async function settledClosingYearOwner(
  tx: OrgTx,
  orgId: string,
  closingYearId: string,
  updated: { closedBy: string | null } | undefined,
): Promise<string | null> {
  if (updated) return updated.closedBy;
  const row = await lockClosingYear(tx, { orgId, closingYearId });
  return row?.closedBy ?? null;
}
