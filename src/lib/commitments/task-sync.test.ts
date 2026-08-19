import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
// `and`/`eq` viram identidade: o que importa aqui é QUAIS colunas entram no
// filtro e o que vai no `set`, não a árvore SQL que o drizzle montaria.
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => ({ and: parts }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
}));
vi.mock("@/db/schema", () => ({
  clientCommitmentPeriods: {
    id: "periods.id",
    orgId: "periods.org_id",
    taskId: "periods.task_id",
  },
}));

import { syncCommitmentPeriodFromTask } from "./task-sync";

type UpdateCall = { set: Record<string, unknown>; where: unknown };

/** tx falso que só registra o update — o suficiente para provar a regra. */
function fakeTx() {
  const calls: UpdateCall[] = [];
  const tx = {
    update() {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: unknown) {
              calls.push({ set: values, where: condition });
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return { tx, calls };
}

const CHANGED_AT = new Date("2026-08-19T12:00:00Z");

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    orgId: "org-1",
    assigneeId: "user-1",
    commitmentPeriodId: "period-1",
    ...overrides,
  } as never;
}

/** Todas as colunas citadas no filtro, achatadas da árvore de identidade. */
function filterColumns(where: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if ("and" in node) {
      for (const part of (node as { and: unknown[] }).and) walk(part);
    }
    if ("eq" in node) {
      const [column] = (node as { eq: unknown[] }).eq;
      if (typeof column === "string") found.push(column);
    }
  };
  walk(where);
  return found;
}

describe("syncCommitmentPeriodFromTask", () => {
  test("missão sem vínculo com compromisso não toca em nada", async () => {
    const { tx, calls } = fakeTx();
    await syncCommitmentPeriodFromTask(tx as never, {
      task: task({ commitmentPeriodId: null }),
      fromStatus: "in_progress",
      toStatus: "completed",
      changedAt: CHANGED_AT,
    });
    expect(calls).toHaveLength(0);
  });

  test("concluir a missão fecha a ocorrência com quem a executou", async () => {
    const { tx, calls } = fakeTx();
    await syncCommitmentPeriodFromTask(tx as never, {
      task: task(),
      fromStatus: "in_progress",
      toStatus: "completed",
      changedAt: CHANGED_AT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].set).toMatchObject({
      completedBy: "user-1",
      completedAt: CHANGED_AT,
    });
  });

  test("concluir sem responsável é invariante violada, não silêncio", async () => {
    const { tx } = fakeTx();
    await expect(
      syncCommitmentPeriodFromTask(tx as never, {
        task: task({ assigneeId: null }),
        fromStatus: "in_progress",
        toStatus: "completed",
        changedAt: CHANGED_AT,
      }),
    ).rejects.toThrow(/atribuída/);
  });

  test("reverter a conclusão reabre a ocorrência", async () => {
    const { tx, calls } = fakeTx();
    await syncCommitmentPeriodFromTask(tx as never, {
      task: task(),
      fromStatus: "completed",
      toStatus: "in_progress",
      changedAt: CHANGED_AT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].set).toMatchObject({ completedBy: null, completedAt: null });
  });

  // A ocorrência também pode ser fechada à mão, sem missão. A reabertura não
  // pode desfazer ESSA conclusão — só a que veio desta missão.
  test("a reabertura filtra por task_id, para não desfazer conclusão manual", async () => {
    const { tx, calls } = fakeTx();
    await syncCommitmentPeriodFromTask(tx as never, {
      task: task(),
      fromStatus: "completed",
      toStatus: "in_progress",
      changedAt: CHANGED_AT,
    });
    expect(filterColumns(calls[0].where)).toContain("periods.task_id");
  });

  test("a conclusão NÃO filtra por task_id — é ela que assume a ocorrência", async () => {
    const { tx, calls } = fakeTx();
    await syncCommitmentPeriodFromTask(tx as never, {
      task: task(),
      fromStatus: "in_progress",
      toStatus: "completed",
      changedAt: CHANGED_AT,
    });
    expect(filterColumns(calls[0].where)).not.toContain("periods.task_id");
  });

  test("transição que não envolve conclusão não mexe na ocorrência", async () => {
    const { tx, calls } = fakeTx();
    await syncCommitmentPeriodFromTask(tx as never, {
      task: task(),
      fromStatus: "pending",
      toStatus: "in_progress",
      changedAt: CHANGED_AT,
    });
    expect(calls).toHaveLength(0);
  });

  test("todo update é escopado por org — RLS não é a única defesa", async () => {
    const { tx, calls } = fakeTx();
    await syncCommitmentPeriodFromTask(tx as never, {
      task: task(),
      fromStatus: "in_progress",
      toStatus: "completed",
      changedAt: CHANGED_AT,
    });
    expect(filterColumns(calls[0].where)).toContain("periods.org_id");
  });
});
