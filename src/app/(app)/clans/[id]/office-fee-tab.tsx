import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { OfficeFeeControlBoard, type OfficeFeeControlRowView } from "./office-fee-control-board";
import { OfficeFeeProfileBoard, type OfficeFeeProfileRowView } from "./office-fee-profile-board";

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parsePeriod(year?: string, month?: string): { year: number; month: number } {
  const today = todayInSaoPaulo();
  const fallbackYear = Number(today.slice(0, 4));
  const fallbackMonth = Number(today.slice(5, 7));
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  return {
    year: Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fallbackYear,
    month: Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : fallbackMonth,
  };
}

export async function OfficeFeeTab({
  orgId,
  clanId,
  viewerId,
  canManage,
  memberships,
  requestedView,
  requestedYear,
  requestedMonth,
}: {
  orgId: string;
  clanId: string;
  viewerId: string;
  canManage: boolean;
  memberships: readonly { userId: string; name: string }[];
  requestedView?: string;
  requestedYear?: string;
  requestedMonth?: string;
}) {
  const view = requestedView === "control" ? "control" : "base";
  if (view === "base") {
    const { rows, events, availableClients } = await withOrgTx(orgId, async (tx) => {
      const rows = await tx
        .select({
          clientId: schema.clients.id,
          clientName: schema.clients.name,
          cnpj: schema.clients.cnpj,
          active: schema.clients.active,
          profileId: schema.officeFeeProfiles.id,
          profileVersion: schema.officeFeeProfiles.version,
          billingMethod: schema.officeFeeProfiles.billingMethod,
          chargesAdditionalInstallment: schema.officeFeeProfiles.chargesAdditionalInstallment,
          monthlyFee: schema.officeFeeProfiles.monthlyFee,
          permanentNotes: schema.officeFeeProfiles.permanentNotes,
        })
        .from(schema.officeFeeProfiles)
        .innerJoin(
          schema.clients,
          and(
            eq(schema.clients.orgId, schema.officeFeeProfiles.orgId),
            eq(schema.clients.id, schema.officeFeeProfiles.clientId),
          ),
        )
        .where(eq(schema.officeFeeProfiles.orgId, orgId))
        .orderBy(asc(schema.clients.name));
      const events = rows.length > 0
        ? await tx
            .select({
              id: schema.officeFeeProfileEvents.id,
              profileId: schema.officeFeeProfileEvents.profileId,
              version: schema.officeFeeProfileEvents.version,
              eventType: schema.officeFeeProfileEvents.eventType,
              changedFields: schema.officeFeeProfileEvents.changedFields,
              actorName: schema.user.name,
              createdAt: schema.officeFeeProfileEvents.createdAt,
            })
            .from(schema.officeFeeProfileEvents)
            .leftJoin(schema.user, eq(schema.user.id, schema.officeFeeProfileEvents.actorId))
            .where(and(eq(schema.officeFeeProfileEvents.orgId, orgId), inArray(schema.officeFeeProfileEvents.profileId, rows.map((row) => row.profileId))))
            .orderBy(desc(schema.officeFeeProfileEvents.createdAt))
            .limit(1500)
        : [];
      const availableClients = await tx
        .select({ id: schema.clients.id, name: schema.clients.name, cnpj: schema.clients.cnpj })
        .from(schema.clients)
        .leftJoin(
          schema.officeFeeProfiles,
          and(
            eq(schema.officeFeeProfiles.orgId, schema.clients.orgId),
            eq(schema.officeFeeProfiles.clientId, schema.clients.id),
          ),
        )
        .where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.active, true)))
        .orderBy(asc(schema.clients.name));
      return { rows, events, availableClients: availableClients.filter((client) => !rows.some((row) => row.clientId === client.id)) };
    });
    const historyByProfile = new Map<string, typeof events>();
    for (const event of events) {
      const current = historyByProfile.get(event.profileId) ?? [];
      if (current.length < 8) current.push(event);
      historyByProfile.set(event.profileId, current);
    }
    const views: OfficeFeeProfileRowView[] = rows.map((row) => ({
      clientId: row.clientId,
      clientName: row.clientName,
      cnpj: row.cnpj,
      active: row.active,
      profile: {
        id: row.profileId,
        version: row.profileVersion,
        billingMethod: row.billingMethod,
        chargesAdditionalInstallment: row.chargesAdditionalInstallment,
        monthlyFee: row.monthlyFee,
        permanentNotes: row.permanentNotes,
        history: (historyByProfile.get(row.profileId) ?? []).map((event) => ({
          ...event,
          actorName: event.actorName ?? null,
          createdAt: event.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        })),
      },
    }));
    return <OfficeFeeProfileBoard clanId={clanId} canManage={canManage} rows={views} availableClients={availableClients} />;
  }

  const period = parsePeriod(requestedYear, requestedMonth);
  const { rows, events } = await withOrgTx(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.officeFeeControlPeriods.id,
        clientId: schema.officeFeeControlPeriods.clientId,
        clientName: schema.officeFeeControlPeriods.clientNameSnapshot,
        cnpj: schema.officeFeeControlPeriods.clientCnpjSnapshot,
        responsibleUserId: schema.officeFeeControlPeriods.responsibleUserId,
        responsibleName: schema.user.name,
        profileVersion: schema.officeFeeControlPeriods.profileVersion,
        profileSnapshot: schema.officeFeeControlPeriods.profileSnapshot,
        invoiceStatus: schema.officeFeeControlPeriods.invoiceStatus,
        additionalInstallmentStatus: schema.officeFeeControlPeriods.additionalInstallmentStatus,
        collectionStatus: schema.officeFeeControlPeriods.collectionStatus,
        status: schema.officeFeeControlPeriods.status,
        monthlyNotes: schema.officeFeeControlPeriods.monthlyNotes,
        updatedAt: schema.officeFeeControlPeriods.updatedAt,
      })
      .from(schema.officeFeeControlPeriods)
      .leftJoin(schema.user, eq(schema.user.id, schema.officeFeeControlPeriods.responsibleUserId))
      .where(and(
        eq(schema.officeFeeControlPeriods.orgId, orgId),
        eq(schema.officeFeeControlPeriods.periodYear, period.year),
        eq(schema.officeFeeControlPeriods.periodMonth, period.month),
      ))
      .orderBy(asc(schema.officeFeeControlPeriods.clientNameSnapshot));
    const events = rows.length > 0
      ? await tx
          .select({
            id: schema.officeFeeControlEvents.id,
            controlPeriodId: schema.officeFeeControlEvents.controlPeriodId,
            eventType: schema.officeFeeControlEvents.eventType,
            stage: schema.officeFeeControlEvents.stage,
            actorName: schema.user.name,
            createdAt: schema.officeFeeControlEvents.createdAt,
          })
          .from(schema.officeFeeControlEvents)
          .innerJoin(schema.user, eq(schema.user.id, schema.officeFeeControlEvents.actorId))
          .where(and(eq(schema.officeFeeControlEvents.orgId, orgId), inArray(schema.officeFeeControlEvents.controlPeriodId, rows.map((row) => row.id))))
          .orderBy(desc(schema.officeFeeControlEvents.createdAt))
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
  const views: OfficeFeeControlRowView[] = rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    canEdit: canManage || row.responsibleUserId === viewerId,
    history: (historyByControl.get(row.id) ?? []).map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  }));
  return <OfficeFeeControlBoard clanId={clanId} year={period.year} month={period.month} canManage={canManage} members={memberships} rows={views} />;
}
