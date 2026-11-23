import { describe, expect, test } from "vitest";

import {
  checkPeriods,
  hourLabel,
  hoursAt,
  nationalHolidays,
  nextOpening,
  openingPhrase,
  parsePeriods,
  parseWeek,
  type BusinessSchedule,
  type WeekSchedule,
} from "./business-hours";

const WORK: WeekSchedule = {
  1: [["08:00", "12:00"], ["13:30", "18:00"]],
  2: [["08:00", "12:00"], ["13:30", "18:00"]],
  3: [["08:00", "12:00"], ["13:30", "18:00"]],
  4: [["08:00", "12:00"], ["13:30", "18:00"]],
  5: [["08:00", "12:00"], ["13:30", "18:00"]],
  6: [],
  7: [],
};
const schedule = (specialDays: BusinessSchedule["specialDays"] = []): BusinessSchedule => ({ week: WORK, specialDays });
// Brasília é UTC-3: 09:00 em Brasília = 12:00Z.
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe("hoursAt", () => {
  test("sem expediente cadastrado é sempre aberto", () => {
    expect(hoursAt({ week: null, specialDays: [] }, brt("2026-11-22T03:00"))).toEqual({ open: true, nextOpening: null, closesAt: null });
  });

  test("aberto de manhã, fecha no almoço", () => {
    expect(hoursAt(schedule(), brt("2026-11-23T09:00"))).toEqual({ open: true, nextOpening: null, closesAt: brt("2026-11-23T12:00") });
  });

  test("no almoço está fechado e volta hoje às 13h30", () => {
    const now = brt("2026-11-23T12:30");
    const hours = hoursAt(schedule(), now);
    expect(hours).toEqual({ open: false, nextOpening: brt("2026-11-23T13:30"), closesAt: null });
    expect(openingPhrase(hours.nextOpening, now)).toBe("hoje às 13h30");
  });

  test("sexta à noite volta segunda; feriado na segunda empurra para terça", () => {
    const now = brt("2026-11-27T19:00");
    expect(openingPhrase(nextOpening(schedule(), now), now)).toBe("segunda-feira, 30/11, às 8h");
    const holiday = schedule([{ day: "2026-11-30", name: "Feriado municipal", periods: [] }]);
    expect(openingPhrase(nextOpening(holiday, now), now)).toBe("terça-feira, 01/12, às 8h");
  });

  test("quinta à noite volta amanhã; madrugada de segunda volta hoje", () => {
    const thursday = brt("2026-11-26T20:00");
    expect(openingPhrase(nextOpening(schedule(), thursday), thursday)).toBe("amanhã às 8h");
    const dawn = brt("2026-11-23T00:30");
    expect(openingPhrase(nextOpening(schedule(), dawn), dawn)).toBe("hoje às 8h");
  });

  test("meio período: o dia especial substitui a semana", () => {
    const christmas = schedule([
      { day: "2026-12-24", name: "Véspera de Natal", periods: [["08:00", "12:00"]] },
      { day: "2026-12-25", name: "Natal", periods: [] },
    ]);
    expect(hoursAt(christmas, brt("2026-12-24T10:00")).open).toBe(true);
    const afternoon = brt("2026-12-24T14:00");
    expect(hoursAt(christmas, afternoon)).toMatchObject({ open: false, nextOpening: brt("2026-12-28T08:00") });
    expect(openingPhrase(nextOpening(christmas, afternoon), afternoon)).toBe("segunda-feira, 28/12, às 8h");
  });

  test("sábado excepcional abre", () => {
    const saturday = schedule([{ day: "2026-11-28", name: "Plantão", periods: [["08:00", "12:00"]] }]);
    expect(hoursAt(saturday, brt("2026-11-28T09:00")).open).toBe(true);
  });

  test("semana toda fechada não tem próxima abertura", () => {
    const closed: WeekSchedule = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    const now = brt("2026-11-23T09:00");
    expect(hoursAt({ week: closed, specialDays: [] }, now)).toEqual({ open: false, nextOpening: null, closesAt: null });
    expect(openingPhrase(null, now)).toBe("no próximo expediente");
  });
});

describe("textos e validação", () => {
  test("hora cheia sem minutos, quebrada com minutos", () => {
    expect(hourLabel(8 * 60)).toBe("8h");
    expect(hourLabel(13 * 60 + 30)).toBe("13h30");
    expect(hourLabel(9 * 60 + 5)).toBe("9h05");
  });

  test("períodos: formato, ordem, sobreposição e no máximo dois", () => {
    expect(checkPeriods([["08:00", "12:00"], ["13:30", "18:00"]])).toBeNull();
    expect(checkPeriods([])).toBeNull();
    expect(checkPeriods([["8:00", "12:00"]])).toMatch(/formato/);
    expect(checkPeriods([["12:00", "08:00"]])).toMatch(/terminar depois/);
    expect(checkPeriods([["08:00", "13:00"], ["12:00", "18:00"]])).toMatch(/sobrepor/);
    expect(checkPeriods([["13:30", "18:00"], ["08:00", "12:00"]])).toMatch(/sobrepor/);
    expect(checkPeriods([["07:00", "08:00"], ["09:00", "10:00"], ["11:00", "12:00"]])).toMatch(/dois períodos/);
  });

  test("o que vem do banco é conferido: semana inválida vira null, período inválido some", () => {
    expect(parseWeek(WORK)).toEqual(WORK);
    expect(parseWeek({ ...WORK, 3: [["18:00", "08:00"]] })).toBeNull();
    expect(parseWeek({ 1: [] })).toBeNull();
    expect(parseWeek(null)).toBeNull();
    expect(parsePeriods([["08:00", "12:00"]])).toEqual([["08:00", "12:00"]]);
    expect(parsePeriods("lixo")).toEqual([]);
  });
});

describe("nationalHolidays", () => {
  test("Páscoa de anos conhecidos e os móveis derivados", () => {
    const days = (year: number) => Object.fromEntries(nationalHolidays(year).map((holiday) => [holiday.name, holiday]));
    expect(days(2025)["Sexta-feira Santa"].day).toBe("2025-04-18");
    const y2026 = days(2026);
    expect(y2026["Sexta-feira Santa"].day).toBe("2026-04-03");
    expect(y2026["Carnaval (segunda-feira)"]).toEqual({ day: "2026-02-16", name: "Carnaval (segunda-feira)", optional: true });
    expect(y2026["Carnaval (terça-feira)"].day).toBe("2026-02-17");
    expect(y2026["Corpus Christi"]).toEqual({ day: "2026-06-04", name: "Corpus Christi", optional: true });
    expect(days(2027)["Carnaval (terça-feira)"].day).toBe("2027-02-09");
    expect(days(2027)["Sexta-feira Santa"].day).toBe("2027-03-26");
  });

  test("fixos, em ordem de data, sem ponto facultativo entre os obrigatórios", () => {
    const list = nationalHolidays(2027);
    expect(list.map((holiday) => holiday.day)).toEqual([...list.map((holiday) => holiday.day)].sort());
    expect(list.filter((holiday) => !holiday.optional).map((holiday) => holiday.day.slice(5))).toEqual([
      "01-01", "03-26", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25",
    ]);
  });
});
