import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

export type TelegramOutboxClaim = Readonly<{
  id: string;
  orgId: string;
  claimToken: string;
}>;

type ClaimRow = {
  outbox_id: string;
  org_id: string;
  claim_token: string;
};

/**
 * Reserva até 100 eventos. A função de banco retorna somente roteamento e o
 * lease; o worker deve ler payload/preferências dentro de `withOrgTx(orgId)`.
 */
export async function claimTelegramOutbox(
  limit = 20,
): Promise<TelegramOutboxClaim[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("O lote do outbox deve estar entre 1 e 100");
  }

  const result = await db.execute<ClaimRow>(
    sql`SELECT outbox_id, org_id, claim_token
        FROM public.claim_telegram_outbox(${limit}::integer)`,
  );
  return result.rows.map((row) => ({
    id: row.outbox_id,
    orgId: row.org_id,
    claimToken: row.claim_token,
  }));
}

/** Finaliza somente o lease atual; `false` indica claim vencido/reassumido. */
export async function finishTelegramOutbox(
  claim: TelegramOutboxClaim,
  result: { success: true } | { success: false; error?: unknown },
): Promise<boolean> {
  const error =
    result.success
      ? null
      : result.error instanceof Error
        ? result.error.message
        : typeof result.error === "string"
          ? result.error
          : "Falha desconhecida";

  const finished = await db.execute<{ finished: boolean }>(
    sql`SELECT public.finish_telegram_outbox(
          ${claim.id}::uuid,
          ${claim.claimToken}::uuid,
          ${result.success}::boolean,
          ${error}::text
        ) AS finished`,
  );
  return finished.rows[0]?.finished === true;
}

/** Adia o lease atual sem gastar uma tentativa de entrega. */
export async function deferTelegramOutbox(
  claim: TelegramOutboxClaim,
  minutes = 15,
): Promise<boolean> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("O adiamento deve estar entre 1 e 1440 minutos");
  }
  const deferred = await db.execute<{ deferred: boolean }>(
    sql`SELECT public.defer_telegram_outbox(
          ${claim.id}::uuid,
          ${claim.claimToken}::uuid,
          ${minutes}::integer
        ) AS deferred`,
  );
  return deferred.rows[0]?.deferred === true;
}
