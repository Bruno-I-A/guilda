import { describe, expect, test } from "vitest";

import {
  CHALLENGE_RULE_LIMITS,
  challengeAward,
  challengeClock,
  challengeDeadline,
  challengeHeldXp,
  challengePool,
  challengeResult,
  challengeXpEntry,
  DEFAULT_CHALLENGE_RULES,
  settleActiveChallenge,
} from "./closing-challenge";

const inicio = new Date("2026-10-01T13:00:00Z");
const depois = (min: number) => new Date(inicio.getTime() + min * 60_000);

describe("desfecho do desafio em andamento", () => {
  const base = { challenger: "ana", startedAt: inicio, observationsSinceStart: 0 };

  test("período fechado por quem rolou, depois do início, conclui", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [{ id: "p1", completedBy: "ana", completedAt: depois(18) }],
    });
    expect(desfecho).toEqual({ status: "completed", closingId: "p1", completedAt: depois(18) });
  });

  test("com dois períodos, vale o primeiro fechado", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [
        { id: "tarde", completedBy: "ana", completedAt: depois(40) },
        { id: "cedo", completedBy: "ana", completedAt: depois(10) },
      ],
    });
    expect(desfecho).toMatchObject({ status: "completed", closingId: "cedo" });
  });

  test("fechado por outra pessoa encerra sem XP", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [{ id: "p1", completedBy: "bruno", completedAt: depois(5) }],
    });
    expect(desfecho).toEqual({ status: "taken" });
  });

  test("o fechamento de quem rolou vence o de outra pessoa", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [
        { id: "outro", completedBy: "bruno", completedAt: depois(5) },
        { id: "meu", completedBy: "ana", completedAt: depois(9) },
      ],
    });
    expect(desfecho).toMatchObject({ status: "completed", closingId: "meu" });
  });

  test("período fechado ANTES de rolar não conta", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      completedPeriods: [{ id: "antigo", completedBy: "ana", completedAt: depois(-60) }],
    });
    expect(desfecho).toEqual({ status: "active" });
  });

  test("observação depois do início trava o desafio", () => {
    expect(
      settleActiveChallenge({ ...base, completedPeriods: [], observationsSinceStart: 1 }),
    ).toEqual({ status: "blocked" });
  });

  test("fechou e anotou: o trabalho feito vence a observação", () => {
    const desfecho = settleActiveChallenge({
      ...base,
      observationsSinceStart: 2,
      completedPeriods: [{ id: "p1", completedBy: "ana", completedAt: depois(12) }],
    });
    expect(desfecho.status).toBe("completed");
  });

  test("sem fato novo, continua em andamento — atrasado ainda vale a base", () => {
    expect(settleActiveChallenge({ ...base, completedPeriods: [] })).toEqual({ status: "active" });
  });
});

describe("prêmio", () => {
  const regras = { baseXp: 15, bonusXp: 15, dailyPaidCap: 10 };

  test("no prazo paga base + bônus", () => {
    expect(challengeAward({ ...regras, inTime: true, paidToday: 0 })).toEqual({
      awardedXp: 30,
      capped: false,
    });
  });

  test("fora do prazo paga só a base", () => {
    expect(challengeAward({ ...regras, inTime: false, paidToday: 3 })).toEqual({
      awardedXp: 15,
      capped: false,
    });
  });

  test("bateu o teto do dia: termina, mas não paga", () => {
    expect(challengeAward({ ...regras, inTime: true, paidToday: 10 })).toEqual({
      awardedXp: 0,
      capped: true,
    });
  });
});

describe("XP retido e lançamento no ledger", () => {
  test("concluído com o período ainda fechado por quem rolou segura o prêmio", () => {
    expect(
      challengeHeldXp({ status: "completed", awardedXp: 30, linkedPeriodClosedByChallenger: true }),
    ).toBe(30);
  });

  test("período reaberto: o desafio não segura nada", () => {
    expect(
      challengeHeldXp({ status: "completed", awardedXp: 30, linkedPeriodClosedByChallenger: false }),
    ).toBe(0);
  });

  test("desafio que não concluiu nunca segura XP", () => {
    for (const status of ["active", "abandoned", "blocked", "taken"] as const) {
      expect(challengeHeldXp({ status, awardedXp: 30, linkedPeriodClosedByChallenger: true })).toBe(0);
    }
  });

  test("lança só a diferença, com o rótulo certo", () => {
    expect(challengeXpEntry({ net: 0, held: 30 })).toEqual({
      amount: 30,
      reason: "closing_challenge",
    });
    expect(challengeXpEntry({ net: 30, held: 0 })).toEqual({
      amount: -30,
      reason: "closing_challenge_reversal",
    });
    expect(challengeXpEntry({ net: 30, held: 30 })).toBeNull();
  });
});

describe("sorteio e prazo", () => {
  test("o pool tira as inelegíveis e as reservadas", () => {
    const empresas = [
      { id: "livre", yearClosed: false, periodCount: 0, observationCount: 0 },
      { id: "reservada", yearClosed: false, periodCount: 0, observationCount: 0 },
      { id: "com-periodo", yearClosed: false, periodCount: 1, observationCount: 0 },
    ];
    expect(challengePool(empresas, new Set(["reservada"])).map((e) => e.id)).toEqual(["livre"]);
  });

  test("o prazo soma os minutos ao início", () => {
    expect(challengeDeadline(inicio, 30)).toEqual(depois(30));
  });

  test("as regras padrão cabem nos limites", () => {
    for (const [chave, valor] of Object.entries(DEFAULT_CHALLENGE_RULES)) {
      const limite = CHALLENGE_RULE_LIMITS[chave as keyof typeof CHALLENGE_RULE_LIMITS];
      expect(valor).toBeGreaterThanOrEqual(limite.min);
      expect(valor).toBeLessThanOrEqual(limite.max);
    }
  });
});

describe("cronômetro", () => {
  const prazo = depois(30).getTime();

  test("conta o que falta em mm:ss", () => {
    expect(challengeClock(prazo, inicio.getTime())).toEqual({ late: false, label: "30:00" });
    expect(challengeClock(prazo, depois(29).getTime() + 30_500)).toEqual({
      late: false,
      label: "00:30",
    });
  });

  test("passou do prazo vira atraso em minutos", () => {
    expect(challengeClock(prazo, prazo + 10_000)).toEqual({
      late: true,
      label: "atrasado há 1 min",
    });
    expect(challengeClock(prazo, prazo + 5 * 60_000)).toEqual({
      late: true,
      label: "atrasado há 5 min",
    });
  });
});

describe("resultado", () => {
  const fatos = {
    inTime: true,
    awardedXp: 30,
    capped: false,
    startedAt: inicio,
    endedAt: depois(18),
    releasedByOther: false,
  };

  test("no prazo mostra o XP e o tempo", () => {
    expect(challengeResult({ ...fatos, status: "completed" })).toEqual({
      xp: 30,
      text: "no prazo em 18 min",
    });
  });

  test("fora do prazo mostra a base", () => {
    expect(
      challengeResult({
        ...fatos,
        status: "completed",
        inTime: false,
        awardedXp: 15,
        endedAt: depois(42),
      }),
    ).toEqual({ xp: 15, text: "fora do prazo em 42 min" });
  });

  test("teto do dia: fechada, sem XP", () => {
    expect(
      challengeResult({ ...fatos, status: "completed", awardedXp: 0, capped: true }),
    ).toEqual({ xp: null, text: "fechada em 18 min · teto do dia, sem XP" });
  });

  test("os finais sem XP dizem por quê", () => {
    expect(challengeResult({ ...fatos, status: "blocked" }).text).toBe(
      "travado por observação · sem XP",
    );
    expect(challengeResult({ ...fatos, status: "taken" }).text).toBe(
      "fechada por outra pessoa · sem XP",
    );
    expect(challengeResult({ ...fatos, status: "abandoned" }).text).toBe("você desistiu · sem XP");
    expect(challengeResult({ ...fatos, status: "abandoned", releasedByOther: true }).text).toBe(
      "liberado pela liderança · sem XP",
    );
  });
});
