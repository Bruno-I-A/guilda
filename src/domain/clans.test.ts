import { describe, expect, test } from "vitest";

import {
  authorizeTaskTransfer,
  isTransferableTaskStatus,
  resolveAssigneeClan,
  type TransferAuthorizationContext,
} from "./clans";

function ctx(
  overrides: Partial<TransferAuthorizationContext> = {},
): TransferAuthorizationContext {
  return {
    actor: { id: "assignee-1", role: "member" },
    task: {
      assigneeId: "assignee-1",
      clanId: "clan-1",
      status: "in_progress",
    },
    destination: {
      assigneeId: "assignee-2",
      clanId: "clan-1",
      assigneeIsActiveMember: true,
    },
    actorIsActiveLeaderOfTaskClan: false,
    ...overrides,
  };
}

describe("status transferível", () => {
  test.each(["pending", "in_progress", "rejected"] as const)(
    "permite %s",
    (status) => expect(isTransferableTaskStatus(status)).toBe(true),
  );

  test.each(["awaiting_approval", "completed", "cancelled"] as const)(
    "bloqueia %s",
    (status) => expect(isTransferableTaskStatus(status)).toBe(false),
  );
});

describe("resolução do clã da pessoa", () => {
  test("usa o clã principal quando existem vários vínculos", () => {
    expect(
      resolveAssigneeClan([
        { clanId: "clan-1", isPrimary: false },
        { clanId: "clan-2", isPrimary: true },
      ]),
    ).toEqual({ ok: true, clanId: "clan-2" });
  });

  test("usa o único vínculo como fallback mesmo sem flag principal", () => {
    expect(
      resolveAssigneeClan([{ clanId: "clan-1", isPrimary: false }]),
    ).toEqual({ ok: true, clanId: "clan-1" });
  });

  test("aceita clã explícito somente se a pessoa pertence a ele", () => {
    expect(
      resolveAssigneeClan(
        [{ clanId: "clan-1", isPrimary: false }],
        "clan-1",
      ),
    ).toEqual({ ok: true, clanId: "clan-1" });
    expect(
      resolveAssigneeClan(
        [{ clanId: "clan-1", isPrimary: false }],
        "clan-2",
      ).ok,
    ).toBe(false);
  });

  test("falha claramente se não há vínculo ativo", () => {
    const result = resolveAssigneeClan([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("nenhum clã");
  });

  test("falha claramente com vários vínculos sem principal", () => {
    const result = resolveAssigneeClan([
      { clanId: "clan-1", isPrimary: false },
      { clanId: "clan-2", isPrimary: false },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("clã principal");
  });

  test("falha claramente se o cadastro tiver mais de um clã principal", () => {
    const result = resolveAssigneeClan([
      { clanId: "clan-1", isPrimary: true },
      { clanId: "clan-2", isPrimary: true },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("mais de um clã principal");
  });
});

describe("autorização de transferência", () => {
  test("responsável transfere a própria missão dentro do mesmo clã", () => {
    expect(authorizeTaskTransfer(ctx()).allowed).toBe(true);
  });

  test("líder transfere qualquer missão do seu clã dentro dele", () => {
    const decision = authorizeTaskTransfer(
      ctx({
        actor: { id: "leader-1", role: "member" },
        actorIsActiveLeaderOfTaskClan: true,
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  test.each(["admin", "owner"] as const)(
    "%s transfere inclusive entre clãs",
    (role) => {
      const decision = authorizeTaskTransfer(
        ctx({
          actor: { id: `${role}-1`, role },
          destination: {
            assigneeId: "assignee-3",
            clanId: "clan-2",
            assigneeIsActiveMember: true,
          },
        }),
      );
      expect(decision.allowed).toBe(true);
    },
  );

  test("responsável não transfere entre clãs", () => {
    const decision = authorizeTaskTransfer(
      ctx({
        destination: {
          assigneeId: "assignee-3",
          clanId: "clan-2",
          assigneeIsActiveMember: true,
        },
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("líder não transfere entre clãs", () => {
    const decision = authorizeTaskTransfer(
      ctx({
        actor: { id: "leader-1", role: "member" },
        actorIsActiveLeaderOfTaskClan: true,
        destination: {
          assigneeId: "assignee-3",
          clanId: "clan-2",
          assigneeIsActiveMember: true,
        },
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("membro sem relação com a missão não transfere", () => {
    const decision = authorizeTaskTransfer(
      ctx({ actor: { id: "other-1", role: "member" } }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("bloqueia destino que não é membro ativo", () => {
    const decision = authorizeTaskTransfer(
      ctx({
        destination: {
          assigneeId: "outsider-1",
          clanId: "clan-1",
          assigneeIsActiveMember: false,
        },
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("bloqueia atribuição idêntica", () => {
    const decision = authorizeTaskTransfer(
      ctx({
        destination: {
          assigneeId: "assignee-1",
          clanId: "clan-1",
          assigneeIsActiveMember: true,
        },
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("missão sem clã legado somente pode ser transferida por admin", () => {
    const memberDecision = authorizeTaskTransfer(
      ctx({
        task: {
          assigneeId: "assignee-1",
          clanId: null,
          status: "pending",
        },
      }),
    );
    const adminDecision = authorizeTaskTransfer(
      ctx({
        actor: { id: "admin-1", role: "admin" },
        task: {
          assigneeId: "assignee-1",
          clanId: null,
          status: "pending",
        },
      }),
    );

    expect(memberDecision.allowed).toBe(false);
    expect(adminDecision.allowed).toBe(true);
  });

  test.each(["awaiting_approval", "completed", "cancelled"] as const)(
    "ninguém transfere uma missão em %s",
    (status) => {
      const decision = authorizeTaskTransfer(
        ctx({
          actor: { id: "owner-1", role: "owner" },
          task: {
            assigneeId: "assignee-1",
            clanId: "clan-1",
            status,
          },
        }),
      );
      expect(decision.allowed).toBe(false);
    },
  );
});
