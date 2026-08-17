import "server-only";

import { and, eq } from "drizzle-orm";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * Fatos de liderança que alimentam as funções puras de
 * `src/domain/guild-permissions.ts`. Só conta liderança de clã ATIVO e de
 * quem ainda é membro da organização — vínculo órfão não dá poder.
 */

export async function listLedClanIds(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ clanId: schema.clanMemberships.clanId })
    .from(schema.clanMemberships)
    .innerJoin(
      schema.clans,
      and(
        eq(schema.clans.id, schema.clanMemberships.clanId),
        eq(schema.clans.orgId, schema.clanMemberships.orgId),
      ),
    )
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.userId, schema.clanMemberships.userId),
        eq(schema.member.organizationId, schema.clanMemberships.orgId),
      ),
    )
    .where(
      and(
        eq(schema.clanMemberships.orgId, orgId),
        eq(schema.clanMemberships.userId, userId),
        eq(schema.clanMemberships.isLeader, true),
        eq(schema.clans.orgId, orgId),
        eq(schema.clans.active, true),
        eq(schema.member.organizationId, orgId),
      ),
    );
  return rows.map((row) => row.clanId);
}

/** Lidera este clã específico (e o clã está ativo)? */
export async function leadsClan(
  tx: OrgTx,
  orgId: string,
  userId: string,
  clanId: string,
): Promise<boolean> {
  const ledClanIds = await listLedClanIds(tx, orgId, userId);
  return ledClanIds.includes(clanId);
}

/** Lidera ao menos um clã ativo? Abre a própria transação com RLS. */
export async function leadsAnyClan(
  orgId: string,
  userId: string,
): Promise<boolean> {
  const ledClanIds = await withOrgTx(orgId, (tx) =>
    listLedClanIds(tx, orgId, userId),
  );
  return ledClanIds.length > 0;
}
