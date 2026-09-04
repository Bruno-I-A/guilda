import { describe, expect, test } from "vitest";

import {
  DEFAULT_LEADERBOARD_TIME_ZONE,
  leaderboardPeriodRange,
} from "./leaderboard-period";

/** Atalho: instante ISO em UTC. */
const at = (iso: string) => new Date(iso);
/** Atalho: compara instantes por ISO, que falha legível. */
const iso = (value: Date | null) => value?.toISOString() ?? null;

describe("leaderboardPeriodRange — semana", () => {
  test("segunda de madrugada em São Paulo começa a semana no próprio dia", () => {
    // Segunda 2026-09-07, 00h30 em São Paulo (03h30 UTC).
    const range = leaderboardPeriodRange("week", at("2026-09-07T03:30:00Z"));
    expect(iso(range.start)).toBe("2026-09-07T03:00:00.000Z");
    expect(iso(range.end)).toBe("2026-09-14T03:00:00.000Z");
  });

  test("domingo 23h em São Paulo ainda é a semana da segunda anterior", () => {
    // 2026-09-14T02:00Z já é SEGUNDA em UTC, mas em São Paulo ainda é domingo
    // 2026-09-13 às 23h. É exatamente o caso que UTC cru erra: mandaria o XP
    // do domingo à noite para a semana seguinte.
    const range = leaderboardPeriodRange("week", at("2026-09-14T02:00:00Z"));
    expect(iso(range.start)).toBe("2026-09-07T03:00:00.000Z");
    expect(iso(range.end)).toBe("2026-09-14T03:00:00.000Z");
  });

  test("um minuto depois, já em São Paulo é segunda e a semana virou", () => {
    const range = leaderboardPeriodRange("week", at("2026-09-14T03:00:00Z"));
    expect(iso(range.start)).toBe("2026-09-14T03:00:00.000Z");
    expect(iso(range.end)).toBe("2026-09-21T03:00:00.000Z");
  });

  test("semana que atravessa a virada de mês não parte em duas", () => {
    // Quarta 2026-04-01 em São Paulo: a semana começou na segunda 2026-03-30.
    const range = leaderboardPeriodRange("week", at("2026-04-01T15:00:00Z"));
    expect(iso(range.start)).toBe("2026-03-30T03:00:00.000Z");
    expect(iso(range.end)).toBe("2026-04-06T03:00:00.000Z");
  });
});

describe("leaderboardPeriodRange — mês", () => {
  test("dia 1º à noite em São Paulo abre o mês naquele mesmo dia", () => {
    // 2026-03-02T02:00Z é 1º de março, 23h, em São Paulo: a data em UTC e a
    // data no fuso são DIFERENTES, e o mês certo é março, não fevereiro.
    const range = leaderboardPeriodRange("month", at("2026-03-02T02:00:00Z"));
    expect(iso(range.start)).toBe("2026-03-01T03:00:00.000Z");
    expect(iso(range.end)).toBe("2026-04-01T03:00:00.000Z");
  });

  test("último dia do mês ainda pertence ao mês que termina", () => {
    // Sábado 2026-01-31, 23h30 em São Paulo (2026-02-01T02:30Z).
    const range = leaderboardPeriodRange("month", at("2026-02-01T02:30:00Z"));
    expect(iso(range.start)).toBe("2026-01-01T03:00:00.000Z");
    expect(iso(range.end)).toBe("2026-02-01T03:00:00.000Z");
  });

  test("dezembro fecha em 1º de janeiro do ano seguinte", () => {
    const range = leaderboardPeriodRange("month", at("2026-12-15T12:00:00Z"));
    expect(iso(range.start)).toBe("2026-12-01T03:00:00.000Z");
    expect(iso(range.end)).toBe("2027-01-01T03:00:00.000Z");
  });

  test("fevereiro de ano bissexto fecha em 1º de março", () => {
    const range = leaderboardPeriodRange("month", at("2028-02-20T12:00:00Z"));
    expect(iso(range.start)).toBe("2028-02-01T03:00:00.000Z");
    expect(iso(range.end)).toBe("2028-03-01T03:00:00.000Z");
  });
});

describe("leaderboardPeriodRange — geral", () => {
  test('"all" não tem limite dos dois lados', () => {
    expect(leaderboardPeriodRange("all", at("2026-09-04T12:00:00Z"))).toEqual({
      start: null,
      end: null,
    });
  });
});

describe("leaderboardPeriodRange — offset do fuso", () => {
  test("o fuso padrão é o do escritório", () => {
    const instant = at("2026-09-14T02:00:00Z");
    expect(leaderboardPeriodRange("week", instant)).toEqual(
      leaderboardPeriodRange("week", instant, DEFAULT_LEADERBOARD_TIME_ZONE),
    );
  });

  test("mede a offset em cada borda, não uma offset fixa", () => {
    // Nova York, semana da virada do horário de verão (domingo 2026-03-08):
    // a segunda que abre a semana ainda é EST (UTC−5) e a que a fecha já é
    // EDT (UTC−4). Bordas com offsets diferentes na MESMA semana — é o que
    // quebraria um cálculo que aplicasse uma offset só.
    const range = leaderboardPeriodRange(
      "week",
      at("2026-03-08T18:00:00Z"),
      "America/New_York",
    );
    expect(iso(range.start)).toBe("2026-03-02T05:00:00.000Z");
    expect(iso(range.end)).toBe("2026-03-09T04:00:00.000Z");
  });

  test("mês de verão e mês de inverno em Nova York têm offsets distintos", () => {
    const summer = leaderboardPeriodRange(
      "month",
      at("2026-07-15T12:00:00Z"),
      "America/New_York",
    );
    expect(iso(summer.start)).toBe("2026-07-01T04:00:00.000Z");

    const winter = leaderboardPeriodRange(
      "month",
      at("2026-01-15T12:00:00Z"),
      "America/New_York",
    );
    expect(iso(winter.start)).toBe("2026-01-01T05:00:00.000Z");
  });

  test("UTC como fuso devolve meia-noite cheia", () => {
    const range = leaderboardPeriodRange(
      "week",
      at("2026-09-14T02:00:00Z"),
      "UTC",
    );
    // Em UTC o instante já é segunda: a semana é a que COMEÇA nele.
    expect(iso(range.start)).toBe("2026-09-14T00:00:00.000Z");
    expect(iso(range.end)).toBe("2026-09-21T00:00:00.000Z");
  });
});
