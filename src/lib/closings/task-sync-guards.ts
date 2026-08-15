import type { TaskStatus } from "@/domain/task-state";

export function completedTaskAssigneeId(
  task: { assigneeId: string | null },
  toStatus: "completed",
): string;
export function completedTaskAssigneeId(
  task: { assigneeId: string | null },
  toStatus: TaskStatus,
): string | null;
export function completedTaskAssigneeId(
  task: { assigneeId: string | null },
  toStatus: TaskStatus,
): string | null {
  if (toStatus !== "completed") return null;
  if (!task.assigneeId) {
    throw new Error(
      "Uma missão precisa estar atribuída a uma pessoa antes de concluir um fechamento.",
    );
  }
  return task.assigneeId;
}
