import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { commitmentPeriodLabel, isPeriodOverdue } from "@/domain/commitments";

import {
  CommitmentBoard,
  type ClosingNoteView,
  type CommitmentPeriodView,
  type CommitmentView,
} from "./commitment-board";

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function selectedYear(value: string | undefined, current: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : current;
}

export async function CommitmentsTab({
  orgId,
  clanId,
  canManage,
  requestedYear,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
  requestedYear?: string;
}) {
  const today = todayInSaoPaulo();
  const year = selectedYear(requestedYear, Number(today.slice(0, 4)));

  const { rows, latestRows, clients, closingRows } = await withOrgTx(
    orgId,
    async (tx) => {
      const [rows, latestRows, clients, closingRows] = await Promise.all([
        tx
          .select({
            id: schema.clientCommitments.id,
            clientId: schema.clientCommitments.clientId,
            clientName: schema.clients.name,
            notes: schema.clientCommitments.notes,
            targetAmount: schema.clientCommitments.targetAmount,
            cadence: schema.clientCommitments.cadence,
            difficulty: schema.clientCommitments.difficulty,
            active: schema.clientCommitments.active,
            periodId: schema.clientCommitmentPeriods.id,
            periodYear: schema.clientCommitmentPeriods.periodYear,
            periodIndex: schema.clientCommitmentPeriods.periodIndex,
            dueDate: schema.clientCommitmentPeriods.dueDate,
            periodNotes: schema.clientCommitmentPeriods.notes,
            distributedAmount: schema.clientCommitmentPeriods.distributedAmount,
            completedAt: schema.clientCommitmentPeriods.completedAt,
            completedByName: schema.user.name,
            taskId: schema.clientCommitmentPeriods.taskId,
          })
          .from(schema.clientCommitments)
          .innerJoin(
            schema.clients,
            and(
              eq(schema.clients.id, schema.clientCommitments.clientId),
              eq(schema.clients.orgId, schema.clientCommitments.orgId),
            ),
          )
          .leftJoin(
            schema.clientCommitmentPeriods,
            and(
              eq(
                schema.clientCommitmentPeriods.commitmentId,
                schema.clientCommitments.id,
              ),
              eq(
                schema.clientCommitmentPeriods.orgId,
                schema.clientCommitments.orgId,
              ),
              eq(schema.clientCommitmentPeriods.periodYear, year),
            ),
          )
          .leftJoin(
            schema.user,
            eq(schema.user.id, schema.clientCommitmentPeriods.completedBy),
          )
          .where(
            and(
              eq(schema.clientCommitments.orgId, orgId),
              eq(schema.clientCommitments.clanId, clanId),
            ),
          )
          .orderBy(
            asc(schema.clients.name),
            asc(schema.clientCommitmentPeriods.periodIndex),
          ),
        tx
          .select({
            commitmentId: schema.clientCommitmentPeriods.commitmentId,
            year: schema.clientCommitmentPeriods.periodYear,
            index: schema.clientCommitmentPeriods.periodIndex,
          })
          .from(schema.clientCommitmentPeriods)
          .innerJoin(
            schema.clientCommitments,
            and(
              eq(
                schema.clientCommitments.id,
                schema.clientCommitmentPeriods.commitmentId,
              ),
              eq(
                schema.clientCommitments.orgId,
                schema.clientCommitmentPeriods.orgId,
              ),
            ),
          )
          .where(
            and(
              eq(schema.clientCommitmentPeriods.orgId, orgId),
              eq(schema.clientCommitments.clanId, clanId),
            ),
          )
          .orderBy(
            desc(schema.clientCommitmentPeriods.periodYear),
            desc(schema.clientCommitmentPeriods.periodIndex),
          ),
        tx
          .select({ id: schema.clients.id, name: schema.clients.name })
          .from(schema.clients)
          .where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.active, true)))
          .orderBy(asc(schema.clients.name)),
        tx
          .select({
            clientId: schema.accountingClosingYears.clientId,
            clientName: schema.clients.name,
            notes: schema.accountingClosingYears.notes,
          })
          .from(schema.accountingClosingYears)
          .innerJoin(
            schema.clients,
            and(
              eq(schema.clients.id, schema.accountingClosingYears.clientId),
              eq(schema.clients.orgId, schema.accountingClosingYears.orgId),
            ),
          )
          .where(
            and(
              eq(schema.accountingClosingYears.orgId, orgId),
              eq(schema.accountingClosingYears.year, year),
              isNotNull(schema.accountingClosingYears.notes),
            ),
          )
          .orderBy(asc(schema.clients.name)),
      ]);
      return { rows, latestRows, clients, closingRows };
    },
  );

  const latestByCommitment = new Map<
    string,
    { year: number; index: number }
  >();
  for (const row of latestRows) {
    if (!latestByCommitment.has(row.commitmentId)) {
      latestByCommitment.set(row.commitmentId, {
        year: row.year,
        index: row.index,
      });
    }
  }

  const byCommitment = new Map<string, CommitmentView>();
  for (const row of rows) {
    let commitment = byCommitment.get(row.id);
    if (!commitment) {
      commitment = {
        id: row.id,
        clientId: row.clientId,
        clientName: row.clientName,
        notes: row.notes,
        targetAmount: row.targetAmount,
        cadence: row.cadence,
        difficulty: row.difficulty,
        active: row.active,
        latestPeriod: latestByCommitment.get(row.id) ?? null,
        periods: [],
      };
      byCommitment.set(row.id, commitment);
    }
    if (!row.periodId || row.periodYear === null || row.periodIndex === null) continue;
    const period: CommitmentPeriodView = {
      id: row.periodId,
      year: row.periodYear,
      index: row.periodIndex,
      label: commitmentPeriodLabel(row.cadence, row.periodYear, row.periodIndex),
      dueDate: row.dueDate ?? "",
      notes: row.periodNotes,
      distributedAmount: row.distributedAmount,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedByName: row.completedByName,
      taskId: row.taskId,
      overdue: isPeriodOverdue(
        { dueDate: row.dueDate ?? "", completedAt: row.completedAt },
        today,
      ),
    };
    commitment.periods.push(period);
  }

  const closingNotes: ClosingNoteView[] = closingRows.flatMap((row) =>
    row.notes
      ? [{ clientId: row.clientId, clientName: row.clientName, notes: row.notes }]
      : [],
  );

  return (
    <CommitmentBoard
      clanId={clanId}
      canManage={canManage}
      commitments={[...byCommitment.values()]}
      clients={clients}
      closingNotes={closingNotes}
      year={year}
      today={today}
    />
  );
}
