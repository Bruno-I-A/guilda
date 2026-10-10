import { APP_TIME_ZONE } from "@/lib/date-time";

const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(date: Date): Record<string, string> {
  return Object.fromEntries(FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
}

/**
 * dhEmi no formato do leiaute (AAAA-MM-DDThh:mm:ss-03:00). Brasília não tem
 * horário de verão desde 2019. Um minuto antes do relógio do servidor: o
 * Sistema Nacional recusa emissão "no futuro" e relógios divergem.
 */
export function nfseIssueTimestamp(now: Date): string {
  const p = parts(new Date(now.getTime() - 60_000));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
}

/** Hoje (AAAA-MM-DD) no fuso da Guilda. */
export function nfseToday(now: Date): string {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}
