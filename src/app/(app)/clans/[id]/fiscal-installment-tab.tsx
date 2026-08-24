import { and, asc, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import {
  FiscalInstallmentBoard,
  type FiscalInstallmentRowView,
} from "./fiscal-installment-board";

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

function parsePeriod(
  requestedYear: string | undefined,
  requestedMonth: string | undefined,
  current: { year: number; month: number },
): { year: number; month: number } {
  const year = Number(requestedYear);
  const month = Number(requestedMonth);
  return {
    year:
      Number.isInteger(year) && year >= 2000 && year <= 2100
        ? year
        : current.year,
    month:
      Number.isInteger(month) && month >= 1 && month <= 12
        ? month
        : current.month,
  };
}

export async function FiscalInstallmentTab({
  orgId,
  clanId,
  canManage,
  requestedYear,
  requestedMonth,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
  requestedYear?: string;
  requestedMonth?: string;
}) {
  const currentPeriod = currentPeriodInSaoPaulo();
  const period = parsePeriod(requestedYear, requestedMonth, currentPeriod);
  const { rows, clients } = await withOrgTx(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.fiscalInstallments.id,
        clientId: schema.fiscalInstallments.clientId,
        clientName: schema.clients.name,
        clientActive: schema.clients.active,
        installmentType: schema.fiscalInstallments.installmentType,
        notes: schema.fiscalInstallments.notes,
        deliveryMethod: schema.fiscalInstallments.deliveryMethod,
        installmentNumber: schema.fiscalInstallments.installmentNumber,
        paidInstallments: schema.fiscalInstallments.paidInstallments,
        totalInstallments: schema.fiscalInstallments.totalInstallments,
        generatedAt: schema.fiscalInstallmentIssuances.generatedAt,
        updatedAt: schema.fiscalInstallments.updatedAt,
      })
      .from(schema.fiscalInstallments)
      .innerJoin(
        schema.clients,
        and(
          eq(schema.clients.orgId, schema.fiscalInstallments.orgId),
          eq(schema.clients.id, schema.fiscalInstallments.clientId),
        ),
      )
      .leftJoin(
        schema.fiscalInstallmentIssuances,
        and(
          eq(schema.fiscalInstallmentIssuances.orgId, schema.fiscalInstallments.orgId),
          eq(schema.fiscalInstallmentIssuances.installmentId, schema.fiscalInstallments.id),
          eq(schema.fiscalInstallmentIssuances.periodYear, period.year),
          eq(schema.fiscalInstallmentIssuances.periodMonth, period.month),
        ),
      )
      .where(eq(schema.fiscalInstallments.orgId, orgId))
      .orderBy(asc(schema.clients.name), asc(schema.fiscalInstallments.createdAt));
    const clients = await tx
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.active, true)))
      .orderBy(asc(schema.clients.name));
    return { rows, clients };
  });

  const views: FiscalInstallmentRowView[] = rows.map((row) => ({
    ...row,
    generatedThisMonth: Boolean(row.generatedAt),
    generatedAt: row.generatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return (
    <FiscalInstallmentBoard
      clanId={clanId}
      canManage={canManage}
      rows={views}
      clients={clients}
      periodYear={period.year}
      periodMonth={period.month}
      currentYear={currentPeriod.year}
      currentMonth={currentPeriod.month}
    />
  );
}
