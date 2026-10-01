/**
 * Desafio do dado nos Fechamentos (funções puras).
 *
 * Desenho aprovado em docs/superpowers/specs/2026-10-01-desafio-do-dado-design.md.
 * Rolou, a empresa fica reservada para quem rolou e corre um prazo; fechar o
 * período paga a base, e dentro do prazo paga também o bônus. O teto diário
 * é a trava contra XP fabricado: o fechamento é registrado pela própria
 * pessoa, e sem teto "rolar e marcar fechado" viraria fábrica de XP.
 */

import { isClosingDrawEligible, type ClosingDrawFacts } from "./closing-draw";

export type ChallengeStatus = "active" | "completed" | "abandoned" | "blocked" | "taken";

export const CHALLENGE_STATUSES = [
  "active",
  "completed",
  "abandoned",
  "blocked",
  "taken",
] as const satisfies readonly ChallengeStatus[];

export interface ChallengeRules {
  timeLimitMinutes: number;
  baseXp: number;
  bonusXp: number;
  dailyPaidCap: number;
}

/** Os 30 minutos são o tempo real de um fechamento, segundo o Bruno. */
export const DEFAULT_CHALLENGE_RULES: ChallengeRules = {
  timeLimitMinutes: 30,
  baseXp: 15,
  bonusXp: 15,
  dailyPaidCap: 10,
};

export const CHALLENGE_RULE_LIMITS: Record<keyof ChallengeRules, { min: number; max: number }> = {
  timeLimitMinutes: { min: 5, max: 240 },
  baseXp: { min: 0, max: 100 },
  bonusXp: { min: 0, max: 100 },
  dailyPaidCap: { min: 0, max: 50 },
};

export function challengeDeadline(startedAt: Date, timeLimitMinutes: number): Date {
  return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
}

/** Empresas que podem sair no dado: as elegíveis que ninguém reservou. */
export function challengePool<T extends { id: string } & ClosingDrawFacts>(
  companies: readonly T[],
  reservedIds: ReadonlySet<string>,
): T[] {
  return companies.filter(
    (company) => isClosingDrawEligible(company) && !reservedIds.has(company.id),
  );
}

interface CompletedPeriodFact {
  id: string;
  completedBy: string | null;
  completedAt: Date | null;
}

export interface ChallengeFacts {
  challenger: string;
  startedAt: Date;
  /** Períodos FECHADOS da empresa no ano do desafio. */
  completedPeriods: readonly CompletedPeriodFact[];
  /** Observações da empresa no ano do desafio criadas desde o início. */
  observationsSinceStart: number;
}

export type ChallengeOutcome =
  | { status: "active" }
  | { status: "completed"; closingId: string; completedAt: Date }
  | { status: "taken" }
  | { status: "blocked" };

/**
 * Desfecho de um desafio EM ANDAMENTO, olhando só fatos posteriores à rolada.
 *
 * O fechamento de quem rolou vence tudo: se a pessoa anotou uma observação e
 * mesmo assim fechou, o trabalho foi feito. Atraso não muda o estado — fora do
 * prazo o desafio continua valendo a base.
 */
export function settleActiveChallenge(facts: ChallengeFacts): ChallengeOutcome {
  const desdeOInicio = facts.completedPeriods.filter(
    (period): period is CompletedPeriodFact & { completedAt: Date } =>
      period.completedAt !== null &&
      period.completedAt.getTime() >= facts.startedAt.getTime(),
  );
  const meu = desdeOInicio
    .filter((period) => period.completedBy === facts.challenger)
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())[0];
  if (meu) {
    return { status: "completed", closingId: meu.id, completedAt: meu.completedAt };
  }
  if (desdeOInicio.length > 0) return { status: "taken" };
  if (facts.observationsSinceStart > 0) return { status: "blocked" };
  return { status: "active" };
}

/** Quanto o desafio paga ao concluir. Passou do teto, termina sem XP. */
export function challengeAward(input: {
  inTime: boolean;
  baseXp: number;
  bonusXp: number;
  paidToday: number;
  dailyPaidCap: number;
}): { awardedXp: number; capped: boolean } {
  if (input.paidToday >= input.dailyPaidCap) return { awardedXp: 0, capped: true };
  return {
    awardedXp: input.baseXp + (input.inTime ? input.bonusXp : 0),
    capped: false,
  };
}

/**
 * XP que o desafio deve estar segurando agora: o prêmio congelado, enquanto o
 * período que o concluiu continuar fechado por quem rolou. Reabrir estorna,
 * fechar de novo devolve — o mesmo raciocínio do fechamento de ano.
 */
export function challengeHeldXp(input: {
  status: ChallengeStatus;
  awardedXp: number | null;
  linkedPeriodClosedByChallenger: boolean;
}): number {
  if (input.status !== "completed" || !input.linkedPeriodClosedByChallenger) return 0;
  return input.awardedXp ?? 0;
}

export type ChallengeXpReason = "closing_challenge" | "closing_challenge_reversal";

/** O que falta lançar para o saldo do desafio no ledger bater com o devido. */
export function challengeXpEntry(input: {
  net: number;
  held: number;
}): { amount: number; reason: ChallengeXpReason } | null {
  const amount = input.held - input.net;
  if (amount === 0) return null;
  return { amount, reason: amount > 0 ? "closing_challenge" : "closing_challenge_reversal" };
}

/** Cronômetro da faixa: mm:ss enquanto há prazo, minutos de atraso depois. */
export function challengeClock(
  deadlineMs: number,
  nowMs: number,
): { late: boolean; label: string } {
  const restante = deadlineMs - nowMs;
  if (restante >= 0) {
    const segundos = Math.ceil(restante / 1000);
    const minutos = Math.floor(segundos / 60);
    return {
      late: false,
      label: `${String(minutos).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`,
    };
  }
  const atraso = Math.max(1, Math.floor(-restante / 60_000));
  return { late: true, label: `atrasado há ${atraso} min` };
}

export interface ChallengeResultFacts {
  status: Exclude<ChallengeStatus, "active">;
  inTime: boolean | null;
  /** O prêmio congelado na conclusão. */
  awardedXp: number | null;
  /**
   * O saldo do desafio no ledger agora. Difere do prêmio quando o período foi
   * reaberto ou excluído depois — e aí a faixa não pode prometer o XP.
   */
  heldXp: number;
  capped: boolean;
  startedAt: Date;
  endedAt: Date | null;
  /** Desistência registrada pela liderança, não por quem rolou. */
  releasedByOther: boolean;
}

/** O que a faixa diz quando o desafio terminou; `xp` só quando pagou. */
export function challengeResult(facts: ChallengeResultFacts): {
  xp: number | null;
  text: string;
} {
  switch (facts.status) {
    case "completed": {
      const minutos = facts.endedAt
        ? Math.max(1, Math.round((facts.endedAt.getTime() - facts.startedAt.getTime()) / 60_000))
        : null;
      const tempo = minutos === null ? "" : ` em ${minutos} min`;
      // Base e bônus em zero também caem aqui: concluiu, mas não pagou.
      if (facts.capped || !facts.awardedXp) {
        return { xp: null, text: `fechada${tempo} · teto do dia, sem XP` };
      }
      if (facts.heldXp <= 0) {
        return { xp: null, text: "estornado · o período foi reaberto ou excluído" };
      }
      return {
        xp: facts.awardedXp,
        text: `${facts.inTime ? "no prazo" : "fora do prazo"}${tempo}`,
      };
    }
    case "blocked":
      return { xp: null, text: "travado por observação · sem XP" };
    case "taken":
      return { xp: null, text: "fechada por outra pessoa · sem XP" };
    case "abandoned":
      return {
        xp: null,
        text: facts.releasedByOther ? "liberado pela liderança · sem XP" : "você desistiu · sem XP",
      };
  }
}
