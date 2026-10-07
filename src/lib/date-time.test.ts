import { describe, expect, it } from "vitest";

import { currentAppYear, formatAppDate, formatAppDateTime } from "./date-time";
import { formatDateTime, formatDueDate } from "./task-ui";

describe("horários exibidos pela Guilda", () => {
  const instant = new Date("2026-09-23T02:15:00.000Z");

  it("mostra eventos em Brasília, inclusive na virada do dia UTC", () => {
    expect(formatAppDateTime(instant)).toBe("22/09/2026, 23:15:00");
    expect(formatAppDate(instant.toISOString())).toBe("22/09/2026");
    expect(formatDateTime(instant)).toBe("22/09/26, 23:15");
  });

  it("conta o ano em Brasília, inclusive na virada do ano UTC", () => {
    // 31/12/2026 às 23h30 em Brasília; no UTC já é 2027.
    expect(currentAppYear(new Date("2027-01-01T02:30:00.000Z"))).toBe(2026);
    expect(currentAppYear(new Date("2027-01-01T03:00:00.000Z"))).toBe(2027);
  });

  it("preserva datas de prazo como datas de calendário", () => {
    expect(formatDueDate(new Date("2026-09-23T12:00:00.000Z"))).toBe("23 de set.");
  });
});
