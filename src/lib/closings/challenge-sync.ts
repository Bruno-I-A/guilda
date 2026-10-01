import "server-only";

import { and, asc, count, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  challengeAward,
  challengeHeldXp,
  challengeXpEntry,
  settleActiveChallenge,
  type ChallengeRules,
} from "@/domain/closing-challenge";

import { loadChallengeRules, START_OF_TODAY_SP } from "./challenge-rules";

/**
 * Acerta os desafios das empresas depois de uma escrita em período ou
 * observação: decide o desfecho de quem está em andamento e alinha o ledger
 * de quem concluiu.
 *
 * Só a porta única (`period-writes.ts`) chama isto, na mesma transação da
 * escrita. CONCORRÊNCIA: o FOR UPDATE nas linhas dos desafios serializa duas
 * conciliações do mesmo desafio — o ledger é somado sem lock próprio, igual a
 * `reconcileClosingYearLedger`.
 *
 * Período que mudou de empresa ou de ano some da lista do desafio antigo, e
 * período excluído zera o `closing_id` pelo FK: nos dois casos o desafio
 * deixa de segurar XP e a diferença vira estorno.
 */
export async function syncClosingChallenges(
  tx: OrgTx,
  input: { orgId: string; clientIds: readonly string[] },
): Promise<void> {
  const clientIds = [...new Set(input.clientIds)];
  if (clientIds.length === 0) return;

  const challenges = await tx
    .select()
    .from(schema.closingChallenges)
    .where(
      and(
        eq(schema.closingChallenges.orgId, input.orgId),
        inArray(schema.closingChallenges.clientId, clientIds),
        inArray(schema.closingChallenges.status, ["active", "completed"]),
      ),
    )
    .orderBy(asc(schema.closingChallenges.startedAt))
    .for("update");
  if (challenges.length === 0) return;

  let rules: ChallengeRules | null = null;
  for (const challenge of challenges) {
    const periods = await tx
      .select({
        id: schema.accountingClosings.id,
        status: schema.accountingClosings.status,
        completedBy: schema.accountingClosings.completedBy,
        completedAt: schema.accountingClosings.completedAt,
      })
      .from(schema.accountingClosings)
      .where(
        and(
          eq(schema.accountingClosings.orgId, input.orgId),
          eq(schema.accountingClosings.clientId, challenge.clientId),
          gte(schema.accountingClosings.dueDate, `${challenge.year}-01-01`),
          lte(schema.accountingClosings.dueDate, `${challenge.year}-12-31`),
        ),
      );

    let current = challenge;
    if (challenge.status === "active") {
      const [observations] = await tx
        .select({ value: count() })
        .from(schema.closingObservations)
        .where(
          and(
            eq(schema.closingObservations.orgId, input.orgId),
            eq(schema.closingObservations.clientId, challenge.clientId),
            eq(schema.closingObservations.year, challenge.year),
            gte(schema.closingObservations.createdAt, challenge.startedAt),
          ),
        );
      const outcome = settleActiveChallenge({
        challenger: challenge.userId,
        startedAt: challenge.startedAt,
        completedPeriods: periods.filter((period) => period.status === "completed"),
        observationsSinceStart: observations.value,
      });

      if (outcome.status === "completed") {
        rules ??= await loadChallengeRules(tx, input.orgId);
        const inTime = outcome.completedAt.getTime() <= challenge.deadlineAt.getTime();
        const award = challengeAward({
          inTime,
          baseXp: challenge.baseXp,
          bonusXp: challenge.bonusXp,
          paidToday: await countPaidToday(tx, input.orgId, challenge.userId),
          dailyPaidCap: rules.dailyPaidCap,
        });
        [current] = await tx
          .update(schema.closingChallenges)
          .set({
            status: "completed",
            endedAt: outcome.completedAt,
            closingId: outcome.closingId,
            inTime,
            awardedXp: award.awardedXp,
            capped: award.capped,
          })
          .where(
            and(
              eq(schema.closingChallenges.orgId, input.orgId),
              eq(schema.closingChallenges.id, challenge.id),
            ),
          )
          .returning();
      } else if (outcome.status !== "active") {
        [current] = await tx
          .update(schema.closingChallenges)
          .set({ status: outcome.status, endedAt: new Date() })
          .where(
            and(
              eq(schema.closingChallenges.orgId, input.orgId),
              eq(schema.closingChallenges.id, challenge.id),
            ),
          )
          .returning();
      }
    }

    const linked = current.closingId
      ? periods.find((period) => period.id === current.closingId)
      : undefined;
    const held = challengeHeldXp({
      status: current.status,
      awardedXp: current.awardedXp,
      linkedPeriodClosedByChallenger:
        linked?.status === "completed" && linked.completedBy === current.userId,
    });
    const [ledger] = await tx
      .select({ net: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int` })
      .from(schema.xpLedger)
      .where(
        and(
          eq(schema.xpLedger.orgId, input.orgId),
          eq(schema.xpLedger.closingChallengeId, current.id),
        ),
      );
    const entry = challengeXpEntry({ net: ledger.net, held });
    if (entry) {
      await tx.insert(schema.xpLedger).values({
        orgId: input.orgId,
        userId: current.userId,
        closingChallengeId: current.id,
        amount: entry.amount,
        reason: entry.reason,
      });
    }
  }
}

/** Desafios que já pagaram XP hoje (dia de São Paulo) para esta pessoa. */
async function countPaidToday(tx: OrgTx, orgId: string, userId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(schema.closingChallenges)
    .where(
      and(
        eq(schema.closingChallenges.orgId, orgId),
        eq(schema.closingChallenges.userId, userId),
        eq(schema.closingChallenges.status, "completed"),
        gt(schema.closingChallenges.awardedXp, 0),
        gte(schema.closingChallenges.endedAt, START_OF_TODAY_SP),
      ),
    );
  return row.value;
}
