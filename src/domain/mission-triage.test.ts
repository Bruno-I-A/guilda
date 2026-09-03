import { describe, expect, it } from "vitest";

import {
  compareOpenTasks,
  defaultMissionScope,
  groupInformativePackages,
  packageProgress,
  parseInformativeKind,
  parseMissionScope,
  parseMissionView,
  splitOpenAndClosed,
  standaloneSectionFor,
  triageStandaloneTasks,
  type TriageTask,
} from "./mission-triage";
import type { TaskStatus } from "./task-state";

const NOW = new Date("2026-09-03T15:00:00.000Z");
const ME = "user-me";
const OTHER = "user-other";

let sequence = 0;
function task(
  overrides: Partial<TriageTask> & { informativeId?: string | null; clientName?: string | null } = {},
): TriageTask & { informativeId: string | null; clientName: string | null } {
  sequence += 1;
  return {
    id: `task-${sequence}`,
    title: `Missão ${sequence}`,
    status: "pending",
    creatorId: ME,
    assigneeId: ME,
    dueDate: null,
    createdAt: new Date(NOW.getTime() - sequence * 60_000),
    updatedAt: new Date(NOW.getTime() - sequence * 60_000),
    completedAt: null,
    informativeId: null,
    clientName: null,
    ...overrides,
  };
}

describe("parseMissionView", () => {
  it("cai em avulsas por padrão e aceita o origin legado como sinônimo", () => {
    expect(parseMissionView(undefined)).toBe("standalone");
    expect(parseMissionView("informative")).toBe("informative");
    expect(parseMissionView("qualquer")).toBe("standalone");
    expect(parseMissionView(undefined, "informative")).toBe("informative");
    expect(parseMissionView(undefined, "standalone")).toBe("standalone");
  });
});

describe("parseMissionScope", () => {
  it("aceita os escopos vivos e manda o resto para o padrão informado", () => {
    expect(parseMissionScope("my_clans")).toBe("my_clans");
    expect(parseMissionScope("all")).toBe("all");
    expect(parseMissionScope("created")).toBe("mine");
    expect(parseMissionScope(undefined)).toBe("mine");
    expect(parseMissionScope(undefined, "my_clans")).toBe("my_clans");
  });
});

describe("defaultMissionScope", () => {
  it("avulsas começam na visão pessoal; informativos, no clã de quem tem clã", () => {
    expect(defaultMissionScope("standalone", true)).toBe("mine");
    expect(defaultMissionScope("informative", true)).toBe("my_clans");
    expect(defaultMissionScope("informative", false)).toBe("mine");
  });
});

describe("standaloneSectionFor", () => {
  it("responsável com trabalho a fazer cai em todo, inclusive devolvida", () => {
    expect(standaloneSectionFor(task({ status: "pending" }), ME)).toBe("todo");
    expect(standaloneSectionFor(task({ status: "in_progress" }), ME)).toBe("todo");
    expect(
      standaloneSectionFor(task({ status: "rejected", creatorId: OTHER }), ME),
    ).toBe("todo");
  });

  it("responsável que já entregou espera quem pediu", () => {
    expect(
      standaloneSectionFor(
        task({ status: "awaiting_approval", creatorId: OTHER }),
        ME,
      ),
    ).toBe("submitted");
  });

  it("quem pediu vê a entrega para aprovar ou o pedido em aberto", () => {
    expect(
      standaloneSectionFor(
        task({ status: "awaiting_approval", assigneeId: OTHER }),
        ME,
      ),
    ).toBe("approve");
    expect(
      standaloneSectionFor(task({ status: "in_progress", assigneeId: OTHER }), ME),
    ).toBe("requested");
    // Missão de clã sem dono ainda: continua sendo um pedido em aberto.
    expect(
      standaloneSectionFor(task({ status: "pending", assigneeId: null }), ME),
    ).toBe("requested");
  });

  it("encerradas vão para closed em qualquer papel; quem não participa fica de fora", () => {
    expect(standaloneSectionFor(task({ status: "completed" }), ME)).toBe("closed");
    expect(
      standaloneSectionFor(task({ status: "cancelled", assigneeId: OTHER }), ME),
    ).toBe("closed");
    expect(
      standaloneSectionFor(
        task({ status: "pending", creatorId: OTHER, assigneeId: OTHER }),
        ME,
      ),
    ).toBeNull();
  });
});

describe("compareOpenTasks", () => {
  it("atrasadas primeiro, depois prazo mais próximo, sem prazo por último", () => {
    const overdue = task({ dueDate: new Date("2026-09-01T12:00:00Z") });
    const soon = task({ dueDate: new Date("2026-09-04T12:00:00Z") });
    const later = task({ dueDate: new Date("2026-09-20T12:00:00Z") });
    const noDue = task({ dueDate: null });

    const sorted = [noDue, later, soon, overdue].sort(compareOpenTasks(NOW));
    expect(sorted.map((item) => item.id)).toEqual([
      overdue.id,
      soon.id,
      later.id,
      noDue.id,
    ]);
  });

  it("no empate de prazo, a mais recente vem em cima", () => {
    const older = task({ createdAt: new Date("2026-08-01T00:00:00Z") });
    const newer = task({ createdAt: new Date("2026-09-01T00:00:00Z") });
    expect([older, newer].sort(compareOpenTasks(NOW))[0].id).toBe(newer.id);
  });
});

describe("triageStandaloneTasks", () => {
  it("distribui cada missão em uma única seção e ordena as encerradas pela data de fechamento", () => {
    const todo = task({ status: "in_progress" });
    const approve = task({ status: "awaiting_approval", assigneeId: OTHER });
    const requested = task({ status: "pending", assigneeId: OTHER });
    const submitted = task({ status: "awaiting_approval", creatorId: OTHER });
    const closedOld = task({
      status: "completed",
      completedAt: new Date("2026-08-10T00:00:00Z"),
    });
    const closedNew = task({
      status: "completed",
      completedAt: new Date("2026-09-02T00:00:00Z"),
    });
    const foreign = task({ creatorId: OTHER, assigneeId: OTHER });

    const sections = triageStandaloneTasks(
      [foreign, closedOld, submitted, requested, approve, todo, closedNew],
      ME,
      NOW,
    );

    expect(sections.todo.map((item) => item.id)).toEqual([todo.id]);
    expect(sections.approve.map((item) => item.id)).toEqual([approve.id]);
    expect(sections.requested.map((item) => item.id)).toEqual([requested.id]);
    expect(sections.submitted.map((item) => item.id)).toEqual([submitted.id]);
    expect(sections.closed.map((item) => item.id)).toEqual([closedNew.id, closedOld.id]);
  });
});

describe("splitOpenAndClosed", () => {
  it("separa por status sem olhar o papel do usuário", () => {
    const open = task({ creatorId: OTHER, assigneeId: OTHER });
    const closed = task({ status: "cancelled", creatorId: OTHER, assigneeId: OTHER });
    const result = splitOpenAndClosed([closed, open], NOW);
    expect(result.open.map((item) => item.id)).toEqual([open.id]);
    expect(result.closed.map((item) => item.id)).toEqual([closed.id]);
  });
});

describe("packageProgress", () => {
  it("conta concluídas sobre o total sem as canceladas", () => {
    const statuses: TaskStatus[] = [
      "completed",
      "completed",
      "in_progress",
      "cancelled",
      "pending",
    ];
    expect(packageProgress(statuses)).toEqual({ done: 2, total: 4, cancelled: 1 });
  });
});

describe("parseInformativeKind", () => {
  it("aceita os tipos conhecidos e cai em missões gerais", () => {
    expect(parseInformativeKind("new_client")).toBe("new_client");
    expect(parseInformativeKind("client_closure")).toBe("client_closure");
    expect(parseInformativeKind(undefined)).toBe("general_task");
    expect(parseInformativeKind("x")).toBe("general_task");
  });
});

describe("groupInformativePackages", () => {
  it("agrupa por informativo, usa o progresso do pacote inteiro e põe os encerrados no fim", () => {
    const openA = task({ informativeId: "inf-a", clientName: "Empresa A", status: "pending", creatorId: OTHER, assigneeId: null });
    const doneA = task({ informativeId: "inf-a", clientName: "Empresa A", status: "completed", creatorId: OTHER, assigneeId: OTHER });
    const doneB = task({ informativeId: "inf-b", clientName: "Empresa B", status: "completed", creatorId: OTHER, assigneeId: OTHER });
    const standalone = task({ informativeId: null });

    const packages = groupInformativePackages(
      [doneB, doneA, openA, standalone],
      new Map([
        ["inf-a", { kind: "new_client" as const, companyName: "Empresa A Ltda", createdAt: new Date("2026-09-01T00:00:00Z") }],
        ["inf-b", { kind: "client_closure" as const, companyName: null, createdAt: new Date("2026-09-02T00:00:00Z") }],
      ]),
      new Map<string, TaskStatus[]>([
        // O pacote A tem uma terceira missão fora do escopo visível.
        ["inf-a", ["pending", "completed", "in_progress"]],
        ["inf-b", ["completed", "cancelled"]],
      ]),
      NOW,
    );

    expect(packages.map((item) => item.informativeId)).toEqual(["inf-a", "inf-b"]);

    const [packageA, packageB] = packages;
    expect(packageA.label).toBe("Empresa A Ltda");
    expect(packageA.kind).toBe("new_client");
    expect(packageA.open).toBe(true);
    expect(packageA.progress).toEqual({ done: 1, total: 3, cancelled: 0 });
    // Abertas antes das concluídas dentro do pacote.
    expect(packageA.tasks.map((item) => item.id)).toEqual([openA.id, doneA.id]);

    expect(packageB.label).toBe("Empresa B");
    expect(packageB.open).toBe(false);
    expect(packageB.progress).toEqual({ done: 1, total: 1, cancelled: 1 });
  });

  it("sem resumo do informativo, cai no que as próprias missões dizem", () => {
    const only = task({ informativeId: "inf-x", status: "in_progress", creatorId: OTHER, assigneeId: OTHER });
    const [pkg] = groupInformativePackages([only], new Map(), new Map(), NOW);
    expect(pkg.label).toBe("Missões sem empresa");
    expect(pkg.kind).toBe("general_task");
    expect(pkg.progress).toEqual({ done: 0, total: 1, cancelled: 0 });
    expect(pkg.createdAt).toEqual(only.createdAt);
  });
});
