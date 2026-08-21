import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import {
  FiscalControlBoard,
  type FiscalControlRowView,
} from "./fiscal-control-board";

function currentPeriodInSaoPaulo(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return { year, month };
  }
  throw new Error("Não foi possível identificar a competência atual.");
}

function parsePeriod(year?: string, month?: string): { year: number; month: number } {
  const fallback = currentPeriodInSaoPaulo();
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  return {
    year:
      Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
        ? parsedYear
        : fallback.year,
    month:
      Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
        ? parsedMonth
        : fallback.month,
  };
}

export async function FiscalControlTab({
  orgId,
  clanId,
  viewerId,
  canManage,
  memberships,
  requestedYear,
  requestedMonth,
}: {
  orgId: string;
  clanId: string;
  viewerId: string;
  canManage: boolean;
  memberships: readonly { userId: string; name: string }[];
  requestedYear?: string;
  requestedMonth?: string;
}) {
  const period = parsePeriod(requestedYear, requestedMonth);
  const { rows, events } = await withOrgTx(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.fiscalControlPeriods.id,
        clientId: schema.fiscalControlPeriods.clientId,
        clientName: schema.clients.name,
        responsibleUserId: schema.fiscalControlPeriods.responsibleUserId,
        responsibleName: schema.user.name,
        taxRegime: schema.fiscalControlPeriods.taxRegimeSnapshot,
        profileVersion: schema.fiscalControlPeriods.profileVersion,
        profileSnapshot: schema.fiscalControlPeriods.profileSnapshot,
        campaignId: schema.fiscalControlPeriods.campaignId,
        movementsStatus: schema.fiscalControlPeriods.movementsStatus,
        incomingStatus: schema.fiscalControlPeriods.incomingStatus,
        outgoingStatus: schema.fiscalControlPeriods.outgoingStatus,
        guideStatus: schema.fiscalControlPeriods.guideStatus,
        deliveryStatus: schema.fiscalControlPeriods.deliveryStatus,
        nfsStatus: schema.fiscalControlPeriods.nfsStatus,
        status: schema.fiscalControlPeriods.status,
        monthlyNotes: schema.fiscalControlPeriods.monthlyNotes,
        updatedAt: schema.fiscalControlPeriods.updatedAt,
      })
      .from(schema.fiscalControlPeriods)
      .innerJoin(
        schema.clients,
        and(
          eq(schema.clients.orgId, schema.fiscalControlPeriods.orgId),
          eq(schema.clients.id, schema.fiscalControlPeriods.clientId),
        ),
      )
      .leftJoin(schema.user, eq(schema.user.id, schema.fiscalControlPeriods.responsibleUserId))
      .where(
        and(
          eq(schema.fiscalControlPeriods.orgId, orgId),
          eq(schema.fiscalControlPeriods.periodYear, period.year),
          eq(schema.fiscalControlPeriods.periodMonth, period.month),
        ),
      )
      .orderBy(asc(schema.clients.name));
    const events =
      rows.length > 0
        ? await tx
            .select({
              id: schema.fiscalControlEvents.id,
              controlPeriodId: schema.fiscalControlEvents.controlPeriodId,
              eventType: schema.fiscalControlEvents.eventType,
              stage: schema.fiscalControlEvents.stage,
              actorName: schema.user.name,
              createdAt: schema.fiscalControlEvents.createdAt,
            })
            .from(schema.fiscalControlEvents)
            .innerJoin(schema.user, eq(schema.user.id, schema.fiscalControlEvents.actorId))
            .where(
              and(
                eq(schema.fiscalControlEvents.orgId, orgId),
                inArray(
                  schema.fiscalControlEvents.controlPeriodId,
                  rows.map((row) => row.id),
                ),
              ),
            )
            .orderBy(desc(schema.fiscalControlEvents.createdAt))
            .limit(2000)
        : [];
    return { rows, events };
  });

  const historyByControl = new Map<string, typeof events>();
  for (const event of events) {
    const current = historyByControl.get(event.controlPeriodId) ?? [];
    if (current.length < 8) current.push(event);
    historyByControl.set(event.controlPeriodId, current);
  }

  const views: FiscalControlRowView[] = rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    canEdit: canManage || row.responsibleUserId === viewerId,
    history: (historyByControl.get(row.id) ?? []).map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  }));

  return (
    <FiscalControlBoard
      clanId={clanId}
      year={period.year}
      month={period.month}
      canManage={canManage}
      members={memberships}
      rows={views}
    />
  );
}
