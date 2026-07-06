"use server";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { TAX_REGIMES } from "@/lib/clients-ui";

/**
 * Server Actions dos templates de campanha (Fase 5b).
 * Qualquer membro gerencia. Delete físico é permitido: a instanciação (5c)
 * COPIA os itens para tasks — nada referencia estas tabelas.
 */

function revalidateTemplates(templateId?: string) {
  revalidatePath("/campaigns/templates");
  if (templateId) revalidatePath(`/campaigns/templates/${templateId}`);
}

// ── Templates ─────────────────────────────────────────────────────────

const templateFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome muito curto.")
    .max(120, "Nome muito longo."),
  taxRegime: z.enum(TAX_REGIMES, { error: "Escolha o regime tributário." }),
});

export async function createTemplate(
  input: z.input<typeof templateFieldsSchema>,
): Promise<ActionResult<{ templateId: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = templateFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const [created] = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .insert(schema.missionTemplates)
      .values({
        orgId: ctx.orgId,
        name: parsed.data.name,
        taxRegime: parsed.data.taxRegime,
      })
      .returning({ id: schema.missionTemplates.id }),
  );

  revalidateTemplates();
  return { ok: true, data: { templateId: created.id } };
}

const updateTemplateSchema = templateFieldsSchema.extend({
  templateId: z.uuid(),
});

export async function updateTemplate(
  input: z.input<typeof updateTemplateSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const updated = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .update(schema.missionTemplates)
      .set({ name: data.name, taxRegime: data.taxRegime })
      .where(
        and(
          eq(schema.missionTemplates.id, data.templateId),
          eq(schema.missionTemplates.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.missionTemplates.id }),
  );
  if (updated.length === 0) return err("Template não encontrado.");

  revalidateTemplates(data.templateId);
  return { ok: true };
}

export async function deleteTemplate(input: {
  templateId: string;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = z.object({ templateId: z.uuid() }).safeParse(input);
  if (!parsed.success) return err("Template inválido.");

  const deleted = await withOrgTx(ctx.orgId, async (tx) => {
    await tx
      .delete(schema.missionTemplateItems)
      .where(
        and(
          eq(schema.missionTemplateItems.templateId, parsed.data.templateId),
          eq(schema.missionTemplateItems.orgId, ctx.orgId),
        ),
      );
    return tx
      .delete(schema.missionTemplates)
      .where(
        and(
          eq(schema.missionTemplates.id, parsed.data.templateId),
          eq(schema.missionTemplates.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.missionTemplates.id });
  });
  if (deleted.length === 0) return err("Template não encontrado.");

  revalidateTemplates();
  return { ok: true };
}

// ── Itens do checklist ────────────────────────────────────────────────

const itemFieldsSchema = z.object({
  templateId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(3, "Título muito curto.")
    .max(200, "Título muito longo."),
  difficulty: z.coerce.number().int().min(1).max(5),
});

export async function addTemplateItem(
  input: z.input<typeof itemFieldsSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = itemFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const template = await tx.query.missionTemplates.findFirst({
      where: and(
        eq(schema.missionTemplates.id, data.templateId),
        eq(schema.missionTemplates.orgId, ctx.orgId),
      ),
    });
    if (!template) return err("Template não encontrado.");

    const [{ maxIndex }] = await tx
      .select({ maxIndex: max(schema.missionTemplateItems.orderIndex) })
      .from(schema.missionTemplateItems)
      .where(
        and(
          eq(schema.missionTemplateItems.templateId, data.templateId),
          eq(schema.missionTemplateItems.orgId, ctx.orgId),
        ),
      );

    await tx.insert(schema.missionTemplateItems).values({
      orgId: ctx.orgId,
      templateId: data.templateId,
      title: data.title,
      difficulty: data.difficulty,
      orderIndex: (maxIndex ?? -1) + 1,
    });
    return { ok: true };
  });

  if (result.ok) revalidateTemplates(data.templateId);
  return result;
}

const updateItemSchema = z.object({
  itemId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(3, "Título muito curto.")
    .max(200, "Título muito longo."),
  difficulty: z.coerce.number().int().min(1).max(5),
});

export async function updateTemplateItem(
  input: z.input<typeof updateItemSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const updated = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .update(schema.missionTemplateItems)
      .set({ title: data.title, difficulty: data.difficulty })
      .where(
        and(
          eq(schema.missionTemplateItems.id, data.itemId),
          eq(schema.missionTemplateItems.orgId, ctx.orgId),
        ),
      )
      .returning({ templateId: schema.missionTemplateItems.templateId }),
  );
  if (updated.length === 0) return err("Item não encontrado.");

  revalidateTemplates(updated[0].templateId);
  return { ok: true };
}

export async function deleteTemplateItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = z.object({ itemId: z.uuid() }).safeParse(input);
  if (!parsed.success) return err("Item inválido.");

  const deleted = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .delete(schema.missionTemplateItems)
      .where(
        and(
          eq(schema.missionTemplateItems.id, parsed.data.itemId),
          eq(schema.missionTemplateItems.orgId, ctx.orgId),
        ),
      )
      .returning({ templateId: schema.missionTemplateItems.templateId }),
  );
  if (deleted.length === 0) return err("Item não encontrado.");

  revalidateTemplates(deleted[0].templateId);
  return { ok: true };
}

const moveItemSchema = z.object({
  itemId: z.uuid(),
  direction: z.enum(["up", "down"]),
});

/** Troca o order_index com o vizinho imediato (lock nas duas linhas). */
export async function moveTemplateItem(
  input: z.input<typeof moveItemSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = moveItemSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ templateId: string }>> => {
    const [item] = await tx
      .select()
      .from(schema.missionTemplateItems)
      .where(
        and(
          eq(schema.missionTemplateItems.id, parsed.data.itemId),
          eq(schema.missionTemplateItems.orgId, ctx.orgId),
        ),
      )
      .for("update");
    if (!item) return err("Item não encontrado.");

    const siblings = await tx
      .select()
      .from(schema.missionTemplateItems)
      .where(
        and(
          eq(schema.missionTemplateItems.templateId, item.templateId),
          eq(schema.missionTemplateItems.orgId, ctx.orgId),
        ),
      )
      .orderBy(schema.missionTemplateItems.orderIndex)
      .for("update");

    const position = siblings.findIndex((s) => s.id === item.id);
    const neighborPosition =
      parsed.data.direction === "up" ? position - 1 : position + 1;
    const neighbor = siblings[neighborPosition];
    if (!neighbor) return err("O item já está na ponta da lista.");

    await tx
      .update(schema.missionTemplateItems)
      .set({ orderIndex: neighbor.orderIndex })
      .where(eq(schema.missionTemplateItems.id, item.id));
    await tx
      .update(schema.missionTemplateItems)
      .set({ orderIndex: item.orderIndex })
      .where(eq(schema.missionTemplateItems.id, neighbor.id));

    return { ok: true, data: { templateId: item.templateId } };
  },
  );

  if (result.ok) {
    revalidateTemplates(result.data?.templateId);
    return { ok: true };
  }
  return result;
}
