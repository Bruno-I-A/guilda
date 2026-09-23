import type { TaskStatus } from "@/domain/task-state";

export type MuralSection = "mine" | "team" | "resolved" | "archived";

export type MyNoticeTask = {
  status: TaskStatus;
  updatedAt: Date;
};

export function noticeWorkState(input: {
  archived: boolean;
  tasks: readonly MyNoticeTask[];
  resolvedAt: Date | null;
}): { section: MuralSection; closed: number; total: number } {
  const total = input.tasks.length;
  const closed = input.tasks.filter(
    (task) => task.status === "completed" || task.status === "cancelled",
  ).length;
  if (input.archived) return { section: "archived", closed, total };
  if (total === 0) return { section: "team", closed, total };

  const resolvedAt = input.resolvedAt;
  const validResolution = resolvedAt !== null &&
    closed === total &&
    input.tasks.every((task) => task.updatedAt <= resolvedAt);
  return { section: validResolution ? "resolved" : "mine", closed, total };
}
