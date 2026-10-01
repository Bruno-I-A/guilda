import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { challengePool } from "@/domain/closing-challenge";
import { CLOSING_GROUP_REGIMES, type ClosingGroup } from "@/lib/closings-ui";

/**
 * Empresas que o servidor pode sortear: as do regime aberto na aba, com o ano
 * em aberto, sem período e sem observação no ano, e sem reserva de outro
 * desafio. A regra de elegibilidade é a mesma do dado (`closing-draw`).
 *
 * As consultas rodam em sequência de propósito: o node-postgres não
 * paraleliza dentro de uma transação.
 */
export async function loadChallengePool(
  tx: OrgTx,
  input: { orgId: string; year: number; group: ClosingGroup },
): Promise<{ id: string; name: string }[]> {
  const clients = await tx
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.orgId, input.orgId),
        eq(schema.clients.active, true),
        inArray(schema.clients.taxRegime, [...CLOSING_GROUP_REGIMES[input.group]]),
      ),
    )
    .orderBy(asc(schema.clients.name));
  if (clients.length === 0) return [];
  const ids = clients.map((client) => client.id);

  const withPeriods = await tx
    .selectDistinct({ clientId: schema.accountingClosings.clientId })
    .from(schema.accountingClosings)
    .where(
      and(
        eq(schema.accountingClosings.orgId, input.orgId),
        inArray(schema.accountingClosings.clientId, ids),
        gte(schema.accountingClosings.dueDate, `${input.year}-01-01`),
        lte(schema.accountingClosings.dueDate, `${input.year}-12-31`),
      ),
    );
  const withObservations = await tx
    .selectDistinct({ clientId: schema.closingObservations.clientId })
    .from(schema.closingObservations)
    .where(
      and(
        eq(schema.closingObservations.orgId, input.orgId),
        inArray(schema.closingObservations.clientId, ids),
        eq(schema.closingObservations.year, input.year),
      ),
    );
  const closedYears = await tx
    .select({ clientId: schema.accountingClosingYears.clientId })
    .from(schema.accountingClosingYears)
    .where(
      and(
        eq(schema.accountingClosingYears.orgId, input.orgId),
        eq(schema.accountingClosingYears.year, input.year),
        isNotNull(schema.accountingClosingYears.closedAt),
        inArray(schema.accountingClosingYears.clientId, ids),
      ),
    );
  const reserved = await tx
    .select({ clientId: schema.closingChallenges.clientId })
    .from(schema.closingChallenges)
    .where(
      and(
        eq(schema.closingChallenges.orgId, input.orgId),
        eq(schema.closingChallenges.year, input.year),
        eq(schema.closingChallenges.status, "active"),
      ),
    );

  const periodos = new Set(withPeriods.map((row) => row.clientId));
  const observacoes = new Set(withObservations.map((row) => row.clientId));
  const fechados = new Set(closedYears.map((row) => row.clientId));

  return challengePool(
    clients.map((client) => ({
      ...client,
      yearClosed: fechados.has(client.id),
      periodCount: periodos.has(client.id) ? 1 : 0,
      observationCount: observacoes.has(client.id) ? 1 : 0,
    })),
    new Set(reserved.map((row) => row.clientId)),
  ).map(({ id, name }) => ({ id, name }));
}
