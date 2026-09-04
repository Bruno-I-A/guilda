/**
 * Janela de tempo do ranking (decisão de 2026-09-04).
 *
 * "Semana" e "Mês" eram janelas MÓVEIS (`agora − 7 dias`, `agora − 30 dias`).
 * Janela móvel dá a cada pessoa uma largada diferente e nunca zera: o que a
 * tela chamava de competição era uma média móvel. Aqui os dois períodos são
 * de CALENDÁRIO — largada e chegada comuns para a equipe inteira, e o ranking
 * recomeça junto para todo mundo.
 *
 * A semana começa na SEGUNDA porque é semana de trabalho de escritório, não
 * semana de calendário americano; o mês começa no dia 1º.
 *
 * Tudo no fuso do escritório (America/Sao_Paulo), NUNCA em UTC cru: em UTC a
 * semana viraria às 21h de domingo no horário de Brasília, e quem concluísse
 * uma missão no domingo à noite pontuaria na semana seguinte.
 *
 * `now` é PARÂMETRO de propósito (nada de `Date.now()` aqui dentro): é o que
 * torna as datas de virada testáveis.
 */

export type LeaderboardPeriod = "week" | "month" | "all";

export interface PeriodRange {
  /** Primeiro instante do período (inclusivo). `null` = sem limite. */
  start: Date | null;
  /** Primeiro instante do período SEGUINTE (exclusivo). `null` = sem limite. */
  end: Date | null;
}

export const DEFAULT_LEADERBOARD_TIME_ZONE = "America/Sao_Paulo";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // hourCycle "h23" e não `hour12: false`: com hour12 a meia-noite sai como
    // "24" em alguns motores, e o cálculo de offset erraria um dia inteiro.
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

interface WallClock {
  year: number;
  /** 1 a 12 (e não o 0 a 11 do `Date`). */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** O que o relógio do fuso mostra num dado instante. */
function wallClockAt(instant: Date, timeZone: string): WallClock {
  const parts = wallClockFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPart["type"]): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset do fuso NAQUELE instante, em ms (hora de parede − UTC). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClockAt(instant, timeZone);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // `formatToParts` não devolve milissegundos: compara com o instante truncado
  // no segundo, senão a offset viria com um resto de até 999 ms.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Instante UTC da meia-noite de uma data civil no fuso.
 *
 * Escrito para offset VARIÁVEL: chuta a meia-noite como se o fuso fosse UTC,
 * mede a offset nesse chute, corrige, e mede uma segunda vez — é a segunda
 * medição que acerta quando o chute cai do outro lado de uma virada de horário
 * de verão. O Brasil não tem mais horário de verão desde 2019, mas o fuso é
 * parâmetro e o código não deve depender disso.
 *
 * Mês/dia fora da faixa são intencionais: `Date.UTC` transborda sozinho
 * (mês 13 → janeiro do ano seguinte, dia 0 → último dia do mês anterior), o
 * que dispensa aritmética de calendário na hora de achar a borda do período.
 */
function startOfZonedDay(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day);
  const firstPass = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(firstPass), timeZone));
}

/** Início e fim do período do ranking, no fuso do escritório. */
export function leaderboardPeriodRange(
  period: LeaderboardPeriod,
  now: Date,
  timeZone: string = DEFAULT_LEADERBOARD_TIME_ZONE,
): PeriodRange {
  if (period === "all") {
    return { start: null, end: null };
  }

  const wall = wallClockAt(now, timeZone);

  if (period === "month") {
    return {
      start: startOfZonedDay(wall.year, wall.month, 1, timeZone),
      end: startOfZonedDay(wall.year, wall.month + 1, 1, timeZone),
    };
  }

  // Dia da semana da data de PAREDE (0 = domingo). O cálculo é civil, sobre a
  // data que o fuso mostra — usar `now.getUTCDay()` erraria a semana toda
  // sempre que a data em UTC já virou e a de São Paulo não (domingo à noite).
  const civilWeekday = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day),
  ).getUTCDay();
  // Segunda = 0, terça = 1, ..., domingo = 6.
  const daysSinceMonday = (civilWeekday + 6) % 7;
  return {
    start: startOfZonedDay(
      wall.year,
      wall.month,
      wall.day - daysSinceMonday,
      timeZone,
    ),
    end: startOfZonedDay(
      wall.year,
      wall.month,
      wall.day - daysSinceMonday + 7,
      timeZone,
    ),
  };
}
