import "server-only";

import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

export type LeaderboardPeriod = "week" | "month" | "all";

function periodStart(period: LeaderboardPeriod): Date | undefined {
  const DAY = 24 * 60 * 60 * 1000;
  if (period === "week") return new Date(Date.now() - 7 * DAY);
  if (period === "month") return new Date(Date.now() - 30 * DAY);
  return undefined;
}

/** Soma do ledger do usuário na org (fonte da verdade do XP/nível). */
export async function getUserXpTotal(orgId: string, userId: string): Promise<number> {
  return withOrgTx(orgId, async (tx) => {
    const [row] = await tx
      .select({
        total: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int`,
      })
      .from(schema.xpLedger)
      .where(
        and(eq(schema.xpLedger.orgId, orgId), eq(schema.xpLedger.userId, userId)),
      );
    return row.total;
  });
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  periodXp: number;
  totalXp: number;
}

/**
 * Ranking da org: soma do ledger por usuário no período (query agregada,
 * sem cache na v1) + total geral para derivar o nível de cada pessoa.
 */
export async function getLeaderboard(
  orgId: string,
  period: LeaderboardPeriod,
): Promise<LeaderboardRow[]> {
  const since = periodStart(period);
  return withOrgTx(orgId, async (tx) => {
    const conditions: SQL[] = [eq(schema.xpLedger.orgId, orgId)];
    if (since) {
      conditions.push(gte(schema.xpLedger.createdAt, since));
    }

    const periodSum = sql<number>`sum(${schema.xpLedger.amount})::int`;
    const periodRows = await tx
      .select({
        userId: schema.xpLedger.userId,
        name: schema.user.name,
        periodXp: periodSum,
      })
      .from(schema.xpLedger)
      .innerJoin(schema.user, eq(schema.xpLedger.userId, schema.user.id))
      .where(and(...conditions))
      .groupBy(schema.xpLedger.userId, schema.user.name)
      .orderBy(desc(periodSum));

    const totalRows = await tx
      .select({
        userId: schema.xpLedger.userId,
        totalXp: sql<number>`sum(${schema.xpLedger.amount})::int`,
      })
      .from(schema.xpLedger)
      .where(eq(schema.xpLedger.orgId, orgId))
      .groupBy(schema.xpLedger.userId);

    const totals = new Map(totalRows.map((r) => [r.userId, r.totalXp]));
    return periodRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      periodXp: row.periodXp,
      totalXp: totals.get(row.userId) ?? 0,
    }));
  });
}

export interface XpHistoryEntry {
  id: string;
  amount: number;
  reason: string;
  createdAt: Date;
  taskTitle: string | null;
}

/** Últimos lançamentos do usuário (histórico do perfil). */
export async function getXpHistory(
  orgId: string,
  userId: string,
  limit = 15,
): Promise<XpHistoryEntry[]> {
  return withOrgTx(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.xpLedger.id,
        amount: schema.xpLedger.amount,
        reason: schema.xpLedger.reason,
        createdAt: schema.xpLedger.createdAt,
        taskTitle: schema.tasks.title,
      })
      .from(schema.xpLedger)
      .leftJoin(schema.tasks, eq(schema.xpLedger.taskId, schema.tasks.id))
      .where(
        and(eq(schema.xpLedger.orgId, orgId), eq(schema.xpLedger.userId, userId)),
      )
      .orderBy(desc(schema.xpLedger.createdAt))
      .limit(limit);
    return rows;
  });
}

/** Quantas tarefas o usuário já teve aprovadas (créditos no ledger). */
export async function countCompletedTasks(
  orgId: string,
  userId: string,
): Promise<number> {
  return withOrgTx(orgId, async (tx) => {
    const [row] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.xpLedger)
      .where(
        and(
          eq(schema.xpLedger.orgId, orgId),
          eq(schema.xpLedger.userId, userId),
          eq(schema.xpLedger.reason, "task_completed"),
        ),
      );
    return row.total;
  });
}
