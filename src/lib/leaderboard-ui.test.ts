import { describe, expect, it } from "vitest";

import { leaderboardWindowLabel } from "./leaderboard-ui";

/** Instante ISO em UTC. São Paulo está três horas atrás. */
const at = (iso: string) => new Date(iso);

describe("leaderboardWindowLabel", () => {
  it("mostra a semana de segunda a domingo, sem repetir o mês", () => {
    // Quarta 2026-09-09 em São Paulo: semana de 7 (segunda) a 13 (domingo).
    expect(leaderboardWindowLabel("week", at("2026-09-09T15:00:00Z"))).toBe(
      "7 a 13 de setembro",
    );
  });

  it("nomeia os dois meses quando a semana atravessa a virada", () => {
    // Quarta 2026-04-01 em São Paulo: a semana começou na segunda 2026-03-30.
    expect(leaderboardWindowLabel("week", at("2026-04-01T15:00:00Z"))).toBe(
      "30 de março a 5 de abril",
    );
  });

  it("fecha a semana no domingo, e não na segunda de manhã", () => {
    // Domingo 2026-09-13 às 23h em São Paulo — a ponta mais escorregadia: o
    // fim da janela em UTC já é segunda.
    expect(leaderboardWindowLabel("week", at("2026-09-14T02:00:00Z"))).toBe(
      "7 a 13 de setembro",
    );
  });

  it("mostra o mês por nome e ano", () => {
    expect(leaderboardWindowLabel("month", at("2026-09-09T15:00:00Z"))).toBe(
      "setembro de 2026",
    );
  });

  it("nomeia o mês certo na virada, quando UTC já passou da meia-noite", () => {
    // 2026-03-02T02:00Z é 1º de março, 23h, em São Paulo.
    expect(leaderboardWindowLabel("month", at("2026-03-02T02:00:00Z"))).toBe(
      "março de 2026",
    );
  });

  it("carreira não tem janela", () => {
    expect(leaderboardWindowLabel("all", at("2026-09-09T15:00:00Z"))).toBeNull();
  });
});
