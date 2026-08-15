import { describe, expect, it } from "vitest";

import { TASK_ACTION_TRANSITIONS } from "./task-action-intent";

describe("TASK_ACTION_TRANSITIONS", () => {
  it("mapeia o callback submit legado para conclusão direta", () => {
    expect(TASK_ACTION_TRANSITIONS.submit).toEqual({
      to: "completed",
      allowedFrom: ["in_progress"],
    });
  });

  it("restringe aprovação e rejeição aos estados legados", () => {
    expect(TASK_ACTION_TRANSITIONS.approve.allowedFrom).toEqual([
      "awaiting_approval",
    ]);
    expect(TASK_ACTION_TRANSITIONS.reject.allowedFrom).toEqual([
      "awaiting_approval",
    ]);
  });
});
