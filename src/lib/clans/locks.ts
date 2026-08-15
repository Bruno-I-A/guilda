import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * Protocolo de concorrência para consumidores de clan_memberships.
 *
 * Quem cria, assume ou transfere missão segura FOR SHARE nos clãs ativos
 * antes de revalidar o vínculo. A remoção de membro segura FOR UPDATE nas
 * mesmas linhas; portanto ou a missão nasce primeiro e bloqueia a remoção,
 * ou a remoção apaga o vínculo primeiro e a operação falha ao revalidar.
 */
export async function lockActiveClansForMembershipRead(
  tx: OrgTx,
  orgId: string,
): Promise<void> {
  await tx
    .select({ id: schema.clans.id })
    .from(schema.clans)
    .where(and(eq(schema.clans.orgId, orgId), eq(schema.clans.active, true)))
    .orderBy(asc(schema.clans.id))
    .for("share");
}
