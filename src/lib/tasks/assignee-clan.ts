import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";

/**
 * Clãs ativos de quem vai receber a missão: o formulário e o WhatsApp
 * (2026-11-24) tiram daqui o clã da missão individual, pela mesma régua
 * (`resolveAssigneeClan`). A identidade do clã nunca vem de fora.
 */
export async function activeClanMembershipsForUser(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<Array<{ clanId: string; isPrimary: boolean }>> {
  await lockActiveClansForMembershipRead(tx, orgId);
  return tx
    .select({
      clanId: schema.clanMemberships.clanId,
      isPrimary: schema.clanMemberships.isPrimary,
    })
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
        eq(schema.clans.orgId, orgId),
        eq(schema.clans.active, true),
        eq(schema.member.organizationId, orgId),
        eq(schema.member.userId, userId),
      ),
    );
}
