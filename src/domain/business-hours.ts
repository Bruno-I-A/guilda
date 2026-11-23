/**
 * Expediente do escritório no Atendimento (2026-11-23, pedido do Bruno): semana
 * com até dois períodos por dia (manhã e tarde) e dias especiais (feriado, meio
 * período). Puro: o horário é o de Brasília e o relógio entra por parâmetro.
 * Sem semana cadastrada, o escritório conta como sempre aberto.
 */
import { APP_TIME_ZONE } from "@/lib/date-time";

export type Period = readonly [string, string];
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeekSchedule = Readonly<Record<IsoWeekday, readonly Period[]>>;
export type SpecialDay = Readonly<{ day: string; name: string; periods: readonly Period[] }>;
export type BusinessSchedule = Readonly<{ week: WeekSchedule | null; specialDays: readonly SpecialDay[] }>;
export type HoursNow = Readonly<{ open: boolean; nextOpening: Date | null; closesAt: Date | null }>;
export type HolidaySuggestion = Readonly<{ day: string; name: string; optional: boolean }>;

export const WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_LABELS: Readonly<Record<IsoWeekday, string>> = {
  1: "segunda-feira",
  2: "terça-feira",
  3: "quarta-feira",
  4: "quinta-feira",
  5: "sexta-feira",
  6: "sábado",
  7: "domingo",
};
export const MAX_PERIODS_PER_DAY = 2;
export const ALWAYS_OPEN: HoursNow = { open: true, nextOpening: null, closesAt: null };
/** Até onde procurar a próxima abertura: um ano e pouco cobre qualquer recesso. */
const SEARCH_DAYS = 400;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function minutesOf(time: string): number | null {
  const match = TIME.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "8h", "13h30", "9h05": como se fala o horário. */
export function hourLabel(minutes: number): string {
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? String(rest).padStart(2, "0") : ""}`;
}

/** Devolve o problema dos períodos de um dia, ou null. */
export function checkPeriods(periods: readonly Period[]): string | null {
  if (periods.length > MAX_PERIODS_PER_DAY) return "Use no máximo dois períodos por dia.";
  let previousEnd = -1;
  for (const [start, end] of periods) {
    const from = minutesOf(start);
    const to = minutesOf(end);
    if (from === null || to === null) return "Use horários no formato 08:00.";
    if (from >= to) return "O período precisa terminar depois de começar.";
    if (from < previousEnd) return "Os períodos não podem se sobrepor, e o da manhã vem primeiro.";
    previousEnd = to;
  }
  return null;
}

function isPeriodList(value: unknown): value is Period[] {
  return (
    Array.isArray(value) &&
    value.every((item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "string")
  );
}

/** Períodos guardados no banco: o que não tiver a forma certa conta como fechado. */
export function parsePeriods(value: unknown): Period[] {
  if (!isPeriodList(value) || checkPeriods(value) !== null) return [];
  return value.map(([start, end]) => [start, end] as const);
}

/** Semana guardada no banco: inválida vira null (sempre aberto), nunca exceção. */
export function parseWeek(value: unknown): WeekSchedule | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const week = {} as Record<IsoWeekday, Period[]>;
  for (const day of WEEKDAYS) {
    const periods = record[String(day)];
    if (!isPeriodList(periods) || checkPeriods(periods) !== null) return null;
    week[day] = periods.map(([start, end]) => [start, end] as const);
  }
  return week;
}

const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function wallClock(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(clock.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Dia (AAAA-MM-DD) e minuto do dia em Brasília. */
export function localClock(instant: Date): { day: string; minutes: number } {
  const wall = wallClock(instant);
  return {
    day: `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`,
    minutes: wall.hour * 60 + wall.minute,
  };
}

function offsetMs(instant: number): number {
  const wall = wallClock(new Date(instant));
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(instant / 1000) * 1000;
}

/** O instante de um horário de Brasília (dia + minuto do dia). */
export function zonedTime(day: string, minutes: number): Date {
  const [year, month, date] = day.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, date, Math.floor(minutes / 60), minutes % 60);
  const first = guess - offsetMs(guess);
  return new Date(guess - offsetMs(first));
}

export function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

export function weekdayOf(day: string): IsoWeekday {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

/** AAAA-MM-DD que existe no calendário (31/02 não passa). */
export function isValidDay(day: string): boolean {
  return DAY.test(day) && addDays(day, 0) === day;
}

function periodsOn(schedule: BusinessSchedule, week: WeekSchedule, day: string): readonly Period[] {
  return schedule.specialDays.find((special) => special.day === day)?.periods ?? week[weekdayOf(day)];
}

/** O próximo começo de período depois de `now`, ou null se tudo estiver fechado. */
export function nextOpening(schedule: BusinessSchedule, now: Date): Date | null {
  if (!schedule.week) return null;
  const today = localClock(now);
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const day = addDays(today.day, offset);
    for (const [start] of periodsOn(schedule, schedule.week, day)) {
      const minutes = minutesOf(start);
      if (minutes !== null && (offset > 0 || minutes > today.minutes)) return zonedTime(day, minutes);
    }
  }
  return null;
}

export function hoursAt(schedule: BusinessSchedule, now: Date): HoursNow {
  if (!schedule.week) return ALWAYS_OPEN;
  const today = localClock(now);
  for (const [start, end] of periodsOn(schedule, schedule.week, today.day)) {
    const from = minutesOf(start);
    const to = minutesOf(end);
    if (from !== null && to !== null && today.minutes >= from && today.minutes < to) {
      return { open: true, nextOpening: null, closesAt: zonedTime(today.day, to) };
    }
  }
  return { open: false, nextOpening: nextOpening(schedule, now), closesAt: null };
}

/** "hoje às 13h30", "amanhã às 8h", "segunda-feira, 30/11, às 8h" ou "no próximo expediente". */
export function openingPhrase(opening: Date | null, now: Date): string {
  if (!opening) return "no próximo expediente";
  const today = localClock(now).day;
  const target = localClock(opening);
  const hour = hourLabel(target.minutes);
  if (target.day === today) return `hoje às ${hour}`;
  if (target.day === addDays(today, 1)) return `amanhã às ${hour}`;
  const [, month, date] = target.day.split("-");
  return `${WEEKDAY_LABELS[weekdayOf(target.day)]}, ${date}/${month}, às ${hour}`;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Feriados nacionais do ano para o Bruno marcar os que o escritório fecha.
 * Carnaval e Corpus Christi são ponto facultativo: vêm desmarcados na tela.
 */
export function nationalHolidays(year: number): HolidaySuggestion[] {
  const pascoa = easter(year);
  const fixed = (monthDay: string, name: string): HolidaySuggestion => ({ day: `${year}-${monthDay}`, name, optional: false });
  return [
    fixed("01-01", "Confraternização Universal"),
    { day: addDays(pascoa, -48), name: "Carnaval (segunda-feira)", optional: true },
    { day: addDays(pascoa, -47), name: "Carnaval (terça-feira)", optional: true },
    { day: addDays(pascoa, -2), name: "Sexta-feira Santa", optional: false },
    fixed("04-21", "Tiradentes"),
    fixed("05-01", "Dia do Trabalho"),
    { day: addDays(pascoa, 60), name: "Corpus Christi", optional: true },
    fixed("09-07", "Independência do Brasil"),
    fixed("10-12", "Nossa Senhora Aparecida"),
    fixed("11-02", "Finados"),
    fixed("11-15", "Proclamação da República"),
    fixed("11-20", "Dia Nacional de Zumbi e da Consciência Negra"),
    fixed("12-25", "Natal"),
  ].sort((left, right) => left.day.localeCompare(right.day));
}
