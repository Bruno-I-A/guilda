import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  reconcileClosingYearXp,
  type ClosingYearXpEntry,
} from "@/domain/closing-year-xp";
import { CLOSING_YEAR_XP } from "@/domain/xp";

/**
 * Lê a linha do ano com FOR UPDATE e devolve quem consta como dono do
 * fechamento.
 *
 * CONCORRÊNCIA: `reconcileClosingYearLedger` lê o ledger sem lock próprio, e
 * duas transações que somassem o mesmo ano ao mesmo tempo lançariam o crédito
 * duas vezes. É o lock DA LINHA DO ANO que serializa isso — foi ele que
 * substituiu o índice único parcial `(closing_year_id) WHERE reason =
 * 'closing_year_closed'`, removido porque impedia recreditar quem fechasse o
 * ano depois de uma reabertura. Quem reconcilia precisa ter travado a linha
 * antes, seja por um UPDATE que a afetou, seja chamando isto.
 */
export async function lockClosingYear(
  tx: OrgTx,
  input: { orgId: string; closingYearId: string },
): Promise<{ closedBy: string | null } | null> {
  const [row] = await tx
    .select({ closedBy: schema.accountingClosingYears.closedBy })
    .from(schema.accountingClosingYears)
    .where(
      and(
        eq(schema.accountingClosingYears.orgId, input.orgId),
        eq(schema.accountingClosingYears.id, input.closingYearId),
      ),
    )
    .for("update");
  return row ?? null;
}

/**
 * Acerta o ledger deste ano contra o estado gravado do ano.
 *
 * Chamar DEPOIS que o estado do ano assentou, com o `closedBy` real (null
 * quando o ano voltou a ficar aberto) e com a linha do ano já travada nesta
 * transação — ver `lockClosingYear`. Só INSERT: o ledger é append-only e o
 * role da aplicação nem tem UPDATE/DELETE nele.
 *
 * Devolve os lançamentos aplicados, porque quem chama precisa saber se houve
 * crédito para avisar no Telegram.
 */
export async function reconcileClosingYearLedger(
  tx: OrgTx,
  input: { orgId: string; closingYearId: string; closedBy: string | null },
): Promise<ClosingYearXpEntry[]> {
  const holders = await tx
    .select({
      userId: schema.xpLedger.userId,
      net: sql<number>`coalesce(sum(${schema.xpLedger.amount}), 0)::int`,
    })
    .from(schema.xpLedger)
    .where(
      and(
        eq(schema.xpLedger.orgId, input.orgId),
        eq(schema.xpLedger.closingYearId, input.closingYearId),
      ),
    )
    .groupBy(schema.xpLedger.userId);

  const entries = reconcileClosingYearXp({
    holders,
    closedBy: input.closedBy,
    award: CLOSING_YEAR_XP,
  });
  if (entries.length === 0) return entries;

  await tx.insert(schema.xpLedger).values(
    entries.map((entry) => ({
      orgId: input.orgId,
      userId: entry.userId,
      closingYearId: input.closingYearId,
      amount: entry.amount,
      reason: entry.reason,
    })),
  );
  return entries;
}
