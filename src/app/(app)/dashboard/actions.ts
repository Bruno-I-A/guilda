"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { filterVisibleClans } from "@/domain/clan-access";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import {
  dashboardShortcutOptions,
  MAX_DASHBOARD_SHORTCUTS,
} from "@/lib/dashboard-shortcuts";

const shortcutSchema = z.object({
  target: z.string().trim().min(1).max(180),
  label: z.string().trim().min(1, "Informe o nome do atalho.").max(80),
});

const saveSchema = z.object({
  items: z.array(shortcutSchema).max(
    MAX_DASHBOARD_SHORTCUTS,
    `Escolha no máximo ${MAX_DASHBOARD_SHORTCUTS} atalhos.`,
  ),
}).superRefine((value, context) => {
  const targets = new Set<string>();
  for (const [index, item] of value.items.entries()) {
    if (targets.has(item.target)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "target"],
        message: "O mesmo destino não pode aparecer duas vezes.",
      });
    }
    targets.add(item.target);
  }
});

/** Salva a configuração completa, sempre vinculada ao usuário da sessão. */
export async function saveDashboardShortcuts(input: {
  items: { target: string; label: string }[];
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Atalhos inválidos.");
  }

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [clans, memberships] = await Promise.all([
      tx
        .select({ id: schema.clans.id, name: schema.clans.name, slug: schema.clans.slug })
        .from(schema.clans)
        .where(and(eq(schema.clans.orgId, ctx.orgId), eq(schema.clans.active, true)))
        .orderBy(asc(schema.clans.name)),
      tx
        .select({ clanId: schema.clanMemberships.clanId })
        .from(schema.clanMemberships)
        .where(and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.userId, ctx.userId),
        )),
    ]);
    const visibleClans = filterVisibleClans(
      { role: ctx.role, memberClanIds: memberships.map((row) => row.clanId) },
      clans,
    );
    const allowedTargets = new Set(
      dashboardShortcutOptions(visibleClans).map((option) => option.target),
    );
    if (parsed.data.items.some((item) => !allowedTargets.has(item.target))) {
      return err("Um dos atalhos aponta para uma área que você não pode acessar.");
    }

    await tx.delete(schema.dashboardShortcuts).where(and(
      eq(schema.dashboardShortcuts.orgId, ctx.orgId),
      eq(schema.dashboardShortcuts.userId, ctx.userId),
    ));
    if (parsed.data.items.length > 0) {
      await tx.insert(schema.dashboardShortcuts).values(
        parsed.data.items.map((item, index) => ({
          orgId: ctx.orgId,
          userId: ctx.userId,
          target: item.target,
          label: item.label,
          sortOrder: index,
        })),
      );
    }
    return { ok: true };
  });

  if (result.ok) revalidatePath("/dashboard");
  return result;
}
