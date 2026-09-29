import { describe, expect, it } from "vitest";

import { formatAppDate, formatAppDateTime } from "./date-time";
import { formatDateTime, formatDueDate } from "./task-ui";

describe("horários exibidos pela Guilda", () => {
  const instant = new Date("2026-09-23T02:15:00.000Z");

  it("mostra eventos em Brasília, inclusive na virada do dia UTC", () => {
    expect(formatAppDateTime(instant)).toBe("22/09/2026, 23:15:00");
    expect(formatAppDate(instant.toISOString())).toBe("22/09/2026");
    expect(formatDateTime(instant)).toBe("22/09/26, 23:15");
  });

  it("preserva datas de prazo como datas de calendário", () => {
    expect(formatDueDate(new Date("2026-09-23T12:00:00.000Z"))).toBe("23 de set.");
  });
});
