import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { TaskStatus } from "@/domain/task-state";

/**
 * Mantém a ocorrência do compromisso em sincronia com a missão gerada a
 * partir dela — mesmo mecanismo de `syncClosingFromTask` nos fechamentos.
 *
 * Concluir a missão fecha a ocorrência; reverter a conclusão reabre. A
 * ocorrência também pode ser fechada à mão, sem missão nenhuma: por isso a
 * reabertura só desfaz o que ESTA missão fechou (`task_id` bate), nunca uma
 * conclusão feita por outra via.
 */
export async function syncCommitmentPeriodFromTask(
  tx: OrgTx,
  input: {
    task: schema.Task;
    fromStatus: TaskStatus;
    toStatus: TaskStatus;
    changedAt: Date;
  },
): Promise<void> {
  const { task } = input;
  if (!task.commitmentPeriodId) return;

  if (input.toStatus === "completed") {
    if (!task.assigneeId) {
      throw new Error(
        "Uma missão precisa estar atribuída a uma pessoa antes de concluir um compromisso.",
      );
    }
    await tx
      .update(schema.clientCommitmentPeriods)
      .set({
        completedBy: task.assigneeId,
        completedAt: input.changedAt,
        updatedAt: input.changedAt,
      })
      .where(
        and(
          eq(schema.clientCommitmentPeriods.id, task.commitmentPeriodId),
          eq(schema.clientCommitmentPeriods.orgId, task.orgId),
        ),
      );
    return;
  }

  if (input.fromStatus === "completed") {
    await tx
      .update(schema.clientCommitmentPeriods)
      .set({ completedBy: null, completedAt: null, updatedAt: input.changedAt })
      .where(
        and(
          eq(schema.clientCommitmentPeriods.id, task.commitmentPeriodId),
          eq(schema.clientCommitmentPeriods.orgId, task.orgId),
          // Só desfaz o que esta missão fechou.
          eq(schema.clientCommitmentPeriods.taskId, task.id),
        ),
      );
  }
}
