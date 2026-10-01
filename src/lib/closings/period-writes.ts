import "server-only";

import { and, eq, type SQL } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import { syncClosingChallenges } from "./challenge-sync";

/**
 * Porta única de escrita dos Fechamentos: todo INSERT/UPDATE/DELETE de
 * período e todo INSERT de observação passam por aqui, e cada um termina
 * chamando o sync do Desafio do dado na mesma transação. O teste
 * `period-writes.guard.test.ts` reprova escrita direta fora deste arquivo.
 */

type NewClosing = typeof schema.accountingClosings.$inferInsert;
type ClosingPatch = Partial<Omit<NewClosing, "id" | "orgId">>;
type NewObservation = typeof schema.closingObservations.$inferInsert;

export async function createClosingPeriod(
  tx: OrgTx,
  values: NewClosing,
): Promise<schema.AccountingClosing> {
  const [created] = await tx.insert(schema.accountingClosings).values(values).returning();
  await syncClosingChallenges(tx, { orgId: values.orgId, clientIds: [created.clientId] });
  return created;
}

/**
 * Lê a linha com lock antes de gravar porque a edição pode trocar a empresa
 * (ou o ano) do período: as duas empresas precisam do sync. `where` soma
 * condições às de organização e id — devolve null quando nada foi gravado.
 */
export async function updateClosingPeriod(
  tx: OrgTx,
  input: { orgId: string; closingId: string; where?: SQL; set: ClosingPatch },
): Promise<schema.AccountingClosing | null> {
  const [before] = await tx
    .select({ clientId: schema.accountingClosings.clientId })
    .from(schema.accountingClosings)
    .where(
      and(
        eq(schema.accountingClosings.orgId, input.orgId),
        eq(schema.accountingClosings.id, input.closingId),
      ),
    )
    .for("update");
  if (!before) return null;

  const [updated] = await tx
    .update(schema.accountingClosings)
    .set(input.set)
    .where(
      and(
        eq(schema.accountingClosings.orgId, input.orgId),
        eq(schema.accountingClosings.id, input.closingId),
        input.where,
      ),
    )
    .returning();
  if (!updated) return null;

  await syncClosingChallenges(tx, {
    orgId: input.orgId,
    clientIds: [before.clientId, updated.clientId],
  });
  return updated;
}

export async function deleteClosingPeriod(
  tx: OrgTx,
  input: { orgId: string; closingId: string },
): Promise<{ id: string; clientId: string } | null> {
  const [deleted] = await tx
    .delete(schema.accountingClosings)
    .where(
      and(
        eq(schema.accountingClosings.orgId, input.orgId),
        eq(schema.accountingClosings.id, input.closingId),
      ),
    )
    .returning({
      id: schema.accountingClosings.id,
      clientId: schema.accountingClosings.clientId,
    });
  if (!deleted) return null;
  await syncClosingChallenges(tx, { orgId: input.orgId, clientIds: [deleted.clientId] });
  return deleted;
}

/** Observação nova encerra o desafio em andamento da empresa como travado. */
export async function createClosingObservation(
  tx: OrgTx,
  values: NewObservation,
): Promise<schema.ClosingObservation> {
  const [created] = await tx.insert(schema.closingObservations).values(values).returning();
  await syncClosingChallenges(tx, { orgId: values.orgId, clientIds: [created.clientId] });
  return created;
}
