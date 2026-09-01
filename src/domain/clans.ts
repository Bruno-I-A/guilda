import type { OrgRole, TaskStatus, TransitionDecision } from "./task-state";

export const TRANSFERABLE_TASK_STATUSES = [
  "pending",
  "in_progress",
  "rejected",
] as const satisfies readonly TaskStatus[];

export interface TransferAuthorizationContext {
  actor: { id: string; role: OrgRole };
  task: {
    assigneeId: string | null;
    clanId: string | null;
    status: TaskStatus;
  };
  destination: {
    assigneeId: string;
    clanId: string;
    assigneeIsActiveMember: boolean;
  };
  actorIsActiveMemberOfTaskClan: boolean;
}

export type ClanResolution =
  | { ok: true; clanId: string }
  | { ok: false; reason: string };

export interface ActiveClanCandidate {
  clanId: string;
  isPrimary: boolean;
}

const ALLOW: TransitionDecision = { allowed: true };

function deny(reason: string): TransitionDecision {
  return { allowed: false, reason };
}

export function isTransferableTaskStatus(
  status: TaskStatus,
): status is (typeof TRANSFERABLE_TASK_STATUSES)[number] {
  return TRANSFERABLE_TASK_STATUSES.includes(
    status as (typeof TRANSFERABLE_TASK_STATUSES)[number],
  );
}

/**
 * Autoriza uma transferência depois que os vínculos foram carregados do
 * banco. A função é pura; a action continua responsável pelos locks e por
 * provar que todos os registros pertencem à organização da sessão.
 */
export function authorizeTaskTransfer(
  ctx: TransferAuthorizationContext,
): TransitionDecision {
  const { actor, task, destination } = ctx;

  if (!isTransferableTaskStatus(task.status)) {
    return deny(
      "Somente missões pendentes, em andamento ou rejeitadas podem ser transferidas.",
    );
  }
  if (!destination.assigneeIsActiveMember) {
    return deny("A nova pessoa responsável precisa ser membro ativo do clã destino.");
  }
  if (
    task.assigneeId === destination.assigneeId &&
    task.clanId === destination.clanId
  ) {
    return deny("A missão já está atribuída a essa pessoa nesse clã.");
  }

  const isAdmin = actor.role === "admin" || actor.role === "owner";
  if (isAdmin) return ALLOW;

  if (!task.clanId || task.clanId !== destination.clanId) {
    return deny("Apenas admin ou owner pode transferir uma missão entre clãs.");
  }
  if (ctx.actorIsActiveMemberOfTaskClan) return ALLOW;
  if (task.assigneeId === actor.id) return ALLOW;

  return deny(
    "Apenas integrantes do clã ou um admin podem transferir a missão.",
  );
}

/**
 * Resolve o clã de uma pessoa sem confiar em um valor vindo da interface.
 * O chamador deve fornecer somente vínculos ativos, já filtrados pela org.
 */
export function resolveAssigneeClan(
  memberships: readonly ActiveClanCandidate[],
  requestedClanId?: string,
): ClanResolution {
  if (requestedClanId) {
    return memberships.some((membership) => membership.clanId === requestedClanId)
      ? { ok: true, clanId: requestedClanId }
      : {
          ok: false,
          reason: "A pessoa responsável não pertence ao clã informado.",
        };
  }

  const primaryMemberships = memberships.filter(
    (membership) => membership.isPrimary,
  );
  if (primaryMemberships.length === 1) {
    return { ok: true, clanId: primaryMemberships[0].clanId };
  }
  if (primaryMemberships.length > 1) {
    return {
      ok: false,
      reason:
        "A pessoa responsável possui mais de um clã principal. Peça a um administrador para corrigir o cadastro.",
    };
  }
  if (memberships.length === 1) {
    return { ok: true, clanId: memberships[0].clanId };
  }
  if (memberships.length === 0) {
    return {
      ok: false,
      reason: "A pessoa responsável não possui vínculo ativo com nenhum clã.",
    };
  }
  return {
    ok: false,
    reason:
      "A pessoa responsável participa de vários clãs, mas não possui um clã principal. Peça a um administrador para corrigir o cadastro.",
  };
}
