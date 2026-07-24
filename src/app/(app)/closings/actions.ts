"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { CLOSING_YEAR_XP } from "@/domain/xp";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";

const yearSchema = z.number().int().min(2000).max(2100);

const closingFields = {
  title: z
    .string()
    .trim()
    .min(2, "Descreva o fechamento.")
    .max(160, "Descrição muito longa."),
  notes: z.string().trim().max(3000, "Observação muito longa."),
};

const createClosingSchema = z.object({
  ...closingFields,
  clientId: z.uuid(),
  year: yearSchema,
});

export async function createClosing(
  input: z.input<typeof createClosingSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = createClosingSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    const [created] = await tx
      .insert(schema.accountingClosings)
      .values({
        orgId: ctx.orgId,
        clientId: client.id,
        title: data.title,
        dueDate: `${data.year}-12-31`,
        status: "completed",
        notes: data.notes || null,
        createdBy: ctx.userId,
        completedBy: ctx.userId,
        completedAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.accountingClosings.id });

    return { ok: true, data: { id: created.id } } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/closings");
  return result;
}

const updateClosingSchema = z.object({
  ...closingFields,
  closingId: z.uuid(),
  clientId: z.uuid(),
  year: yearSchema,
});

export async function updateClosing(
  input: z.input<typeof updateClosingSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateClosingSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const closing = await tx.query.accountingClosings.findFirst({
      where: and(
        eq(schema.accountingClosings.id, data.closingId),
        eq(schema.accountingClosings.orgId, ctx.orgId),
      ),
      columns: { id: true, completedAt: true, completedBy: true },
    });
    if (!closing) return err("Fechamento não encontrado.");
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    await tx
      .update(schema.accountingClosings)
      .set({
        clientId: client.id,
        title: data.title,
        dueDate: `${data.year}-12-31`,
        status: "completed",
        notes: data.notes || null,
        completedBy: closing.completedBy ?? ctx.userId,
        completedAt: closing.completedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.accountingClosings.id, closing.id),
          eq(schema.accountingClosings.orgId, ctx.orgId),
        ),
      );

    return { ok: true } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/closings");
  return { ok: true };
}

const setStatusSchema = z.object({
  closingId: z.uuid(),
  status: z.enum(["pending", "completed"]),
});

export async function setClosingStatus(
  input: z.input<typeof setStatusSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return err("Situação inválida.");

  const completed = parsed.data.status === "completed";
  const updated = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .update(schema.accountingClosings)
      .set({
        status: parsed.data.status,
        completedBy: completed ? ctx.userId : null,
        completedAt: completed ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.accountingClosings.id, parsed.data.closingId),
          eq(schema.accountingClosings.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.accountingClosings.id }),
  );

  if (updated.length === 0) return err("Fechamento não encontrado.");
  revalidatePath("/closings");
  return { ok: true };
}

const deleteClosingSchema = z.object({ closingId: z.uuid() });

export async function deleteClosing(
  input: z.input<typeof deleteClosingSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = deleteClosingSchema.safeParse(input);
  if (!parsed.success) return err("Fechamento inválido.");

  const deleted = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .delete(schema.accountingClosings)
      .where(
        and(
          eq(schema.accountingClosings.id, parsed.data.closingId),
          eq(schema.accountingClosings.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.accountingClosings.id }),
  );

  if (deleted.length === 0) return err("Fechamento não encontrado.");
  revalidatePath("/closings");
  return { ok: true };
}

const closingYearSchema = z.object({
  clientId: z.uuid(),
  year: z.number().int().min(2000).max(2100),
});

const setYearClosedSchema = closingYearSchema.extend({
  closed: z.boolean(),
});

export async function setYearClosed(
  input: z.input<typeof setYearClosedSchema>,
): Promise<ActionResult<{ xpAwarded: boolean; xp: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setYearClosedSchema.safeParse(input);
  if (!parsed.success) return err("Empresa ou ano inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    const existing = await tx.query.accountingClosingYears.findFirst({
      where: and(
        eq(schema.accountingClosingYears.orgId, ctx.orgId),
        eq(schema.accountingClosingYears.clientId, client.id),
        eq(schema.accountingClosingYears.year, data.year),
      ),
      columns: { id: true, closedAt: true },
    });

    const annual = existing
      ? (
          await tx
            .update(schema.accountingClosingYears)
            .set({
              closedAt: data.closed ? now : null,
              closedBy: data.closed ? ctx.userId : null,
              // Uma DEFIS entregue para um ano reaberto precisa ser revisada.
              ...(data.closed
                ? {}
                : { defisCompletedAt: null, defisCompletedBy: null }),
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.accountingClosingYears.id, existing.id),
                eq(schema.accountingClosingYears.orgId, ctx.orgId),
              ),
            )
            .returning({ id: schema.accountingClosingYears.id })
        )[0]
      : (
          await tx
            .insert(schema.accountingClosingYears)
            .values({
              orgId: ctx.orgId,
              clientId: client.id,
              year: data.year,
              closedAt: data.closed ? now : null,
              closedBy: data.closed ? ctx.userId : null,
              updatedAt: now,
            })
            .returning({ id: schema.accountingClosingYears.id })
        )[0];

    let xpAwarded = false;
    if (data.closed) {
      const credited = await tx
        .insert(schema.xpLedger)
        .values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          closingYearId: annual.id,
          amount: CLOSING_YEAR_XP,
          reason: "closing_year_closed",
        })
        .onConflictDoNothing()
        .returning({ id: schema.xpLedger.id });
      xpAwarded = credited.length > 0;
    }

    return {
      ok: true,
      data: { xpAwarded, xp: CLOSING_YEAR_XP },
    } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/closings");
  if (result.data.xpAwarded) {
    revalidatePath("/profile");
    revalidatePath("/leaderboard");
  }
  return result;
}

const setDefisCompletedSchema = closingYearSchema.extend({
  completed: z.boolean(),
});

export async function setDefisCompleted(
  input: z.input<typeof setDefisCompletedSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setDefisCompletedSchema.safeParse(input);
  if (!parsed.success) return err("Empresa ou ano inválido.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true, taxRegime: true },
    });
    if (!client) return err("Empresa não encontrada.");
    if (client.taxRegime !== "simples") {
      return err("O controle da DEFIS é exclusivo do Simples Nacional.");
    }

    const annual = await tx.query.accountingClosingYears.findFirst({
      where: and(
        eq(schema.accountingClosingYears.orgId, ctx.orgId),
        eq(schema.accountingClosingYears.clientId, client.id),
        eq(schema.accountingClosingYears.year, data.year),
      ),
      columns: { id: true, closedAt: true },
    });
    if (!annual?.closedAt) {
      return err("Feche o ano da empresa antes de registrar a DEFIS.");
    }

    const updated = await tx
      .update(schema.accountingClosingYears)
      .set({
        defisCompletedAt: data.completed ? new Date() : null,
        defisCompletedBy: data.completed ? ctx.userId : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.accountingClosingYears.id, annual.id),
          eq(schema.accountingClosingYears.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.accountingClosingYears.id });

    return updated.length > 0
      ? ({ ok: true } as const)
      : err("Controle anual não encontrado.");
  });

  if (!result.ok) return result;
  revalidatePath("/closings");
  return { ok: true };
}

const updateYearNotesSchema = closingYearSchema.extend({
  notes: z.string().trim().max(3000, "Observação do ano muito longa."),
  defisNotes: z.string().trim().max(3000, "Observação da DEFIS muito longa."),
});

export async function updateYearNotes(
  input: z.input<typeof updateYearNotesSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateYearNotesSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
        eq(schema.clients.active, true),
      ),
      columns: { id: true, taxRegime: true },
    });
    if (!client) return err("Empresa não encontrada.");

    const now = new Date();
    await tx
      .insert(schema.accountingClosingYears)
      .values({
        orgId: ctx.orgId,
        clientId: client.id,
        year: data.year,
        notes: data.notes || null,
        defisNotes:
          client.taxRegime === "simples" ? data.defisNotes || null : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.accountingClosingYears.orgId,
          schema.accountingClosingYears.clientId,
          schema.accountingClosingYears.year,
        ],
        set: {
          notes: data.notes || null,
          defisNotes:
            client.taxRegime === "simples" ? data.defisNotes || null : null,
          updatedAt: now,
        },
      });

    return { ok: true } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/closings");
  return { ok: true };
}
