export interface ZonedMinute {
  date: string;
  time: string;
  minutes: number;
}

export function zonedMinute(now: Date, timezone: string): ZonedMinute {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  const time = `${part("hour")}:${part("minute")}`;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

export function timeToMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isQuietMinute(
  currentMinutes: number,
  quietStart: string | null,
  quietEnd: string | null,
): boolean {
  const start = timeToMinutes(quietStart);
  const end = timeToMinutes(quietEnd);
  if (start === null || end === null || start === end) return false;
  return start < end
    ? currentMinutes >= start && currentMinutes < end
    : currentMinutes >= start || currentMinutes < end;
}

/** O worker roda por minuto; tolerância evita perder o ciclo por poucos segundos. */
export function isScheduledMinute(now: ZonedMinute, scheduledTime: string): boolean {
  const scheduled = timeToMinutes(scheduledTime);
  return scheduled !== null && Math.abs(now.minutes - scheduled) <= 1;
}

