import type { TaskStatus } from "@/domain/task-state";

/** Rótulos e estilos de apresentação das tarefas (pt-BR). */

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  awaiting_approval: "Aguardando aprovação",
  completed: "Concluída",
  rejected: "Devolvida",
  cancelled: "Cancelada",
};

/** Classes de badge por status (fundo suave + texto forte, ok em dark). */
export const STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  pending:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-transparent",
  in_progress:
    "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-transparent",
  awaiting_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-transparent",
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-transparent",
  rejected:
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border-transparent",
  cancelled:
    "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500 border-transparent",
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: "Baixa",
  2: "Média",
  3: "Alta",
};

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Muito fácil",
  2: "Fácil",
  3: "Média",
  4: "Difícil",
  5: "Muito difícil",
};

/** Datas de prazo são armazenadas ao meio-dia UTC — formatar SEMPRE em UTC. */
export function formatDueDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function isOverdue(dueDate: Date | null, status: TaskStatus): boolean {
  if (!dueDate) return false;
  if (status === "completed" || status === "cancelled") return false;
  return dueDate.getTime() < Date.now();
}

/** Descrição humana de cada transição para a linha do tempo. */
export function eventLabel(
  fromStatus: TaskStatus | null,
  toStatus: TaskStatus,
): string {
  if (fromStatus === null) return "criou a tarefa";
  if (toStatus === "in_progress" && fromStatus === "pending") return "iniciou a tarefa";
  if (toStatus === "in_progress" && fromStatus === "rejected") return "retomou a tarefa";
  if (toStatus === "in_progress" && fromStatus === "completed")
    return "reverteu a conclusão";
  if (toStatus === "awaiting_approval") return "enviou para aprovação";
  if (toStatus === "completed") return "aprovou a entrega";
  if (toStatus === "rejected") return "devolveu para ajustes";
  if (toStatus === "cancelled") return "cancelou a tarefa";
  return `moveu para ${STATUS_LABELS[toStatus]}`;
}
