"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { CLOSING_STATUSES } from "@/lib/closings-ui";

const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe um prazo válido.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      year >= 2000 &&
      year <= 2100 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Informe um prazo válido.");

const closingFields = {
  title: z
    .string()
    .trim()
    .min(2, "Descreva o fechamento.")
    .max(160, "Descrição muito longa."),
  dueDate: dueDateSchema,
  status: z.enum(CLOSING_STATUSES),
  notes: z.string().trim().max(3000, "Observação muito longa."),
};

const blockedNoteRule = {
  message: "Explique a pendência nas observações.",
  path: ["notes"] as string[],
};

const createClosingSchema = z
  .object({
    ...closingFields,
    clientId: z.uuid(),
  })
  .refine((data) => data.status !== "blocked" || data.notes.length >= 2, {
    message: "Explique a pendência nas observações.",
    path: ["notes"],
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
        dueDate: data.dueDate,
        status: data.status,
        notes: data.notes || null,
        createdBy: ctx.userId,
        completedBy: data.status === "completed" ? ctx.userId : null,
        completedAt: data.status === "completed" ? now : null,
        updatedAt: now,
      })
      .returning({ id: schema.accountingClosings.id });

    return { ok: true, data: { id: created.id } } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/closings");
  return result;
}

const updateClosingSchema = z
  .object({
    ...closingFields,
    closingId: z.uuid(),
    clientId: z.uuid(),
  })
  .refine(
    (data) => data.status !== "blocked" || data.notes.length >= 2,
    blockedNoteRule,
  );

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
      columns: { id: true, status: true, completedAt: true, completedBy: true },
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

    const completing = data.status === "completed";
    const now = new Date();
    await tx
      .update(schema.accountingClosings)
      .set({
        clientId: client.id,
        title: data.title,
        dueDate: data.dueDate,
        status: data.status,
        notes: data.notes || null,
        completedBy: completing
          ? closing.status === "completed"
            ? closing.completedBy
            : ctx.userId
          : null,
        completedAt: completing
          ? closing.status === "completed"
            ? closing.completedAt
            : now
          : null,
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
