import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  leaderboardPeriodRange,
  type LeaderboardPeriod,
} from "@/domain/leaderboard-period";

// Re-exportado daqui porque a tela do ranking importa o tipo deste módulo
// desde antes de a janela virar domínio próprio. A regra mora em
// `@/domain/leaderboard-period` (função pura e testada); aqui só se aplica.
export type { LeaderboardPeriod };

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
 *
 * A janela do período é de calendário e vem de `leaderboardPeriodRange` —
 * ver lá o porquê de não ser mais `agora − 7 dias`.
 */
export async function getLeaderboard(
  orgId: string,
  period: LeaderboardPeriod,
): Promise<LeaderboardRow[]> {
  const { start, end } = leaderboardPeriodRange(period, new Date());
  return withOrgTx(orgId, async (tx) => {
    // Só quem tem associação ATIVA na org entra no ranking. O ledger guarda
    // org_id para sempre — quem saiu continua com os lançamentos dela e, sem
    // esta restrição, seguia aparecendo (podendo até liderar) um time do qual
    // não faz mais parte.
    //
    // EXISTS, e não innerJoin com `member`: se houver mais de uma linha de
    // member para o mesmo par (usuário, org), o join MULTIPLICA as linhas do
    // ledger e dobra o XP somado. A subconsulta correlacionada filtra sem
    // multiplicar.
    const isActiveMember = sql`exists (
      select 1
      from ${schema.member}
      where ${schema.member.organizationId} = ${orgId}
        and ${schema.member.userId} = ${schema.xpLedger.userId}
    )`;

    const conditions: SQL[] = [eq(schema.xpLedger.orgId, orgId), isActiveMember];
    if (start) {
      conditions.push(gte(schema.xpLedger.createdAt, start));
    }
    // `end` está no futuro enquanto o período é o corrente, então hoje não
    // muda o resultado — mas deixa a janela fechada dos dois lados, que é o
    // que a torna uma competição com chegada, e não uma soma aberta.
    if (end) {
      conditions.push(lt(schema.xpLedger.createdAt, end));
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
      .where(and(eq(schema.xpLedger.orgId, orgId), isActiveMember))
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
  closingTitle: string | null;
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
        closingClientName: schema.clients.name,
        closingYear: schema.accountingClosingYears.year,
      })
      .from(schema.xpLedger)
      .leftJoin(schema.tasks, eq(schema.xpLedger.taskId, schema.tasks.id))
      .leftJoin(
        schema.accountingClosingYears,
        eq(schema.xpLedger.closingYearId, schema.accountingClosingYears.id),
      )
      .leftJoin(
        schema.clients,
        eq(schema.accountingClosingYears.clientId, schema.clients.id),
      )
      .where(
        and(eq(schema.xpLedger.orgId, orgId), eq(schema.xpLedger.userId, userId)),
      )
      .orderBy(desc(schema.xpLedger.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      reason: row.reason,
      createdAt: row.createdAt,
      taskTitle: row.taskTitle,
      closingTitle:
        row.closingClientName && row.closingYear
          ? `${row.closingClientName} · fechamento ${row.closingYear}`
          : null,
    }));
  });
}

/**
 * Quantas missões DISTINTAS estão hoje creditadas para a pessoa — é o que o
 * rótulo "missões concluídas" do perfil promete.
 *
 * A contagem é LÍQUIDA por task_id, e não uma contagem de linhas
 * 'task_completed', por causa de duas propriedades do ledger:
 *
 *   1. ele é imutável — desfazer uma conclusão não apaga o crédito, insere um
 *      estorno ('reversal') ao lado dele;
 *   2. a idempotência do crédito é por task_event_id (índice
 *      `xp_ledger_task_event_uidx`), não por task_id — de propósito, para que
 *      uma reconclusão possa creditar de novo.
 *
 * Somando só as linhas 'task_completed', portanto: uma missão desfeita
 * continuaria contando, e o ciclo concluir → desfazer → concluir contaria a
 * MESMA missão duas vezes. Agrupando por task_id com +1 por conclusão e −1
 * por estorno, e ficando só com quem termina positivo, os dois casos batem —
 * o ciclo completo conta 1, a conclusão desfeita conta 0.
 *
 * Fechamentos anuais ('closing_year_closed') ficam de fora de propósito: o
 * rótulo diz "missões", e fechamento não é uma.
 */
export async function countCompletedTasks(
  orgId: string,
  userId: string,
): Promise<number> {
  return withOrgTx(orgId, async (tx) => {
    const netCredits = sql`sum(case when ${schema.xpLedger.reason} = 'task_completed' then 1 else -1 end)`;
    const creditedTasks = tx
      .select({ taskId: schema.xpLedger.taskId })
      .from(schema.xpLedger)
      .where(
        and(
          eq(schema.xpLedger.orgId, orgId),
          eq(schema.xpLedger.userId, userId),
          isNotNull(schema.xpLedger.taskId),
          inArray(schema.xpLedger.reason, ["task_completed", "reversal"]),
        ),
      )
      .groupBy(schema.xpLedger.taskId)
      .having(sql`${netCredits} > 0`)
      .as("credited_tasks");

    const [row] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(creditedTasks);
    return row.total;
  });
}
