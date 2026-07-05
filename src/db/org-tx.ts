import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

/** Tipo da transação do Drizzle (parâmetro do callback de db.transaction). */
export type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Executa `fn` dentro de uma transação com `app.org_id` setado via
 * `set_config(..., is_local => true)` (equivalente a SET LOCAL).
 *
 * As políticas de Row Level Security usam `current_setting('app.org_id')`,
 * então TODA leitura/escrita nas tabelas de domínio deve passar por aqui.
 * A aplicação continua filtrando por org_id explicitamente nas queries —
 * o RLS é a segunda camada (defesa em profundidade).
 */
export async function withOrgTx<T>(
  orgId: string,
  fn: (tx: OrgTx) => Promise<T>,
): Promise<T> {
  if (!orgId) {
    throw new Error("withOrgTx exige um orgId não-vazio");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
