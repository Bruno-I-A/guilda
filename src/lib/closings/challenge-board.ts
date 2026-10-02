import "server-only";

import { and, asc, desc, eq, gte, or, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { ChallengeRules } from "@/domain/closing-challenge";

import { loadChallengeRules, START_OF_TODAY_SP } from "./challenge-rules";

export interface ChallengeBoardData {
  rules: ChallengeRules;
  mine: {
    id: string;
    clientId: string;
    clientName: string;
    taxRegime: schema.Client["taxRegime"];
    year: number;
    status: schema.ClosingChallenge["status"];
    startedAt: Date;
    deadlineAt: Date;
    endedAt: Date | null;
    endedBy: string | null;
    inTime: boolean | null;
    awardedXp: number | null;
    /** Saldo do desafio no ledger agora — zero se o período foi reaberto. */
    heldXp: number;
  } | null;
  playing: {
    id: string;
    userId: string;
    userName: string;
    clientId: string;
    clientName: string;
    year: number;
    deadlineAt: Date;
  }[];
  scoreboard: { userId: string; userName: string; closed: number; xp: number }[];
}

/**
 * Tudo que a faixa do desafio mostra: as regras, o desafio da pessoa (em
 * andamento, ou o último que terminou hoje), quem está jogando agora e o
 * placar do dia. O placar só conta desafio cujo período continua fechado por
 * quem rolou — o mesmo critério do XP retido.
 */
export async function loadChallengeBoard(
  tx: OrgTx,
  input: { orgId: string; viewerId: string },
): Promise<ChallengeBoardData> {
  const rules = await loadChallengeRules(tx, input.orgId);
  const challenge = schema.closingChallenges;

  const [mineRow] = await tx
    .select({
      id: challenge.id,
      clientId: challenge.clientId,
      clientName: schema.clients.name,
      taxRegime: schema.clients.taxRegime,
      year: challenge.year,
      status: challenge.status,
      startedAt: challenge.startedAt,
      deadlineAt: challenge.deadlineAt,
      endedAt: challenge.endedAt,
      endedBy: challenge.endedBy,
      inTime: challenge.inTime,
      awardedXp: challenge.awardedXp,
    })
    .from(challenge)
    .innerJoin(schema.clients, eq(schema.clients.id, challenge.clientId))
    .where(
      and(
        eq(challenge.orgId, input.orgId),
        eq(challenge.userId, input.viewerId),
        or(eq(challenge.status, "active"), gte(challenge.endedAt, START_OF_TODAY_SP)),
      ),
    )
    .orderBy(desc(challenge.startedAt))
    .limit(1);

  let mine: ChallengeBoardData["mine"] = null;
  if (mineRow) {
    const [ledger] = await tx
      .select({ net: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int` })
      .from(schema.xpLedger)
      .where(
        and(
          eq(schema.xpLedger.orgId, input.orgId),
          eq(schema.xpLedger.closingChallengeId, mineRow.id),
        ),
      );
    mine = { ...mineRow, heldXp: ledger.net };
  }

  const playing = await tx
    .select({
      id: challenge.id,
      userId: challenge.userId,
      userName: schema.user.name,
      clientId: challenge.clientId,
      clientName: schema.clients.name,
      year: challenge.year,
      deadlineAt: challenge.deadlineAt,
    })
    .from(challenge)
    .innerJoin(schema.user, eq(schema.user.id, challenge.userId))
    .innerJoin(schema.clients, eq(schema.clients.id, challenge.clientId))
    .where(and(eq(challenge.orgId, input.orgId), eq(challenge.status, "active")))
    .orderBy(asc(challenge.deadlineAt));

  const closed = sql<number>`count(*)::int`;
  const xp = sql<number>`coalesce(sum(${challenge.awardedXp}), 0)::int`;
  const scoreboard = await tx
    .select({ userId: challenge.userId, userName: schema.user.name, closed, xp })
    .from(challenge)
    .innerJoin(schema.user, eq(schema.user.id, challenge.userId))
    .innerJoin(
      schema.accountingClosings,
      and(
        eq(schema.accountingClosings.id, challenge.closingId),
        eq(schema.accountingClosings.status, "completed"),
        eq(schema.accountingClosings.completedBy, challenge.userId),
      ),
    )
    .where(
      and(
        eq(challenge.orgId, input.orgId),
        eq(challenge.status, "completed"),
        gte(challenge.endedAt, START_OF_TODAY_SP),
      ),
    )
    .groupBy(challenge.userId, schema.user.name)
    .orderBy(desc(closed), desc(xp))
    .limit(5);

  return { rules, mine, playing, scoreboard };
}
