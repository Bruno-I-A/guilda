import "server-only";

import { randomInt } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { challengeDeadline } from "@/domain/closing-challenge";
import { pickClosingDraw } from "@/domain/closing-draw";
import type { ClosingGroup } from "@/lib/closings-ui";

import { loadChallengePool } from "./challenge-pool";
import { loadChallengeRules } from "./challenge-rules";

/**
 * O que rolar, desistir e liberar fazem no banco — compartilhado pelas Server
 * Actions da aba e pelas ferramentas do MCP, que só diferem em quem autoriza.
 * Quem chama já passou pelo gate; aqui mora a regra do jogo.
 *
 * O sorteio é do servidor: se o cliente mandasse a empresa, daria para
 * escolher a fácil. As travas (um desafio por pessoa, uma pessoa por empresa)
 * são índices únicos parciais — clique duplo e duas pessoas sorteando ao mesmo
 * tempo batem no banco, não em sorte.
 */

export interface RolledChallenge {
  id: string;
  clientId: string;
  clientName: string;
  year: number;
  startedAt: Date;
  deadlineAt: Date;
  timeLimitMinutes: number;
  baseXp: number;
  bonusXp: number;
}

const rolledColumns = {
  id: schema.closingChallenges.id,
  clientId: schema.closingChallenges.clientId,
  clientName: schema.clients.name,
  year: schema.closingChallenges.year,
  startedAt: schema.closingChallenges.startedAt,
  deadlineAt: schema.closingChallenges.deadlineAt,
  timeLimitMinutes: schema.closingChallenges.timeLimitMinutes,
  baseXp: schema.closingChallenges.baseXp,
  bonusXp: schema.closingChallenges.bonusXp,
};

async function challengeById(
  tx: OrgTx,
  orgId: string,
  challengeId: string,
): Promise<RolledChallenge | null> {
  const [row] = await tx
    .select(rolledColumns)
    .from(schema.closingChallenges)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.closingChallenges.clientId))
    .where(
      and(
        eq(schema.closingChallenges.orgId, orgId),
        eq(schema.closingChallenges.id, challengeId),
      ),
    );
  return row ?? null;
}

export async function activeChallengeOf(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<RolledChallenge | null> {
  const [row] = await tx
    .select(rolledColumns)
    .from(schema.closingChallenges)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.closingChallenges.clientId))
    .where(
      and(
        eq(schema.closingChallenges.orgId, orgId),
        eq(schema.closingChallenges.userId, userId),
        eq(schema.closingChallenges.status, "active"),
      ),
    );
  return row ?? null;
}

/**
 * Sorteia e reserva. Com desafio em andamento devolve o que já existe
 * (`reused`): é o clique duplo, ou outra aba, ou o agente repetindo a chamada.
 */
export async function rollChallenge(
  tx: OrgTx,
  input: { orgId: string; userId: string; year: number; group: ClosingGroup },
): Promise<
  | { ok: true; challenge: RolledChallenge; reused: boolean }
  | { ok: false; error: string }
> {
  const existing = await activeChallengeOf(tx, input.orgId, input.userId);
  if (existing) return { ok: true, challenge: existing, reused: true };

  const rules = await loadChallengeRules(tx, input.orgId);
  let pool = await loadChallengePool(tx, {
    orgId: input.orgId,
    year: input.year,
    group: input.group,
  });

  // Quem desistiu e rola de novo não recebe a mesma empresa, se houver outra.
  const [last] = await tx
    .select({
      clientId: schema.closingChallenges.clientId,
      status: schema.closingChallenges.status,
    })
    .from(schema.closingChallenges)
    .where(
      and(
        eq(schema.closingChallenges.orgId, input.orgId),
        eq(schema.closingChallenges.userId, input.userId),
      ),
    )
    .orderBy(desc(schema.closingChallenges.startedAt))
    .limit(1);
  const previousId = last?.status === "abandoned" ? last.clientId : null;

  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const pick = pickClosingDraw(pool, previousId, () => randomInt(1_000_000) / 1_000_000);
    if (!pick) return { ok: false, error: `Nenhuma empresa livre para sortear em ${input.year}.` };

    const startedAt = new Date();
    const [created] = await tx
      .insert(schema.closingChallenges)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        clientId: pick.id,
        year: input.year,
        startedAt,
        deadlineAt: challengeDeadline(startedAt, rules.timeLimitMinutes),
        timeLimitMinutes: rules.timeLimitMinutes,
        baseXp: rules.baseXp,
        bonusXp: rules.bonusXp,
      })
      .onConflictDoNothing()
      .returning({ id: schema.closingChallenges.id });
    if (created) {
      const challenge = await challengeById(tx, input.orgId, created.id);
      if (challenge) return { ok: true, challenge, reused: false };
    }
    // Conflito: ou esta pessoa rolou em outro lugar agora, ou outra pessoa
    // reservou esta empresa no mesmo instante.
    const mine = await activeChallengeOf(tx, input.orgId, input.userId);
    if (mine) return { ok: true, challenge: mine, reused: true };
    pool = pool.filter((company) => company.id !== pick.id);
  }
  return { ok: false, error: "Não consegui reservar uma empresa agora. Tente rolar de novo." };
}

/** Quem rolou desiste do próprio desafio: sem XP, a empresa volta ao sorteio. */
export async function abandonChallenge(
  tx: OrgTx,
  input: { orgId: string; challengeId: string; userId: string },
): Promise<boolean> {
  const [ended] = await tx
    .update(schema.closingChallenges)
    .set({ status: "abandoned", endedAt: new Date(), endedBy: input.userId })
    .where(
      and(
        eq(schema.closingChallenges.orgId, input.orgId),
        eq(schema.closingChallenges.id, input.challengeId),
        eq(schema.closingChallenges.userId, input.userId),
        eq(schema.closingChallenges.status, "active"),
      ),
    )
    .returning({ id: schema.closingChallenges.id });
  return Boolean(ended);
}

/** A liderança libera a reserva de outra pessoa — vira desistência, sem XP. */
export async function releaseChallenge(
  tx: OrgTx,
  input: { orgId: string; challengeId: string; releasedBy: string },
): Promise<boolean> {
  const [ended] = await tx
    .update(schema.closingChallenges)
    .set({ status: "abandoned", endedAt: new Date(), endedBy: input.releasedBy })
    .where(
      and(
        eq(schema.closingChallenges.orgId, input.orgId),
        eq(schema.closingChallenges.id, input.challengeId),
        eq(schema.closingChallenges.status, "active"),
      ),
    )
    .returning({ id: schema.closingChallenges.id });
  return Boolean(ended);
}
