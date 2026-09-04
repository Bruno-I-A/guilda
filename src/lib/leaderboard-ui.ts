import {
  DEFAULT_LEADERBOARD_TIME_ZONE,
  leaderboardPeriodRange,
  type LeaderboardPeriod,
} from "@/domain/leaderboard-period";

/**
 * A janela do período em português, para a tela dizer QUAL semana e QUAL mês.
 *
 * Existe porque "Semana" e "Mês" viraram períodos de calendário: a largada e a
 * chegada passaram a ser as mesmas para a equipe inteira, e essa é justamente
 * a informação que o rótulo seco escondia. Sem ela a pessoa não sabe se o
 * placar zera hoje ou daqui a cinco dias.
 *
 * "Carreira" não tem janela — é o acumulado desde sempre — e devolve `null`.
 */
export function leaderboardWindowLabel(
  period: LeaderboardPeriod,
  now: Date,
  timeZone: string = DEFAULT_LEADERBOARD_TIME_ZONE,
): string | null {
  const { start, end } = leaderboardPeriodRange(period, now, timeZone);
  if (!start || !end) return null;

  // `end` é o primeiro instante do período SEGUINTE. O último dia da janela é
  // o instante anterior a ele — sem isso, a semana apareceria terminando na
  // segunda de manhã em vez do domingo.
  const lastDay = new Date(end.getTime() - 1);

  if (period === "month") {
    return format(start, timeZone, { month: "long", year: "numeric" });
  }

  const sameMonth =
    format(start, timeZone, { month: "numeric", year: "numeric" }) ===
    format(lastDay, timeZone, { month: "numeric", year: "numeric" });

  // Semana dentro do mesmo mês não repete o nome do mês nas duas pontas.
  return sameMonth
    ? `${format(start, timeZone, { day: "numeric" })} a ${format(lastDay, timeZone, { day: "numeric", month: "long" })}`
    : `${format(start, timeZone, { day: "numeric", month: "long" })} a ${format(lastDay, timeZone, { day: "numeric", month: "long" })}`;
}

function format(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, ...options }).format(
    instant,
  );
}
