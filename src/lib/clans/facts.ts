import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import type { OrgRole } from "@/domain/task-state";

/**
 * Fatos de autorização lidos do banco, compartilhados pelas Server Actions
 * que agem sobre um clã (distribuição de missões, carteira, campanhas).
 *
 * A interface NUNCA informa quem é líder: quem responde é esta consulta.
 */

export interface ClanFacts {
  clan: { id: string; active: boolean; slug: string } | null;
  facts: {
    role: OrgRole;
    leadsThisClan: boolean;
    isActiveClanMember: boolean;
  };
}

export async function loadClanScopedFacts(
  tx: OrgTx,
  orgId: string,
  clanId: string,
  userId: string,
  role: OrgRole,
): Promise<ClanFacts> {
  const [clan] = await tx
    .select({
      id: schema.clans.id,
      active: schema.clans.active,
      slug: schema.clans.slug,
    })
    .from(schema.clans)
    .where(and(eq(schema.clans.orgId, orgId), eq(schema.clans.id, clanId)));

  if (!clan) {
    return {
      clan: null,
      facts: { role, leadsThisClan: false, isActiveClanMember: false },
    };
  }

  const [membership] = await tx
    .select({ isLeader: schema.clanMemberships.isLeader })
    .from(schema.clanMemberships)
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
        eq(schema.clanMemberships.clanId, clanId),
        eq(schema.clanMemberships.userId, userId),
        eq(schema.member.organizationId, orgId),
      ),
    )
    .limit(1);

  return {
    clan,
    facts: {
      role,
      leadsThisClan: clan.active && Boolean(membership?.isLeader),
      isActiveClanMember: clan.active && Boolean(membership),
    },
  };
}

/** A pessoa destino precisa ser membro ativo da organização E do clã. */
export async function isActiveClanMember(
  tx: OrgTx,
  orgId: string,
  clanId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.clanMemberships.id })
    .from(schema.clanMemberships)
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
        eq(schema.clanMemberships.clanId, clanId),
        eq(schema.clanMemberships.userId, userId),
        eq(schema.member.organizationId, orgId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
