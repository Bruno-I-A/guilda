import { describe, expect, it } from "vitest";

import {
  isQuietMinute,
  isScheduledMinute,
  timeToMinutes,
  zonedMinute,
} from "./scheduler-time";

describe("agenda Telegram", () => {
  it("calcula data/minuto no fuso do usuário", () => {
    const value = zonedMinute(new Date("2026-08-12T11:00:00Z"), "America/Sao_Paulo");
    expect(value).toEqual({ date: "2026-08-12", time: "08:00", minutes: 480 });
    expect(isScheduledMinute(value, "08:00:00")).toBe(true);
  });

  it("entende período silencioso que atravessa meia-noite", () => {
    expect(isQuietMinute(23 * 60, "22:00:00", "07:00:00")).toBe(true);
    expect(isQuietMinute(6 * 60, "22:00:00", "07:00:00")).toBe(true);
    expect(isQuietMinute(12 * 60, "22:00:00", "07:00:00")).toBe(false);
    expect(timeToMinutes("25:00")).toBeNull();
  });
});
