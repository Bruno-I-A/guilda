import "server-only";

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { challengeResult } from "@/domain/closing-challenge";
import { informativeDraftPayloadSchema } from "@/lib/ai/informative-schema";
import { loadChallengeBoard } from "@/lib/closings/challenge-board";
import { informativeTasksRevision } from "@/lib/informatives/revision";

import type { McpActor } from "./access";

export async function listClosings(
  actor: McpActor,
  input: {
    year: number;
    statuses?: Array<"pending" | "blocked" | "completed">;
    clientId?: string;
    search?: string;
    limit: number;
    offset: number;
  },
) {
  return withOrgTx(actor.orgId, async (tx) => {
    const conditions: Array<SQL | undefined> = [
      eq(schema.accountingClosings.orgId, actor.orgId),
      gte(schema.accountingClosings.dueDate, `${input.year}-01-01`),
      lte(schema.accountingClosings.dueDate, `${input.year}-12-31`),
    ];
    if (input.statuses?.length) {
      conditions.push(inArray(schema.accountingClosings.status, input.statuses));
    }
    if (input.clientId) conditions.push(eq(schema.accountingClosings.clientId, input.clientId));
    if (input.search) conditions.push(ilike(schema.clients.name, `%${input.search}%`));

    const rows = await tx
      .select({
        id: schema.accountingClosings.id,
        clientId: schema.accountingClosings.clientId,
        clientName: schema.clients.name,
        title: schema.accountingClosings.title,
        periodMonth: schema.accountingClosings.periodMonth,
        status: schema.accountingClosings.status,
        dueDate: schema.accountingClosings.dueDate,
        completedAt: schema.accountingClosings.completedAt,
        updatedAt: schema.accountingClosings.updatedAt,
      })
      .from(schema.accountingClosings)
      .innerJoin(
        schema.clients,
        and(
          eq(schema.clients.orgId, schema.accountingClosings.orgId),
          eq(schema.clients.id, schema.accountingClosings.clientId),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(schema.clients.name), asc(schema.accountingClosings.periodMonth))
      .limit(input.limit)
      .offset(input.offset);

    const clientIds = [...new Set(rows.map((row) => row.clientId))];
    const years = clientIds.length
      ? await tx
          .select()
          .from(schema.accountingClosingYears)
          .where(and(
            eq(schema.accountingClosingYears.orgId, actor.orgId),
            eq(schema.accountingClosingYears.year, input.year),
            inArray(schema.accountingClosingYears.clientId, clientIds),
          ))
      : [];
    const annualByClient = new Map(years.map((row) => [row.clientId, row]));

    return rows.map((row) => {
      const annual = annualByClient.get(row.clientId);
      return {
        id: row.id,
        client: { id: row.clientId, name: row.clientName },
        title: row.title,
        period_month: row.periodMonth,
        status: row.status,
        due_at: row.dueDate,
        completed_at: row.completedAt?.toISOString() ?? null,
        annual: annual
          ? {
              closed_at: annual.closedAt?.toISOString() ?? null,
              defis_completed_at: annual.defisCompletedAt?.toISOString() ?? null,
            }
          : null,
        updated_at: row.updatedAt.toISOString(),
      };
    });
  });
}

export async function closingDetails(actor: McpActor, closingId: string) {
  return withOrgTx(actor.orgId, async (tx) => {
    const [row] = await tx
      .select({ closing: schema.accountingClosings, client: schema.clients })
      .from(schema.accountingClosings)
      .innerJoin(
        schema.clients,
        and(
          eq(schema.clients.orgId, schema.accountingClosings.orgId),
          eq(schema.clients.id, schema.accountingClosings.clientId),
        ),
      )
      .where(and(
        eq(schema.accountingClosings.orgId, actor.orgId),
        eq(schema.accountingClosings.id, closingId),
      ));
    if (!row) return null;
    const year = Number(row.closing.dueDate.slice(0, 4));
    const [annual, observations] = await Promise.all([
      tx.query.accountingClosingYears.findFirst({
        where: and(
          eq(schema.accountingClosingYears.orgId, actor.orgId),
          eq(schema.accountingClosingYears.clientId, row.closing.clientId),
          eq(schema.accountingClosingYears.year, year),
        ),
      }),
      tx
        .select({
          id: schema.closingObservations.id,
          scope: schema.closingObservations.scope,
          body: schema.closingObservations.body,
          taskId: schema.closingObservations.taskId,
          resolvedAt: schema.closingObservations.resolvedAt,
          createdAt: schema.closingObservations.createdAt,
        })
        .from(schema.closingObservations)
        .where(and(
          eq(schema.closingObservations.orgId, actor.orgId),
          eq(schema.closingObservations.clientId, row.closing.clientId),
          eq(schema.closingObservations.year, year),
          or(
            eq(schema.closingObservations.closingId, closingId),
            inArray(schema.closingObservations.scope, ["year", "defis"]),
          ),
        ))
        .orderBy(asc(schema.closingObservations.createdAt)),
    ]);
    return {
      ...row.closing,
      completedAt: row.closing.completedAt?.toISOString() ?? null,
      createdAt: row.closing.createdAt.toISOString(),
      updatedAt: row.closing.updatedAt.toISOString(),
      client: {
        id: row.client.id,
        name: row.client.name,
        cnpj: row.client.cnpj,
        tax_regime: row.client.taxRegime,
      },
      year,
      annual: annual
        ? {
            id: annual.id,
            closed_at: annual.closedAt?.toISOString() ?? null,
            closed_by: annual.closedBy,
            defis_completed_at: annual.defisCompletedAt?.toISOString() ?? null,
            defis_completed_by: annual.defisCompletedBy,
            updated_at: annual.updatedAt.toISOString(),
          }
        : null,
      observations: observations.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        resolvedAt: item.resolvedAt?.toISOString() ?? null,
      })),
    };
  });
}

export async function listInformatives(
  actor: McpActor,
  input: {
    statuses?: Array<"pending" | "confirmed" | "cancelled">;
    mineOnly: boolean;
    search?: string;
    limit: number;
    offset: number;
  },
) {
  return withOrgTx(actor.orgId, async (tx) => {
    const conditions: Array<SQL | undefined> = [eq(schema.informatives.orgId, actor.orgId)];
    if (input.statuses?.length) conditions.push(inArray(schema.informatives.status, input.statuses));
    if (input.mineOnly) conditions.push(eq(schema.informatives.requestedBy, actor.userId));
    if (input.search) conditions.push(ilike(schema.informatives.sourceText, `%${input.search}%`));
    const rows = await tx
      .select({
        id: schema.informatives.id,
        requestedBy: schema.informatives.requestedBy,
        requesterName: schema.user.name,
        source: schema.informatives.source,
        status: schema.informatives.status,
        payload: schema.informatives.payload,
        createdTaskIds: schema.informatives.createdTaskIds,
        expiresAt: schema.informatives.expiresAt,
        decidedAt: schema.informatives.decidedAt,
        createdAt: schema.informatives.createdAt,
      })
      .from(schema.informatives)
      .innerJoin(schema.user, eq(schema.user.id, schema.informatives.requestedBy))
      .where(and(...conditions))
      .orderBy(desc(schema.informatives.createdAt))
      .limit(input.limit)
      .offset(input.offset);
    return rows.map((row) => {
      const payload = informativeDraftPayloadSchema.safeParse(row.payload);
      return {
        id: row.id,
        requested_by: { id: row.requestedBy, name: row.requesterName },
        source: row.source,
        status: row.status,
        kind: payload.success ? payload.data.kind : null,
        title: payload.success
          ? payload.data.freeNotice?.title ?? payload.data.company.summary
          : "Prévia em formato anterior",
        company: payload.success
          ? { id: payload.data.company.clientId, name: payload.data.company.legalName }
          : null,
        mission_count: payload.success ? payload.data.tasks.length : null,
        created_task_ids: Array.isArray(row.createdTaskIds) ? row.createdTaskIds : [],
        expires_at: row.expiresAt.toISOString(),
        decided_at: row.decidedAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      };
    });
  });
}

export async function informativeDetails(actor: McpActor, informativeId: string) {
  return withOrgTx(actor.orgId, async (tx) => {
    const [row] = await tx
      .select({ informative: schema.informatives, requesterName: schema.user.name })
      .from(schema.informatives)
      .innerJoin(schema.user, eq(schema.user.id, schema.informatives.requestedBy))
      .where(and(
        eq(schema.informatives.orgId, actor.orgId),
        eq(schema.informatives.id, informativeId),
      ));
    if (!row) return null;
    const payload = informativeDraftPayloadSchema.safeParse(row.informative.payload);
    return {
      id: row.informative.id,
      requested_by: { id: row.informative.requestedBy, name: row.requesterName },
      source: row.informative.source,
      source_text: row.informative.sourceText,
      status: row.informative.status,
      payload: payload.success ? payload.data : null,
      payload_valid: payload.success,
      revision: payload.success ? informativeTasksRevision(payload.data.tasks) : null,
      created_task_ids: Array.isArray(row.informative.createdTaskIds)
        ? row.informative.createdTaskIds
        : [],
      expires_at: row.informative.expiresAt.toISOString(),
      decided_at: row.informative.decidedAt?.toISOString() ?? null,
      created_at: row.informative.createdAt.toISOString(),
      can_decide: row.informative.requestedBy === actor.userId && row.informative.status === "pending",
    };
  });
}

export async function listMuralNotices(
  actor: McpActor,
  input: { archived: boolean; search?: string; limit: number; offset: number },
) {
  return withOrgTx(actor.orgId, async (tx) => {
    const conditions: Array<SQL | undefined> = [eq(schema.guildNotices.orgId, actor.orgId)];
    conditions.push(
      input.archived
        ? isNotNull(schema.guildNotices.archivedAt)
        : isNull(schema.guildNotices.archivedAt),
    );
    if (input.search) {
      conditions.push(or(
        ilike(schema.guildNotices.title, `%${input.search}%`),
        ilike(schema.guildNotices.body, `%${input.search}%`),
      ));
    }
    const rows = await tx
      .select({
        notice: schema.guildNotices,
        authorName: schema.user.name,
        clientName: schema.clients.name,
      })
      .from(schema.guildNotices)
      .innerJoin(schema.user, eq(schema.user.id, schema.guildNotices.authorId))
      .leftJoin(
        schema.clients,
        and(
          eq(schema.clients.orgId, schema.guildNotices.orgId),
          eq(schema.clients.id, schema.guildNotices.clientId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.guildNotices.pinned), desc(schema.guildNotices.publishedAt))
      .limit(input.limit)
      .offset(input.offset);
    const noticeIds = rows.map((row) => row.notice.id);
    const informativeIds = rows
      .map((row) => row.notice.informativeId)
      .filter((id): id is string => Boolean(id));
    const [reads, work, tasks, members] = await Promise.all([
      noticeIds.length
        ? tx.select({ noticeId: schema.guildNoticeReads.noticeId, userId: schema.guildNoticeReads.userId })
            .from(schema.guildNoticeReads)
            .where(and(eq(schema.guildNoticeReads.orgId, actor.orgId), inArray(schema.guildNoticeReads.noticeId, noticeIds)))
        : [],
      noticeIds.length
        ? tx.select({ noticeId: schema.guildNoticeWork.noticeId, userId: schema.guildNoticeWork.userId })
            .from(schema.guildNoticeWork)
            .where(and(eq(schema.guildNoticeWork.orgId, actor.orgId), inArray(schema.guildNoticeWork.noticeId, noticeIds)))
        : [],
      informativeIds.length
        ? tx.select({ informativeId: schema.tasks.informativeId, status: schema.tasks.status })
            .from(schema.tasks)
            .where(and(eq(schema.tasks.orgId, actor.orgId), inArray(schema.tasks.informativeId, informativeIds)))
        : [],
      tx.select({ userId: schema.member.userId, name: schema.user.name })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, actor.orgId))
        .orderBy(asc(schema.user.name)),
    ]);
    return rows.map(({ notice, authorName, clientName }) => {
      const noticeReads = reads.filter((read) => read.noticeId === notice.id);
      const noticeWork = work.filter((item) => item.noticeId === notice.id);
      const noticeTasks = tasks.filter((task) => task.informativeId === notice.informativeId);
      return {
        id: notice.id,
        kind: notice.kind,
        title: notice.title,
        body: notice.body,
        author: { id: notice.authorId, name: authorName },
        client: notice.clientId ? { id: notice.clientId, name: clientName } : null,
        informative_id: notice.informativeId,
        requires_ack: notice.requiresAck,
        pinned: notice.pinned,
        acknowledged_by_me: noticeReads.some((read) => read.userId === actor.userId),
        acknowledgement_count: noticeReads.length,
        total_members: members.length,
        pending_acknowledgements: notice.requiresAck
          ? members
              .filter((member) => !noticeReads.some((read) => read.userId === member.userId))
              .map((member) => ({ id: member.userId, name: member.name }))
          : [],
        work_resolved_by_me: noticeWork.some((item) => item.userId === actor.userId),
        work_resolved_count: noticeWork.length,
        missions: {
          total: noticeTasks.length,
          completed: noticeTasks.filter((task) => task.status === "completed").length,
          cancelled: noticeTasks.filter((task) => task.status === "cancelled").length,
        },
        published_at: notice.publishedAt.toISOString(),
        archived_at: notice.archivedAt?.toISOString() ?? null,
        updated_at: notice.updatedAt.toISOString(),
      };
    });
  });
}

/**
 * O Desafio do dado visto pelo agente: as regras, o desafio da pessoa
 * representada (em andamento, ou o último que terminou hoje), quem está
 * jogando agora e o placar do dia. `xp_in_ledger` é o saldo do desafio no
 * ledger — é por ele que se confere crédito, estorno e recrédito, porque o
 * `awarded_xp` é o prêmio congelado na conclusão, não o que está valendo.
 */
export async function challengeStatus(actor: McpActor) {
  return withOrgTx(actor.orgId, async (tx) => {
    const board = await loadChallengeBoard(tx, { orgId: actor.orgId, viewerId: actor.userId });
    const mine = board.mine;
    let xpInLedger = 0;
    if (mine) {
      const [ledger] = await tx
        .select({ net: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int` })
        .from(schema.xpLedger)
        .where(
          and(
            eq(schema.xpLedger.orgId, actor.orgId),
            eq(schema.xpLedger.closingChallengeId, mine.id),
          ),
        );
      xpInLedger = ledger.net;
    }
    const result =
      mine && mine.status !== "active"
        ? challengeResult({
            status: mine.status,
            inTime: mine.inTime,
            awardedXp: mine.awardedXp,
            capped: mine.capped,
            startedAt: mine.startedAt,
            endedAt: mine.endedAt,
            releasedByOther: Boolean(mine.endedBy && mine.endedBy !== actor.userId),
          })
        : null;

    return {
      rules: {
        time_limit_minutes: board.rules.timeLimitMinutes,
        base_xp: board.rules.baseXp,
        bonus_xp: board.rules.bonusXp,
        daily_paid_cap: board.rules.dailyPaidCap,
      },
      paid_today: board.paidToday,
      mine: mine
        ? {
            id: mine.id,
            client: { id: mine.clientId, name: mine.clientName },
            year: mine.year,
            status: mine.status,
            started_at: mine.startedAt.toISOString(),
            deadline_at: mine.deadlineAt.toISOString(),
            ended_at: mine.endedAt?.toISOString() ?? null,
            in_time: mine.inTime,
            awarded_xp: mine.awardedXp,
            capped: mine.capped,
            xp_in_ledger: xpInLedger,
            result: result ? (result.xp ? `+${result.xp} XP · ${result.text}` : result.text) : null,
          }
        : null,
      playing: board.playing.map((item) => ({
        id: item.id,
        user: { id: item.userId, name: item.userName },
        client: { id: item.clientId, name: item.clientName },
        year: item.year,
        deadline_at: item.deadlineAt.toISOString(),
      })),
      scoreboard_today: board.scoreboard.map((row) => ({
        user: { id: row.userId, name: row.userName },
        closed: row.closed,
        xp: row.xp,
      })),
    };
  });
}
