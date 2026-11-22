import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { buildRoutingRoster, chooseRecipient, type RoutingChoice, type RoutingMember } from "@/domain/support-routing";
import { err, type ActionResult } from "@/lib/action-context";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";

import type { AtendenteRoster } from "../triage/classificacao";
import { sectorForClan } from "../triage/sectors";

/**
 * Encaminhamento por assunto dentro do clã (2026-11-20). Só o clã dono da
 * Carteira (o Fiscal) tem assuntos que seguem a Carteira; nos outros, o que
 * não casar com uma pessoa vai para o líder.
 */

const rules = schema.supportRoutingTopics;
export const ROUTING_TOPICS_MAX = 500;

type Clan = { id: string; name: string; slug: string };

export type RoutingRule = { userId: string | null; topics: string };
export type ClanRoutingView = Clan & { isPortfolioClan: boolean; members: RoutingMember[]; rules: RoutingRule[] };

async function activeClans(tx: OrgTx, orgId: string): Promise<Clan[]> {
  return tx
    .select({ id: schema.clans.id, name: schema.clans.name, slug: schema.clans.slug })
    .from(schema.clans)
    .where(and(eq(schema.clans.orgId, orgId), eq(schema.clans.active, true)))
    .orderBy(asc(schema.clans.name));
}

/** Integrantes com vínculo na organização: quem saiu dela não recebe conversa, mesmo com o clã para trás. */
async function clanMembers(tx: OrgTx, orgId: string, clanId?: string) {
  return tx
    .select({
      clanId: schema.clanMemberships.clanId,
      userId: schema.clanMemberships.userId,
      name: schema.user.name,
      isLeader: schema.clanMemberships.isLeader,
    })
    .from(schema.clanMemberships)
    .innerJoin(schema.member, and(eq(schema.member.organizationId, schema.clanMemberships.orgId), eq(schema.member.userId, schema.clanMemberships.userId)))
    .innerJoin(schema.user, eq(schema.user.id, schema.clanMemberships.userId))
    .where(and(eq(schema.clanMemberships.orgId, orgId), ...(clanId ? [eq(schema.clanMemberships.clanId, clanId)] : [])))
    .orderBy(asc(schema.user.name));
}

export async function loadRoutingSettings(tx: OrgTx, orgId: string): Promise<ClanRoutingView[]> {
  const clans = await activeClans(tx, orgId);
  const members = await clanMembers(tx, orgId);
  const saved = await tx
    .select({ clanId: rules.clanId, userId: rules.userId, topics: rules.topics })
    .from(rules)
    .where(eq(rules.orgId, orgId));
  return clans.map((clan) => ({
    ...clan,
    isPortfolioClan: clan.slug === FISCAL_CLAN_SLUG,
    members: members.filter((m) => m.clanId === clan.id).map(({ userId, name, isLeader }) => ({ userId, name, isLeader })),
    rules: saved.filter((rule) => rule.clanId === clan.id).map(({ userId, topics }) => ({ userId, topics })),
  }));
}

/** A lista que vai ao prompt no teste do agente, com o setor de cada clã. */
export async function loadRoutingRoster(tx: OrgTx, orgId: string): Promise<AtendenteRoster[]> {
  const settings = await loadRoutingSettings(tx, orgId);
  return buildRoutingRoster(
    settings.map((clan) => ({
      sector: sectorForClan(clan, settings),
      members: clan.members,
      rules: clan.isPortfolioClan ? clan.rules : clan.rules.filter((rule) => rule.userId !== null),
    })),
  );
}

/** Quem recebe a conversa que o agente encaminhou ao clã (e o aviso). */
export async function resolveHandoffRecipients(
  tx: OrgTx,
  input: { orgId: string; clanId: string; suggested: string | null; clientId: string | null },
): Promise<RoutingChoice> {
  const members = (await clanMembers(tx, input.orgId, input.clanId)).map(({ userId, name, isLeader }) => ({ userId, name, isLeader }));
  const [clan] = await tx
    .select({ slug: schema.clans.slug })
    .from(schema.clans)
    .where(and(eq(schema.clans.orgId, input.orgId), eq(schema.clans.id, input.clanId)));
  let portfolioOwnerId: string | null = null;
  if (clan?.slug === FISCAL_CLAN_SLUG && input.clientId) {
    const [owner] = await tx
      .select({ userId: schema.fiscalPortfolios.userId })
      .from(schema.fiscalPortfolios)
      .where(and(eq(schema.fiscalPortfolios.orgId, input.orgId), eq(schema.fiscalPortfolios.clientId, input.clientId)));
    portfolioOwnerId = owner?.userId ?? null;
  }
  return chooseRecipient({ suggested: input.suggested, members, portfolioOwnerId });
}

/**
 * Grava as regras de um clã de uma vez (só admin chega aqui; a action confere).
 * Texto vazio apaga a regra; só integrante do clã recebe assunto, e só o clã
 * da Carteira tem assuntos da Carteira.
 */
export async function saveClanRoutingTopics(
  tx: OrgTx,
  input: { orgId: string; actorId: string; clanId: string; people: { userId: string; topics: string }[]; portfolioTopics: string; now: Date },
): Promise<ActionResult> {
  const [clan] = await tx
    .select({ slug: schema.clans.slug })
    .from(schema.clans)
    .where(and(eq(schema.clans.orgId, input.orgId), eq(schema.clans.id, input.clanId), eq(schema.clans.active, true)));
  if (!clan) return err("Clã não encontrado.");
  const memberIds = new Set((await clanMembers(tx, input.orgId, input.clanId)).map((m) => m.userId));
  const people = input.people.map((p) => ({ userId: p.userId, topics: p.topics.trim() })).filter((p) => p.topics);
  if (people.some((p) => !memberIds.has(p.userId))) return err("Só quem é do clã pode receber assuntos.");
  const portfolio = input.portfolioTopics.trim();
  if (portfolio && clan.slug !== FISCAL_CLAN_SLUG) return err("Só o clã da Carteira tem assuntos da Carteira.");
  if ([...people.map((p) => p.topics), portfolio].some((topics) => topics.length > ROUTING_TOPICS_MAX)) {
    return err(`Use até ${ROUTING_TOPICS_MAX} caracteres por pessoa.`);
  }

  await tx.delete(rules).where(and(eq(rules.orgId, input.orgId), eq(rules.clanId, input.clanId)));
  const rows = [
    ...people.map((p) => ({ userId: p.userId as string | null, topics: p.topics })),
    ...(portfolio ? [{ userId: null, topics: portfolio }] : []),
  ];
  if (rows.length > 0) {
    await tx.insert(rules).values(
      rows.map((row) => ({ orgId: input.orgId, clanId: input.clanId, userId: row.userId, topics: row.topics, updatedBy: input.actorId, updatedAt: input.now })),
    );
  }
  return { ok: true };
}
