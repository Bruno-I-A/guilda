import "server-only";

import { and, asc, eq, gte } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { parsePeriods, parseWeek, type BusinessSchedule, type SpecialDay, type WeekSchedule } from "@/domain/business-hours";

/**
 * Expediente do escritório (2026-11-23): a semana e os dias especiais por
 * organização. As contas (aberto agora, próxima abertura) são puras, em
 * src/domain/business-hours.ts; aqui só se lê e se grava.
 */

const hoursTable = schema.supportBusinessHours;
const daysTable = schema.supportSpecialDays;

export type StoredSpecialDay = SpecialDay & { id: string };
export type StoredSchedule = BusinessSchedule & { specialDays: StoredSpecialDay[] };

/** Semana e dias especiais de `today` em diante (dia em Brasília, AAAA-MM-DD). */
export async function loadBusinessSchedule(tx: OrgTx, orgId: string, today: string): Promise<StoredSchedule> {
  const [row] = await tx.select({ week: hoursTable.week }).from(hoursTable).where(eq(hoursTable.orgId, orgId)).limit(1);
  const days = await tx
    .select({ id: daysTable.id, day: daysTable.day, name: daysTable.name, periods: daysTable.periods })
    .from(daysTable)
    .where(and(eq(daysTable.orgId, orgId), gte(daysTable.day, today)))
    .orderBy(asc(daysTable.day));
  return {
    week: row ? parseWeek(row.week) : null,
    specialDays: days.map((day) => ({ id: day.id, day: day.day, name: day.name, periods: parsePeriods(day.periods) })),
  };
}

function plainPeriods(periods: SpecialDay["periods"]): [string, string][] {
  return periods.map(([start, end]) => [start, end]);
}

export async function saveBusinessWeek(tx: OrgTx, input: { orgId: string; userId: string; week: WeekSchedule; now: Date }): Promise<void> {
  const week = Object.fromEntries(Object.entries(input.week).map(([day, periods]) => [day, plainPeriods(periods)]));
  const values = { week, updatedBy: input.userId, updatedAt: input.now };
  await tx.insert(hoursTable).values({ orgId: input.orgId, ...values }).onConflictDoUpdate({ target: hoursTable.orgId, set: values });
}

/** Sem semana, o escritório volta a contar como sempre aberto. */
export async function clearBusinessWeek(tx: OrgTx, orgId: string): Promise<void> {
  await tx.delete(hoursTable).where(eq(hoursTable.orgId, orgId));
}

/** Grava os dias novos; data já cadastrada fica como estava. */
export async function addSpecialDays(
  tx: OrgTx,
  input: { orgId: string; userId: string; days: readonly SpecialDay[] },
): Promise<{ added: number }> {
  if (input.days.length === 0) return { added: 0 };
  const inserted = await tx
    .insert(daysTable)
    .values(
      input.days.map((day) => ({
        orgId: input.orgId,
        day: day.day,
        name: day.name,
        periods: plainPeriods(day.periods),
        createdBy: input.userId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: daysTable.id });
  return { added: inserted.length };
}

export async function removeSpecialDay(tx: OrgTx, input: { orgId: string; id: string }): Promise<boolean> {
  const removed = await tx
    .delete(daysTable)
    .where(and(eq(daysTable.orgId, input.orgId), eq(daysTable.id, input.id)))
    .returning({ id: daysTable.id });
  return removed.length > 0;
}
