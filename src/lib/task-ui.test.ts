import { describe, expect, it } from "vitest";

import { upcomingWeekBounds } from "./task-ui";

describe("upcomingWeekBounds", () => {
  it("começa agora e termina sete dias depois, sem incluir o passado", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");

    expect(upcomingWeekBounds(now)).toEqual({
      from: now,
      to: new Date("2026-08-21T12:00:00.000Z"),
    });
  });
});
