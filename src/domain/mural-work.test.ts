import { describe, expect, test } from "vitest";

import { noticeWorkState } from "./mural-work";

const before = new Date("2026-09-01T12:00:00Z");
const confirmation = new Date("2026-09-01T12:01:00Z");
const after = new Date("2026-09-01T12:02:00Z");

describe("fila pessoal do Mural", () => {
  test("sem missão atribuída à pessoa, fica no acompanhamento da equipe", () => {
    expect(noticeWorkState({ archived: false, tasks: [], resolvedAt: null }).section)
      .toBe("team");
  });

  test("missões encerradas continuam na fila até confirmação individual", () => {
    const tasks = [{ status: "completed" as const, updatedAt: before }];
    expect(noticeWorkState({ archived: false, tasks, resolvedAt: null }).section)
      .toBe("mine");
    expect(noticeWorkState({ archived: false, tasks, resolvedAt: confirmation }).section)
      .toBe("resolved");
  });

  test("uma nova atribuição ou reabertura devolve o informativo à fila", () => {
    const oldTask = { status: "completed" as const, updatedAt: before };
    expect(noticeWorkState({
      archived: false,
      tasks: [oldTask, { status: "pending", updatedAt: after }],
      resolvedAt: confirmation,
    }).section).toBe("mine");
    expect(noticeWorkState({
      archived: false,
      tasks: [{ status: "completed", updatedAt: after }],
      resolvedAt: confirmation,
    }).section).toBe("mine");
  });

  test("arquivamento da Guilda prevalece sobre a fila individual", () => {
    expect(noticeWorkState({
      archived: true,
      tasks: [{ status: "pending", updatedAt: before }],
      resolvedAt: null,
    }).section).toBe("archived");
  });
});
