/**
 * Máquina de estados do ciclo de vida da tarefa (funções puras).
 * Toda validação de transição acontece no servidor — a UI apenas
 * reflete estas regras, nunca as substitui.
 */

export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type OrgRole = "owner" | "admin" | "member";

export interface TransitionContext {
  actor: { id: string; role: OrgRole };
  task: { creatorId: string; assigneeId: string | null; status: TaskStatus };
}

export type TransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Grafo de transições válidas. `completed → in_progress` é a reversão
 * administrativa; `in_progress → completed` é a conclusão direta pela
 * pessoa responsável, sem aprovação de terceiros.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["awaiting_approval", "completed", "cancelled"],
  awaiting_approval: ["completed", "rejected", "cancelled"],
  rejected: ["in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function isApproverRole(role: OrgRole): boolean {
  return role === "admin" || role === "owner";
}

function deny(reason: string): TransitionDecision {
  return { allowed: false, reason };
}

const ALLOW: TransitionDecision = { allowed: true };

/**
 * Decide se o ator pode executar a transição, combinando o grafo de
 * estados com as regras de papel/propriedade:
 *
 * - iniciar / enviar para aprovação / retomar: só o responsável;
 * - toda pessoa responsável pode concluir diretamente uma missão em
 *   andamento, ainda que outra pessoa a tenha criado;
 * - aprovar / rejeitar tarefa de terceiros: criador ou admin/owner;
 * - cancelar: criador ou admin/owner;
 * - reverter conclusão: apenas admin/owner.
 */
export function authorizeTransition(
  to: TaskStatus,
  ctx: TransitionContext,
): TransitionDecision {
  const { actor, task } = ctx;
  const from = task.status;

  if (!canTransition(from, to)) {
    return deny("Transição de status inválida.");
  }

  const isAssignee = actor.id === task.assigneeId;
  const isCreator = actor.id === task.creatorId;
  const isAdmin = isApproverRole(actor.role);

  // pending → in_progress (iniciar) e rejected → in_progress (retomar)
  if (to === "in_progress" && (from === "pending" || from === "rejected")) {
    return isAssignee
      ? ALLOW
      : deny("Apenas a pessoa responsável pode trabalhar na missão.");
  }

  // completed → in_progress (reversão administrativa)
  if (to === "in_progress" && from === "completed") {
    return isAdmin
      ? ALLOW
      : deny("Apenas admin ou owner pode reverter uma conclusão.");
  }

  // in_progress → awaiting_approval (enviar para aprovação)
  if (to === "awaiting_approval") {
    return isAssignee
      ? ALLOW
      : deny("Apenas a pessoa responsável pode enviar para aprovação.");
  }

  // in_progress → completed (conclusão direta pelo responsável)
  if (to === "completed" && from === "in_progress") {
    return isAssignee
      ? ALLOW
      : deny("Apenas a pessoa responsável pode concluir a missão.");
  }

  // awaiting_approval → completed | rejected (decisão de aprovação)
  if (to === "completed" || to === "rejected") {
    const selfAssigned = task.creatorId === task.assigneeId;

    if (selfAssigned && isAssignee) {
      // Auto-tarefa não precisa de aprovação de terceiros (cobre também
      // tarefas antigas que já estavam paradas em awaiting_approval).
      return ALLOW;
    }

    if (isAdmin) {
      return ALLOW;
    }
    if (isCreator && !selfAssigned) {
      return ALLOW;
    }
    return deny("Apenas quem criou a missão ou um admin pode aprovar/rejeitar.");
  }

  // → cancelled
  if (to === "cancelled") {
    return isCreator || isAdmin
      ? ALLOW
      : deny("Apenas quem criou a missão ou um admin pode cancelar.");
  }

  return deny("Transição de status inválida.");
}
