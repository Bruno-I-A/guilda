import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { withOrgTx } from "@/db/org-tx";
import { SECTOR_CLAN_SYNONYMS } from "@/domain/clan-routing";

import {
  ACTIVE_ASSIGNED_TASK_STATUSES,
  DEFAULT_ORGANIZATION_CLANS,
  buildDefaultLeaderMemberships,
  memberRemovalBlockReason,
} from "./rules";

export class MemberRemovalBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberRemovalBlockedError";
  }
}

/**
 * Cria (ou completa) os clãs de uma organização e vincula o criador como
 * líder. Pode ser repetido com segurança após uma falha parcial.
 */
export async function bootstrapOrganizationClans(
  orgId: string,
  creatorUserId: string,
): Promise<void> {
  await withOrgTx(orgId, async (tx) => {
    await tx
      .insert(schema.clans)
      .values(
        DEFAULT_ORGANIZATION_CLANS.map((clan) => ({
          orgId,
          name: clan.name,
          slug: clan.slug,
          active: true,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.clans.orgId, schema.clans.slug],
        set: {
          active: true,
          updatedAt: new Date(),
        },
      });

    const defaultClans = await tx
      .select({ id: schema.clans.id, slug: schema.clans.slug })
      .from(schema.clans)
      .where(
        and(
          eq(schema.clans.orgId, orgId),
          inArray(
            schema.clans.slug,
            DEFAULT_ORGANIZATION_CLANS.map(({ slug }) => slug),
          ),
        ),
      );

    if (defaultClans.length !== DEFAULT_ORGANIZATION_CLANS.length) {
      throw new Error("Não foi possível inicializar todos os clãs da organização.");
    }

    const clanBySlug = new Map(defaultClans.map((clan) => [clan.slug, clan.id]));
    const defaultRoutes = Object.entries(SECTOR_CLAN_SYNONYMS).flatMap(
      ([sector, slug]) => {
        const clanId = clanBySlug.get(slug);
        return clanId
          ? [{ orgId, clanId, sector, normalizedSector: sector }]
          : [];
      },
    );
    if (defaultRoutes.length > 0) {
      await tx
        .insert(schema.clanInformativeRoutes)
        .values(defaultRoutes)
        .onConflictDoNothing({
          target: [
            schema.clanInformativeRoutes.orgId,
            schema.clanInformativeRoutes.normalizedSector,
          ],
        });
    }

    // Garante exatamente um principal mesmo se este bootstrap estiver retomando
    // uma execução parcial.
    await tx
      .update(schema.clanMemberships)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.clanMemberships.orgId, orgId),
          eq(schema.clanMemberships.userId, creatorUserId),
        ),
      );

    await tx
      .insert(schema.clanMemberships)
      .values(buildDefaultLeaderMemberships(orgId, creatorUserId, defaultClans))
      .onConflictDoUpdate({
        target: [
          schema.clanMemberships.orgId,
          schema.clanMemberships.clanId,
          schema.clanMemberships.userId,
        ],
        set: {
          isLeader: true,
          isPrimary: sql`excluded.is_primary`,
          updatedAt: new Date(),
        },
      });
  });
}

/**
 * Reconcilia, no login do owner, uma falha do hook não transacional de
 * criação da organização. O caminho saudável faz somente uma leitura.
 */
export async function ensureOrganizationClans(
  orgId: string,
  ownerUserId: string,
): Promise<void> {
  const complete = await withOrgTx(orgId, async (tx) => {
    const defaultClans = await tx
      .select({ slug: schema.clans.slug })
      .from(schema.clans)
      .where(
        and(
          eq(schema.clans.orgId, orgId),
          inArray(
            schema.clans.slug,
            DEFAULT_ORGANIZATION_CLANS.map(({ slug }) => slug),
          ),
        ),
      );
    return defaultClans.length === DEFAULT_ORGANIZATION_CLANS.length;
  });

  if (!complete) {
    await bootstrapOrganizationClans(orgId, ownerUserId);
  }
}

/**
 * Faz a validação amigável antes do Better Auth apagar o member. A garantia
 * atômica é repetida pelo trigger de banco da migration 0022, na mesma
 * transação do DELETE; este hook existe para devolver uma mensagem melhor.
 */
export async function prepareOrganizationMemberRemoval(
  orgId: string,
  userId: string,
): Promise<void> {
  await withOrgTx(orgId, async (tx) => {
    // Usa o mesmo mutex das actions de clã e uma ordem fixa para que uma
    // alteração concorrente de liderança não ocorra durante a validação.
    await tx
      .select({ id: schema.clans.id })
      .from(schema.clans)
      .where(and(eq(schema.clans.orgId, orgId), eq(schema.clans.active, true)))
      .orderBy(asc(schema.clans.id))
      .for("update");

    const [assignedTasks, activeClanLeaders] = await Promise.all([
      tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.orgId, orgId),
            eq(schema.tasks.assigneeId, userId),
            inArray(schema.tasks.status, ACTIVE_ASSIGNED_TASK_STATUSES),
          ),
        ),
      tx
        .select({
          clanId: schema.clanMemberships.clanId,
          clanName: schema.clans.name,
          leaderUserId: schema.clanMemberships.userId,
        })
        .from(schema.clanMemberships)
        .innerJoin(
          schema.clans,
          and(
            eq(schema.clans.orgId, schema.clanMemberships.orgId),
            eq(schema.clans.id, schema.clanMemberships.clanId),
          ),
        )
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.organizationId, schema.clanMemberships.orgId),
            eq(schema.member.userId, schema.clanMemberships.userId),
          ),
        )
        .where(
          and(
            eq(schema.clanMemberships.orgId, orgId),
            eq(schema.clanMemberships.isLeader, true),
            eq(schema.clans.active, true),
            eq(schema.member.organizationId, orgId),
          ),
        ),
    ]);

    const leadersByClan = new Map<
      string,
      { clanName: string; userIds: Set<string> }
    >();
    for (const leader of activeClanLeaders) {
      const entry = leadersByClan.get(leader.clanId) ?? {
        clanName: leader.clanName,
        userIds: new Set<string>(),
      };
      entry.userIds.add(leader.leaderUserId);
      leadersByClan.set(leader.clanId, entry);
    }

    const soleLeaderClanNames = [...leadersByClan.values()]
      .filter(
        ({ userIds }) => userIds.size === 1 && userIds.has(userId),
      )
      .map(({ clanName }) => clanName);

    const reason = memberRemovalBlockReason({
      activeAssignedTaskCount: assignedTasks.length,
      soleLeaderClanNames,
    });
    if (reason) throw new MemberRemovalBlockedError(reason);
  });
}

/** Cleanup idempotente após o Better Auth remover o member. */
export async function cleanupRemovedOrganizationMemberClans(
  orgId: string,
  userId: string,
): Promise<void> {
  await withOrgTx(orgId, async (tx) => {
    await tx
      .delete(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, orgId),
          eq(schema.clanMemberships.userId, userId),
        ),
      );

    // Sair da organização também corta o Telegram. Sem isto o vínculo do bot
    // sobrevivia à remoção: o Mural, as mudanças de fechamento e o resumo
    // diário continuavam chegando no celular de quem já não é da Guilda,
    // porque as duas rotas de envio enumeram `telegram_connections` e não a
    // tabela de membros. Um token de vínculo pendente também perde a validade.
    const now = new Date();
    await tx
      .update(schema.telegramConnections)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.telegramConnections.orgId, orgId),
          eq(schema.telegramConnections.userId, userId),
          isNull(schema.telegramConnections.revokedAt),
        ),
      );
    await tx
      .update(schema.telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.telegramLinkTokens.orgId, orgId),
          eq(schema.telegramLinkTokens.userId, userId),
          isNull(schema.telegramLinkTokens.consumedAt),
        ),
      );
  });
}
