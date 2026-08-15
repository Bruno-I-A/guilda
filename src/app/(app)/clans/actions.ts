"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";

const membershipTargetSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  userId: z.string().min(1, "Pessoa inválida."),
});

const leaderSchema = membershipTargetSchema.extend({
  isLeader: z.boolean(),
});

function revalidateClanPaths(): void {
  revalidatePath("/clans");
  revalidatePath("/tasks");
  revalidatePath("/tasks/new");
  revalidatePath("/members");
}

async function requireClanManager() {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "admin" && ctx.role !== "owner") {
    return err("Apenas admin ou owner pode gerenciar os clãs.");
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
    .select({ id: schema.clans.id, active: schema.clans.active })
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
