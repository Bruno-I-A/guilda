import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/** Membros da organização (tabelas do better-auth — sem RLS). */
export async function listOrgMembers(orgId: string) {
  return db
    .select({
      userId: schema.member.userId,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, orgId))
    .orderBy(schema.user.name);
}

export interface ResolvedOrgMember {
  userId: string;
  role: string;
  name: string;
  email: string;
  clanId: string | null;
  clanName: string | null;
  resolutionError: string | null;
}

/**
 * Pessoas da organização com o clã que o servidor conseguiria inferir
 * para uma missão individual. A interface usa o resultado apenas como
 * transparência; a Server Action repete a resolução e a autorização.
 */
export async function listOrgMembersWithResolvedClan(
  orgId: string,
): Promise<ResolvedOrgMember[]> {
  const [members, memberships] = await Promise.all([
    listOrgMembers(orgId),
    withOrgTx(orgId, (tx) =>
      tx
        .select({
          userId: schema.clanMemberships.userId,
          clanId: schema.clanMemberships.clanId,
          clanName: schema.clans.name,
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
        .where(
          and(
            eq(schema.clanMemberships.orgId, orgId),
            eq(schema.clans.orgId, orgId),
            eq(schema.clans.active, true),
          ),
        )
        .orderBy(asc(schema.clans.name), asc(schema.clanMemberships.clanId)),
    ),
  ]);

  const byUser = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const current = byUser.get(membership.userId) ?? [];
    current.push(membership);
    byUser.set(membership.userId, current);
  }

  return members.map((member) => {
    const candidates = byUser.get(member.userId) ?? [];
    const primary = candidates.filter((candidate) => candidate.isPrimary);
    const resolved = primary.length === 1
      ? primary[0]
      : candidates.length === 1
        ? candidates[0]
        : null;

    let resolutionError: string | null = null;
    if (!resolved && candidates.length === 0) {
      resolutionError = "Sem vínculo com um clã ativo.";
    } else if (!resolved) {
      resolutionError = "Participa de vários clãs, mas nenhum é o principal.";
    }

    return {
      ...member,
      clanId: resolved?.clanId ?? null,
      clanName: resolved?.clanName ?? null,
      resolutionError,
    };
  });
}

/**
 * Clãs ativos da organização, sempre dentro do contexto RLS.
 * O slug acompanha o nome porque é a chave estável do roteamento
 * setor→clã (ver src/domain/clan-routing.ts).
 */
export async function listActiveClans(orgId: string) {
  return withOrgTx(orgId, (tx) =>
    tx
      .select({
        id: schema.clans.id,
        name: schema.clans.name,
        slug: schema.clans.slug,
      })
      .from(schema.clans)
      .where(and(eq(schema.clans.orgId, orgId), eq(schema.clans.active, true)))
      .orderBy(asc(schema.clans.name)),
  );
}
