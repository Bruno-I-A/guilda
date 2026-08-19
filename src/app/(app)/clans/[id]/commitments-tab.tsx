import { and, asc, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { commitmentPeriodLabel, isPeriodOverdue } from "@/domain/commitments";

import {
  CommitmentBoard,
  type CommitmentPeriodView,
  type CommitmentView,
} from "./commitment-board";

/**
 * Compromissos recorrentes do clã: a regra por empresa e o ano planejado.
 *
 * Todo integrante ENXERGA (é o que tira o controle da cabeça de uma pessoa
 * só); quem cadastra, gera missão e conclui é líder ou admin — `canManage`
 * vem decidido da página.
 */

/** "YYYY-MM-DD" de hoje em São Paulo — o fuso do escritório. */
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

export async function CommitmentsTab({
  orgId,
  clanId,
  canManage,
}: {
  orgId: string;
  clanId: string;
  canManage: boolean;
}) {
  const today = todayInSaoPaulo();
  const year = Number(today.slice(0, 4));

  const { rows, clients } = await withOrgTx(orgId, async (tx) => {
    const commitmentRows = await tx
      .select({
        id: schema.clientCommitments.id,
        clientId: schema.clientCommitments.clientId,
        clientName: schema.clients.name,
        title: schema.clientCommitments.title,
        notes: schema.clientCommitments.notes,
        cadence: schema.clientCommitments.cadence,
        active: schema.clientCommitments.active,
        periodId: schema.clientCommitmentPeriods.id,
        periodYear: schema.clientCommitmentPeriods.periodYear,
        periodIndex: schema.clientCommitmentPeriods.periodIndex,
        dueDate: schema.clientCommitmentPeriods.dueDate,
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
      // LEFT: compromisso sem período (ano ainda não planejado) não some.
      .leftJoin(
        schema.clientCommitmentPeriods,
        and(
          eq(
            schema.clientCommitmentPeriods.commitmentId,
            schema.clientCommitments.id,
          ),
          eq(schema.clientCommitmentPeriods.orgId, schema.clientCommitments.orgId),
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
        asc(schema.clientCommitments.title),
        asc(schema.clientCommitmentPeriods.periodIndex),
      );

    const clientRows = canManage
      ? await tx
          .select({ id: schema.clients.id, name: schema.clients.name })
          .from(schema.clients)
          .where(
            and(eq(schema.clients.orgId, orgId), eq(schema.clients.active, true)),
          )
          .orderBy(asc(schema.clients.name))
      : [];

    return { rows: commitmentRows, clients: clientRows };
  });

  // A query devolve uma linha por período; agrupa de volta em compromissos.
  const byCommitment = new Map<string, CommitmentView>();
  for (const row of rows) {
    let commitment = byCommitment.get(row.id);
    if (!commitment) {
      commitment = {
        id: row.id,
        clientId: row.clientId,
        clientName: row.clientName,
        title: row.title,
        notes: row.notes,
        cadence: row.cadence,
        active: row.active,
        periods: [],
      };
      byCommitment.set(row.id, commitment);
    }
    if (!row.periodId || row.periodYear === null || row.periodIndex === null) {
      continue;
    }
    const period: CommitmentPeriodView = {
      id: row.periodId,
      label: commitmentPeriodLabel(row.cadence, row.periodYear, row.periodIndex),
      dueDate: row.dueDate ?? "",
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

  return (
    <CommitmentBoard
      clanId={clanId}
      canManage={canManage}
      commitments={[...byCommitment.values()]}
      clients={clients}
      year={year}
    />
  );
}
