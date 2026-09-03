"use server";

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { CLAN_DUTIES } from "@/domain/clan-duties";
import { canManageClanMembership } from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";
import { normalizeSectorText } from "@/domain/clan-routing";
import { slugify } from "@/lib/slug";

const membershipTargetSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  userId: z.string().min(1, "Pessoa inválida."),
});

const leaderSchema = membershipTargetSchema.extend({
  isLeader: z.boolean(),
});

const clanDetailsSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(100),
  description: z.string().trim().max(500).nullable(),
});

const updateClanSchema = clanDetailsSchema.extend({
  clanId: z.uuid("Clã inválido."),
  active: z.boolean(),
});

const functionSchema = membershipTargetSchema.extend({
  functionTitle: z.string().trim().max(100).nullable(),
});

const routingRulesSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  rules: z
    .array(
      z.object({
        sector: z.string().trim().min(1).max(120),
        userId: z.string().min(1).nullable(),
      }),
    )
    .max(60),
});

function revalidateClanPaths(): void {
  revalidatePath("/settings");
  revalidatePath("/clans");
  revalidatePath("/tasks");
  revalidatePath("/tasks/new");
  revalidatePath("/members");
  revalidatePath("/informativos");
}

async function requireClanManager() {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  // A régua mora no domínio (`canManageClanMembership`), testada à parte.
  if (!canManageClanMembership({ role: ctx.role })) {
    return err("Apenas admin ou owner pode gerenciar a composição dos clãs.");
  }
  return ctx;
}

/**
 * A linha do clã é o mutex das alterações de liderança. Assim duas
 * remoções concorrentes não conseguem observar simultaneamente dois líderes
 * e deixar o clã ativo sem nenhum.
 */
async function lockClan(tx: OrgTx, orgId: string, clanId: string) {
  const [clan] = await tx
    .select({
      id: schema.clans.id,
      active: schema.clans.active,
      slug: schema.clans.slug,
    })
    .from(schema.clans)
    .where(and(eq(schema.clans.orgId, orgId), eq(schema.clans.id, clanId)))
    .for("update");
  return clan;
}

/**
 * Ordem global quando uma operação precisa dos dois mutexes: member primeiro,
 * clan depois. O trigger de remoção usa a mesma ordem; nunca inverter.
 * Também prova o vínculo Better Auth e serializa a escolha de clã principal.
 */
async function lockOrgMember(tx: OrgTx, orgId: string, userId: string) {
  const [member] = await tx
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, orgId),
        eq(schema.member.userId, userId),
      ),
    )
    .for("update");
  return member;
}

async function leaderCount(tx: OrgTx, orgId: string, clanId: string) {
  const leaders = await tx
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
        eq(schema.clanMemberships.isLeader, true),
        eq(schema.member.organizationId, orgId),
      ),
    );
  return leaders.length;
}

export async function createClan(
  input: z.input<typeof clanDetailsSchema>,
): Promise<ActionResult<{ clanId: string }>> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = clanDetailsSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<{ clanId: string }>> => {
    const baseSlug = slugify(parsed.data.name).slice(0, 60) || "cla";
    const existing = await tx
      .select({ slug: schema.clans.slug })
      .from(schema.clans)
      .where(eq(schema.clans.orgId, ctx.orgId));
    const used = new Set(existing.map((row) => row.slug));
    let slug = baseSlug;
    for (let suffix = 2; used.has(slug); suffix += 1) {
      slug = `${baseSlug.slice(0, 55)}-${suffix}`;
    }

    const [clan] = await tx
      .insert(schema.clans)
      .values({
        orgId: ctx.orgId,
        name: parsed.data.name,
        slug,
        description: parsed.data.description || null,
      })
      .returning({ id: schema.clans.id });
    await tx.insert(schema.clanMemberships).values({
      orgId: ctx.orgId,
      clanId: clan.id,
      userId: ctx.userId,
      isLeader: true,
      isPrimary: false,
      functionTitle: "Liderança",
    });
    const normalizedName = normalizeSectorText(parsed.data.name);
    const [routeConflict] = await tx
      .select({ id: schema.clanInformativeRoutes.id })
      .from(schema.clanInformativeRoutes)
      .where(
        and(
          eq(schema.clanInformativeRoutes.orgId, ctx.orgId),
          eq(schema.clanInformativeRoutes.normalizedSector, normalizedName),
        ),
      );
    if (!routeConflict) {
      await tx.insert(schema.clanInformativeRoutes).values({
        orgId: ctx.orgId,
        clanId: clan.id,
        sector: parsed.data.name,
        normalizedSector: normalizedName,
      });
    }
    return { ok: true, data: { clanId: clan.id } };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}

export async function updateClan(
  input: z.input<typeof updateClanSchema>,
): Promise<ActionResult> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = updateClanSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const clan = await lockClan(tx, ctx.orgId, parsed.data.clanId);
    if (!clan) return err("Clã não encontrado.");
    if (parsed.data.active && (await leaderCount(tx, ctx.orgId, clan.id)) === 0) {
      return err("Defina ao menos uma liderança antes de ativar o clã.");
    }
    await tx
      .update(schema.clans)
      .set({
        name: parsed.data.name,
        description: parsed.data.description || null,
        active: parsed.data.active,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.clans.orgId, ctx.orgId), eq(schema.clans.id, clan.id)));
    return { ok: true };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}

export async function setClanMemberFunction(
  input: z.input<typeof functionSchema>,
): Promise<ActionResult> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = functionSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const updated = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .update(schema.clanMemberships)
      .set({ functionTitle: parsed.data.functionTitle || null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.clanId, parsed.data.clanId),
          eq(schema.clanMemberships.userId, parsed.data.userId),
        ),
      )
      .returning({ id: schema.clanMemberships.id }),
  );
  if (updated.length === 0) return err("A pessoa não participa deste clã.");
  revalidateClanPaths();
  return { ok: true };
}

export async function replaceClanRoutingRules(
  input: z.input<typeof routingRulesSchema>,
): Promise<ActionResult> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = routingRulesSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const normalized = parsed.data.rules.map((rule) => ({
    sector: rule.sector,
    normalizedSector: normalizeSectorText(rule.sector),
    userId: rule.userId,
  }));
  if (normalized.some((rule) => !rule.normalizedSector)) return err("Informe nomes de setor válidos.");
  if (new Set(normalized.map((rule) => rule.normalizedSector)).size !== normalized.length) {
    return err("O mesmo setor foi informado mais de uma vez neste clã.");
  }

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const clan = await lockClan(tx, ctx.orgId, parsed.data.clanId);
    if (!clan) return err("Clã não encontrado.");
    const otherRules = await tx
      .select({ sector: schema.clanInformativeRoutes.sector, normalizedSector: schema.clanInformativeRoutes.normalizedSector })
      .from(schema.clanInformativeRoutes)
      .where(
        and(
          eq(schema.clanInformativeRoutes.orgId, ctx.orgId),
          ne(schema.clanInformativeRoutes.clanId, clan.id),
        ),
      );
    const conflict = normalized.find((rule) =>
      otherRules.some((other) => other.normalizedSector === rule.normalizedSector),
    );
    if (conflict) {
      const owner = otherRules.find((other) => other.normalizedSector === conflict.normalizedSector);
      return err(`O setor “${owner?.sector ?? conflict.sector}” já pertence a outro clã.`);
    }

    const directedUserIds = [...new Set(normalized.flatMap((rule) => rule.userId ? [rule.userId] : []))];
    if (directedUserIds.length > 0) {
      const memberships = await tx
        .select({ userId: schema.clanMemberships.userId })
        .from(schema.clanMemberships)
        .where(
          and(
            eq(schema.clanMemberships.orgId, ctx.orgId),
            eq(schema.clanMemberships.clanId, clan.id),
            inArray(schema.clanMemberships.userId, directedUserIds),
          ),
        );
      if (memberships.length !== directedUserIds.length) {
        return err("Todo destino pessoal precisa participar deste clã.");
      }
    }

    await tx
      .delete(schema.clanInformativeRoutes)
      .where(
        and(
          eq(schema.clanInformativeRoutes.orgId, ctx.orgId),
          eq(schema.clanInformativeRoutes.clanId, clan.id),
        ),
      );
    if (normalized.length > 0) {
      await tx.insert(schema.clanInformativeRoutes).values(
        normalized.map((rule) => ({
          orgId: ctx.orgId,
          clanId: clan.id,
          ...rule,
        })),
      );
    }
    return { ok: true };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}

export async function addClanMembership(
  input: z.input<typeof membershipTargetSchema>,
): Promise<ActionResult> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = membershipTargetSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const orgMember = await lockOrgMember(tx, ctx.orgId, parsed.data.userId);
    if (!orgMember) return err("A pessoa não pertence a esta organização.");
    const clan = await lockClan(tx, ctx.orgId, parsed.data.clanId);
    if (!clan || !clan.active) return err("Clã ativo não encontrado.");

    const [existing] = await tx
      .select({ id: schema.clanMemberships.id })
      .from(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.clanId, parsed.data.clanId),
          eq(schema.clanMemberships.userId, parsed.data.userId),
        ),
      )
      .limit(1);
    if (existing) return err("Essa pessoa já participa do clã.");

    const [anotherMembership] = await tx
      .select({ id: schema.clanMemberships.id })
      .from(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.userId, parsed.data.userId),
        ),
      )
      .limit(1);

    await tx.insert(schema.clanMemberships).values({
      orgId: ctx.orgId,
      clanId: parsed.data.clanId,
      userId: parsed.data.userId,
      isPrimary: !anotherMembership,
    });
    return { ok: true };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}

export async function removeClanMembership(
  input: z.input<typeof membershipTargetSchema>,
): Promise<ActionResult> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = membershipTargetSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const orgMember = await lockOrgMember(tx, ctx.orgId, parsed.data.userId);
    if (!orgMember) return err("A pessoa não pertence a esta organização.");
    const clan = await lockClan(tx, ctx.orgId, parsed.data.clanId);
    if (!clan) return err("Clã não encontrado.");

    const [membership] = await tx
      .select()
      .from(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.clanId, parsed.data.clanId),
          eq(schema.clanMemberships.userId, parsed.data.userId),
        ),
      )
      .limit(1);
    if (!membership) return err("Vínculo com o clã não encontrado.");

    if (clan.active && membership.isLeader) {
      const leaders = await leaderCount(tx, ctx.orgId, clan.id);
      if (leaders <= 1) {
        return err("Defina outro líder antes de remover o último líder do clã.");
      }
    }

    const [activeTask] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.orgId, ctx.orgId),
          eq(schema.tasks.clanId, clan.id),
          eq(schema.tasks.assigneeId, parsed.data.userId),
          inArray(schema.tasks.status, [
            "pending",
            "in_progress",
            "awaiting_approval",
            "rejected",
          ]),
        ),
      )
      .limit(1);
    if (activeTask) {
      return err(
        "Transfira ou conclua as missões ativas desta pessoa no clã antes de remover o vínculo.",
      );
    }

    if (clan.slug === FISCAL_CLAN_SLUG) {
      const [portfolio] = await tx
        .select({ id: schema.fiscalPortfolios.id })
        .from(schema.fiscalPortfolios)
        .where(
          and(
            eq(schema.fiscalPortfolios.orgId, ctx.orgId),
            eq(schema.fiscalPortfolios.userId, parsed.data.userId),
          ),
        )
        .limit(1);
      if (portfolio) {
        return err(
          "Transfira as empresas da carteira fiscal desta pessoa antes de remover o vínculo.",
        );
      }
    }

    await tx
      .delete(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.id, membership.id),
        ),
      );

    if (membership.isPrimary) {
      const [nextMembership] = await tx
        .select({ id: schema.clanMemberships.id })
        .from(schema.clanMemberships)
        .where(
          and(
            eq(schema.clanMemberships.orgId, ctx.orgId),
            eq(schema.clanMemberships.userId, parsed.data.userId),
          ),
        )
        .orderBy(
          asc(schema.clanMemberships.createdAt),
          asc(schema.clanMemberships.clanId),
        )
        .limit(1);
      if (nextMembership) {
        await tx
          .update(schema.clanMemberships)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(
            and(
              eq(schema.clanMemberships.orgId, ctx.orgId),
              eq(schema.clanMemberships.id, nextMembership.id),
            ),
          );
      }
    }

    return { ok: true };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}

export async function setClanLeader(
  input: z.input<typeof leaderSchema>,
): Promise<ActionResult> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = leaderSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const orgMember = await lockOrgMember(tx, ctx.orgId, parsed.data.userId);
    if (!orgMember) return err("A pessoa não pertence a esta organização.");
    const clan = await lockClan(tx, ctx.orgId, parsed.data.clanId);
    if (!clan) return err("Clã não encontrado.");

    const [membership] = await tx
      .select({ id: schema.clanMemberships.id, isLeader: schema.clanMemberships.isLeader })
      .from(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.clanId, clan.id),
          eq(schema.clanMemberships.userId, parsed.data.userId),
        ),
      )
      .limit(1);
    if (!membership) return err("A pessoa não participa deste clã.");
    if (membership.isLeader === parsed.data.isLeader) return { ok: true };

    if (clan.active && membership.isLeader && !parsed.data.isLeader) {
      const leaders = await leaderCount(tx, ctx.orgId, clan.id);
      if (leaders <= 1) {
        return err("Defina outro líder antes de retirar a última liderança do clã.");
      }
    }

    await tx
      .update(schema.clanMemberships)
      .set({ isLeader: parsed.data.isLeader, updatedAt: new Date() })
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.id, membership.id),
        ),
      );
    return { ok: true };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}

export async function setPrimaryClan(
  input: z.input<typeof membershipTargetSchema>,
): Promise<ActionResult> {
  const ctx = await requireClanManager();
  if (!ctx.ok) return ctx;
  const parsed = membershipTargetSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const orgMember = await lockOrgMember(tx, ctx.orgId, parsed.data.userId);
    if (!orgMember) return err("A pessoa não pertence a esta organização.");
    const clan = await lockClan(tx, ctx.orgId, parsed.data.clanId);
    if (!clan || !clan.active) return err("Clã ativo não encontrado.");

    const [membership] = await tx
      .select({ id: schema.clanMemberships.id })
      .from(schema.clanMemberships)
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.clanId, clan.id),
          eq(schema.clanMemberships.userId, parsed.data.userId),
        ),
      )
      .limit(1);
    if (!membership) return err("A pessoa não participa deste clã.");

    await tx
      .update(schema.clanMemberships)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.userId, parsed.data.userId),
        ),
      );
    await tx
      .update(schema.clanMemberships)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.id, membership.id),
        ),
      );
    return { ok: true };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}

const clanDutySchema = z.object({
  clanId: z.uuid("Clã inválido."),
  duty: z.enum(CLAN_DUTIES),
  /** `null` remove a atribuição — o trabalho volta a cair na fila do clã. */
  userId: z.string().min(1, "Pessoa inválida.").nullable(),
});

/**
 * Define (ou remove) quem responde por uma atribuição do clã.
 *
 * Uma atribuição tem UM dono por clã — a unicidade está no índice
 * `clan_member_duties_org_clan_duty_uidx`, e aqui a troca é delete + insert
 * para que designar outra pessoa substitua, em vez de acumular.
 *
 * Fica atrás de admin/owner pela mesma razão que a composição do clã: o vínculo
 * define o que a pessoa enxerga e recebe (decisão de 2026-08-18).
 */
export async function setClanDuty(
  input: z.input<typeof clanDutySchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (!canManageClanMembership({ role: ctx.role })) {
    return err("Apenas admin ou owner pode definir atribuições.");
  }
  const parsed = clanDutySchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const clan = await lockClan(tx, ctx.orgId, data.clanId);
    if (!clan) return err("Clã não encontrado.");

    if (data.userId) {
      // A FK composta já impediria, mas o erro dela não explica nada a quem usa.
      const [vinculo] = await tx
        .select({ userId: schema.clanMemberships.userId })
        .from(schema.clanMemberships)
        .where(and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.clanId, clan.id),
          eq(schema.clanMemberships.userId, data.userId),
        ))
        .limit(1);
      if (!vinculo) return err("A pessoa precisa participar deste clã.");
    }

    await tx
      .delete(schema.clanMemberDuties)
      .where(and(
        eq(schema.clanMemberDuties.orgId, ctx.orgId),
        eq(schema.clanMemberDuties.clanId, clan.id),
        eq(schema.clanMemberDuties.duty, data.duty),
      ));

    if (data.userId) {
      await tx.insert(schema.clanMemberDuties).values({
        orgId: ctx.orgId,
        clanId: clan.id,
        userId: data.userId,
        duty: data.duty,
        assignedBy: ctx.userId,
      });
    }
    return { ok: true };
  });

  if (result.ok) revalidateClanPaths();
  return result;
}
