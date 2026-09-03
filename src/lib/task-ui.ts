import type { TaskStatus } from "@/domain/task-state";

/** Rótulos e estilos de apresentação das missões (pt-BR). */

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  awaiting_approval: "Aguardando aprovação",
  completed: "Concluída",
  rejected: "Devolvida",
  cancelled: "Cancelada",
};

/** Classes de badge por status (tema único gelo/ferro; concluída é a única em ouro). */
export const STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  pending: "bg-secondary text-silver border-transparent",
  in_progress: "bg-primary/15 text-primary border-transparent",
  awaiting_approval: "bg-warning/10 text-warning border-transparent",
  completed: "bg-gold/15 text-gold border-transparent",
  rejected: "bg-destructive/15 text-destructive border-transparent",
  cancelled: "bg-muted text-muted-foreground/70 border-transparent",
};

/** Trilho de cor na borda esquerda das linhas de missão (atrasada usa destructive). */
export const STATUS_RAIL_CLASSES: Record<TaskStatus, string> = {
  pending: "border-l-silver/50",
  in_progress: "border-l-primary",
  awaiting_approval: "border-l-warning/70",
  completed: "border-l-gold/60",
  rejected: "border-l-destructive",
  cancelled: "border-l-border",
};

/**
 * Segmento do medidor de um pacote de Informativo — uma missão, um
 * segmento. Mesmas cores do trilho, em fundo: concluída em ouro porque é o
 * único lugar onde "feito" e "recompensa creditada" são a mesma coisa.
 */
export const STATUS_METER_CLASSES: Record<TaskStatus, string> = {
  pending: "bg-secondary",
  in_progress: "bg-primary",
  awaiting_approval: "bg-warning/80",
  completed: "bg-gold/70",
  rejected: "bg-destructive/80",
  cancelled: "bg-border/60",
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

/** Janela futura usada pelo filtro "Próximos 7 dias" (não inclui atrasadas). */
export function upcomingWeekBounds(now = new Date()): {
  from: Date;
  to: Date;
} {
  return {
    from: now,
    to: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  };
}

/** Descrição humana de cada transição para a linha do tempo. */
export function eventLabel(
  fromStatus: TaskStatus | null,
  toStatus: TaskStatus,
): string {
  if (fromStatus === null) return "criou a missão";
  if (toStatus === "in_progress" && fromStatus === "pending") return "iniciou a missão";
  if (toStatus === "in_progress" && fromStatus === "rejected") return "retomou a missão";
  if (toStatus === "in_progress" && fromStatus === "completed")
    return "reverteu a conclusão";
  if (toStatus === "awaiting_approval") return "enviou para aprovação";
  if (toStatus === "completed" && fromStatus === "in_progress")
    return "concluiu a missão";
  if (toStatus === "completed") return "aprovou a entrega";
  if (toStatus === "rejected") return "devolveu para ajustes";
  if (toStatus === "cancelled") return "cancelou a missão";
  return `moveu para ${STATUS_LABELS[toStatus]}`;
}
