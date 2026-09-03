import { describe, expect, it } from "vitest";

import { formatRelativeTime, upcomingWeekBounds } from "./task-ui";

describe("upcomingWeekBounds", () => {
  it("começa agora e termina sete dias depois, sem incluir o passado", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");

    expect(upcomingWeekBounds(now)).toEqual({
      from: now,
      to: new Date("2026-08-21T12:00:00.000Z"),
    });
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-09-03T15:00:00.000Z");

  it("escala de minutos para horas, dias e data", () => {
    expect(formatRelativeTime(new Date("2026-09-03T14:59:30.000Z"), now)).toBe("agora");
    expect(formatRelativeTime(new Date("2026-09-03T14:55:00.000Z"), now)).toBe("há 5 min");
    expect(formatRelativeTime(new Date("2026-09-03T12:00:00.000Z"), now)).toBe("há 3 h");
    expect(formatRelativeTime(new Date("2026-09-02T10:00:00.000Z"), now)).toBe("ontem");
    expect(formatRelativeTime(new Date("2026-08-30T15:00:00.000Z"), now)).toBe("há 4 dias");
    expect(formatRelativeTime(new Date("2026-08-20T15:00:00.000Z"), now)).toBe("em 20 de ago.");
  });
});
