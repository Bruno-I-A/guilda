"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  canEmphasizeNotice,
  canSeeNoticeAcknowledgements,
  type GuildActorFacts,
} from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { publishGuildNotice } from "@/lib/mural/notices";

/**
 * Server Actions do Mural da Guilda.
 *
 * Qualquer membro publica um aviso. Fixar ou exigir confirmação obriga a
 * Guilda inteira a dar ciência, então é restrito a líder e admin/owner —
 * a checagem usa fatos lidos do banco, nunca o que a interface mandar.
 */

/** Lidera ao menos um clã ATIVO — o fato que habilita fixar/exigir ciência. */
async function loadActorFacts(
  tx: OrgTx,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<GuildActorFacts> {
  const [leadership] = await tx
    .select({ id: schema.clanMemberships.id })
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
        eq(schema.clanMemberships.userId, userId),
        eq(schema.clanMemberships.isLeader, true),
        eq(schema.clans.active, true),
      ),
    )
    .limit(1);

  return { role, leadsAnyClan: Boolean(leadership) };
}

const publishSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Título muito curto.")
    .max(160, "Título muito longo."),
  body: z
    .string()
    .trim()
    .min(3, "Escreva o aviso.")
    .max(5000, "Aviso muito longo."),
  requiresAck: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export async function publishNotice(input: {
  title: string;
  body: string;
  requiresAck?: boolean;
  pinned?: boolean;
}): Promise<ActionResult<{ noticeId: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ noticeId: string }>> => {
      const wantsEmphasis = Boolean(data.requiresAck || data.pinned);
      if (wantsEmphasis) {
        const facts = await loadActorFacts(tx, ctx.orgId, ctx.userId, ctx.role);
        if (!canEmphasizeNotice(facts)) {
          return err(
            "Apenas um líder de clã ou admin pode fixar um aviso ou exigir confirmação.",
          );
        }
      }

      const created = await publishGuildNotice(tx, {
        orgId: ctx.orgId,
        authorId: ctx.userId,
        kind: "notice",
        title: data.title,
        body: data.body,
        requiresAck: data.requiresAck ?? false,
        pinned: data.pinned ?? false,
      });

      if (!created) return err("Não foi possível publicar o aviso.");
      return { ok: true, data: { noticeId: created.id } };
    },
  );

  if (result.ok) revalidatePath("/mural");
  return result;
}

const noticeIdSchema = z.object({ noticeId: z.uuid("Aviso inválido.") });

/**
 * Confirma a leitura. O userId vem SEMPRE da sessão — nunca do cliente,
 * então ninguém confirma no lugar de outra pessoa. Insert idempotente:
 * confirmar duas vezes não duplica registro e não é erro.
 */
export async function acknowledgeNotice(input: {
  noticeId: string;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = noticeIdSchema.safeParse(input);
  if (!parsed.success) return err("Aviso inválido.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [notice] = await tx
      .select({ id: schema.guildNotices.id })
      .from(schema.guildNotices)
      .where(
        and(
          eq(schema.guildNotices.id, parsed.data.noticeId),
          eq(schema.guildNotices.orgId, ctx.orgId),
        ),
      );
    if (!notice) return err("Aviso não encontrado.");

    await tx
      .insert(schema.guildNoticeReads)
      .values({
        orgId: ctx.orgId,
        noticeId: notice.id,
        userId: ctx.userId,
      })
      .onConflictDoNothing();

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/mural");
    revalidatePath("/dashboard");
  }
  return result;
}

/** Arquivar tira do mural sem apagar o histórico. Autor, líder ou admin. */
export async function archiveNotice(input: {
  noticeId: string;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = noticeIdSchema.safeParse(input);
  if (!parsed.success) return err("Aviso inválido.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [notice] = await tx
      .select({
        id: schema.guildNotices.id,
        authorId: schema.guildNotices.authorId,
        archivedAt: schema.guildNotices.archivedAt,
      })
      .from(schema.guildNotices)
      .where(
        and(
          eq(schema.guildNotices.id, parsed.data.noticeId),
          eq(schema.guildNotices.orgId, ctx.orgId),
        ),
      )
      .for("update");
    if (!notice) return err("Aviso não encontrado.");
    if (notice.archivedAt) return { ok: true };

    const facts = await loadActorFacts(tx, ctx.orgId, ctx.userId, ctx.role);
    if (
      !canSeeNoticeAcknowledgements({
        ...facts,
        isAuthor: notice.authorId === ctx.userId,
      })
    ) {
      return err("Apenas quem publicou, um líder ou um admin pode arquivar o aviso.");
    }

    await tx
      .update(schema.guildNotices)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.guildNotices.id, notice.id),
          eq(schema.guildNotices.orgId, ctx.orgId),
        ),
      );

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/mural");
    revalidatePath("/dashboard");
  }
  return result;
}
