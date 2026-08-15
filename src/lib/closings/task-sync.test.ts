import { describe, expect, it } from "vitest";

import { completedTaskAssigneeId } from "./task-sync-guards";

describe("completedTaskAssigneeId", () => {
  it("exige uma pessoa responsável antes de sincronizar uma conclusão", () => {
    expect(() =>
      completedTaskAssigneeId({ assigneeId: null }, "completed"),
    ).toThrow("atribuída a uma pessoa");
  });

  it("devolve o responsável da missão concluída", () => {
    expect(
      completedTaskAssigneeId({ assigneeId: "user-1" }, "completed"),
    ).toBe("user-1");
  });

  it("não exige responsável em transições que não concluem", () => {
    expect(
      completedTaskAssigneeId({ assigneeId: null }, "cancelled"),
    ).toBeNull();
  });
});
