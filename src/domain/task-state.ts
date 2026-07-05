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
  task: { creatorId: string; assigneeId: string; status: TaskStatus };
  /** Existe admin/owner na org além do ator? (regra de auto-aprovação) */
  orgHasOtherApprover: boolean;
}

export type TransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Grafo de transições válidas. `completed → in_progress` é a reversão administrativa. */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["awaiting_approval", "cancelled"],
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
 * - aprovar / rejeitar: criador ou admin/owner — e se criador == responsável,
 *   outro admin/owner precisa aprovar (a menos que não exista outro, caso
 *   de org de 1 pessoa, para não travar);
 * - cancelar: criador ou admin/owner;
 * - reverter conclusão: apenas admin/owner.
 */
export function authorizeTransition(
  to: TaskStatus,
  ctx: TransitionContext,
): TransitionDecision {
  const { actor, task, orgHasOtherApprover } = ctx;
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
      : deny("Apenas a pessoa responsável pode trabalhar na tarefa.");
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

  // awaiting_approval → completed | rejected (decisão de aprovação)
  if (to === "completed" || to === "rejected") {
    const selfAssigned = task.creatorId === task.assigneeId;

    if (selfAssigned && isAssignee) {
      // Auto-aprovação: permitida somente quando não há outro admin/owner
      // na organização (org de 1 pessoa) — independente do papel do ator.
      return orgHasOtherApprover
        ? deny("Tarefas criadas para si precisam ser aprovadas por outro admin.")
        : ALLOW;
    }

    if (isAdmin) {
      return ALLOW;
    }
    if (isCreator && !selfAssigned) {
      return ALLOW;
    }
    return deny("Apenas quem criou a tarefa ou um admin pode aprovar/rejeitar.");
  }

  // → cancelled
  if (to === "cancelled") {
    return isCreator || isAdmin
      ? ALLOW
      : deny("Apenas quem criou a tarefa ou um admin pode cancelar.");
  }

  return deny("Transição de status inválida.");
}
