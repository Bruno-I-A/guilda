import { describe, expect, test } from "vitest";

import {
  authorizeTransition,
  canTransition,
  type OrgRole,
  type TaskStatus,
  type TransitionContext,
} from "./task-state";

/** Monta o contexto de transição com defaults convenientes. */
function ctx(overrides: {
  actorId: string;
  actorRole?: OrgRole;
  creatorId?: string;
  assigneeId?: string;
  status: TaskStatus;
  orgHasOtherApprover?: boolean;
}): TransitionContext {
  return {
    actor: { id: overrides.actorId, role: overrides.actorRole ?? "member" },
    task: {
      creatorId: overrides.creatorId ?? "creator-1",
      assigneeId: overrides.assigneeId ?? "assignee-1",
      status: overrides.status,
    },
    orgHasOtherApprover: overrides.orgHasOtherApprover ?? true,
  };
}

describe("canTransition — grafo de transições", () => {
  test.each([
    ["pending", "in_progress"],
    ["pending", "cancelled"],
    ["in_progress", "awaiting_approval"],
    ["in_progress", "cancelled"],
    ["awaiting_approval", "completed"],
    ["awaiting_approval", "rejected"],
    ["awaiting_approval", "cancelled"],
    ["rejected", "in_progress"],
    ["rejected", "cancelled"],
    ["completed", "in_progress"], // reversão administrativa
  ] as const)("permite %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  test.each([
    ["pending", "completed"], // nunca pular a aprovação
    ["pending", "awaiting_approval"], // precisa iniciar antes
    ["in_progress", "completed"], // nunca pular a aprovação
    ["in_progress", "rejected"],
    ["awaiting_approval", "in_progress"],
    ["completed", "pending"],
    ["completed", "cancelled"],
    ["cancelled", "pending"],
    ["cancelled", "in_progress"],
    ["rejected", "completed"],
    ["pending", "pending"],
  ] as const)("bloqueia %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("iniciar tarefa (pending → in_progress)", () => {
  test("responsável pode iniciar", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "assignee-1", status: "pending" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("criador que não é o responsável não pode iniciar", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "creator-1", status: "pending" }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("admin não inicia tarefa dos outros", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "admin-1", actorRole: "admin", status: "pending" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("enviar para aprovação (in_progress → awaiting_approval)", () => {
  test("responsável pode enviar", () => {
    const decision = authorizeTransition(
      "awaiting_approval",
      ctx({ actorId: "assignee-1", status: "in_progress" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("admin não envia pela pessoa responsável", () => {
    const decision = authorizeTransition(
      "awaiting_approval",
      ctx({ actorId: "admin-1", actorRole: "admin", status: "in_progress" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("retomar após rejeição (rejected → in_progress)", () => {
  test("responsável pode retomar", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "assignee-1", status: "rejected" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("criador que não é responsável não pode retomar", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "creator-1", status: "rejected" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("aprovação (awaiting_approval → completed) — criador ≠ responsável", () => {
  test("criador pode aprovar, mesmo sendo member", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({ actorId: "creator-1", status: "awaiting_approval" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("admin pode aprovar qualquer tarefa", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({ actorId: "admin-1", actorRole: "admin", status: "awaiting_approval" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("owner pode aprovar qualquer tarefa", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({ actorId: "owner-1", actorRole: "owner", status: "awaiting_approval" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("responsável (member, não criador) não aprova a própria entrega", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({ actorId: "assignee-1", status: "awaiting_approval" }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("member sem relação com a tarefa não aprova", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({ actorId: "random-1", status: "awaiting_approval" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("auto-aprovação (criador == responsável)", () => {
  const selfTask = {
    creatorId: "self-1",
    assigneeId: "self-1",
  };

  test("com outro admin na org, a própria pessoa NÃO pode aprovar", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({
        actorId: "self-1",
        status: "awaiting_approval",
        ...selfTask,
        orgHasOtherApprover: true,
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("owner de org de 1 pessoa pode auto-aprovar (não travar a org)", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({
        actorId: "self-1",
        actorRole: "owner",
        status: "awaiting_approval",
        ...selfTask,
        orgHasOtherApprover: false,
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("mesmo sendo owner, com outro admin disponível a aprovação é dele", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({
        actorId: "self-1",
        actorRole: "owner",
        status: "awaiting_approval",
        ...selfTask,
        orgHasOtherApprover: true,
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("outro admin pode aprovar a tarefa auto-atribuída", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({
        actorId: "admin-2",
        actorRole: "admin",
        status: "awaiting_approval",
        ...selfTask,
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("member comum não aprova tarefa auto-atribuída de outra pessoa", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({
        actorId: "random-1",
        status: "awaiting_approval",
        ...selfTask,
      }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("rejeição (awaiting_approval → rejected)", () => {
  test("criador pode rejeitar", () => {
    const decision = authorizeTransition(
      "rejected",
      ctx({ actorId: "creator-1", status: "awaiting_approval" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("responsável não rejeita a própria entrega", () => {
    const decision = authorizeTransition(
      "rejected",
      ctx({ actorId: "assignee-1", status: "awaiting_approval" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("cancelamento (→ cancelled)", () => {
  test("criador pode cancelar tarefa pendente", () => {
    const decision = authorizeTransition(
      "cancelled",
      ctx({ actorId: "creator-1", status: "pending" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("admin pode cancelar tarefa em andamento de outros", () => {
    const decision = authorizeTransition(
      "cancelled",
      ctx({ actorId: "admin-1", actorRole: "admin", status: "in_progress" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("responsável que não criou não pode cancelar", () => {
    const decision = authorizeTransition(
      "cancelled",
      ctx({ actorId: "assignee-1", status: "in_progress" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("reversão de conclusão (completed → in_progress)", () => {
  test("admin pode reverter", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "admin-1", actorRole: "admin", status: "completed" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("owner pode reverter", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "owner-1", actorRole: "owner", status: "completed" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("criador member não pode reverter", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "creator-1", status: "completed" }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("responsável não pode reverter a própria conclusão", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "assignee-1", status: "completed" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("transições inválidas retornam motivo", () => {
  test("pending → completed é bloqueado com motivo", () => {
    const decision = authorizeTransition(
      "completed",
      ctx({ actorId: "admin-1", actorRole: "admin", status: "pending" }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBeTruthy();
    }
  });

  test("cancelled é estado terminal", () => {
    const decision = authorizeTransition(
      "in_progress",
      ctx({ actorId: "assignee-1", status: "cancelled" }),
    );
    expect(decision.allowed).toBe(false);
  });
});
