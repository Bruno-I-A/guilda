"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  CLOSING_CADENCES,
  CLOSING_PERIODS,
  periodsForCadence,
} from "@/lib/closings-ui";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";

const closingCompletionSchema = z.object({
  clientId: z.uuid(),
  year: z.number().int().min(2000).max(2100),
  period: z.enum(CLOSING_PERIODS),
  completed: z.boolean(),
});

/**
 * Marca ou reabre um período. O cliente e sua periodicidade são relidos no
 * servidor; a UI nunca decide quais períodos uma empresa pode concluir.
 */
export async function setClosingCompletion(
  input: z.input<typeof closingCompletionSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = closingCompletionSchema.safeParse(input);
  if (!parsed.success) return err("Dados do fechamento inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx) => {
    const client = await tx.query.clients.findFirst({
      where: and(
        eq(schema.clients.id, data.clientId),
        eq(schema.clients.orgId, ctx.orgId),
      ),
      columns: { id: true, active: true, closingCadence: true },
    });
    if (!client) return err("Empresa não encontrada.");
    if (!client.active) return err("Esta empresa está inativa.");

    if (!periodsForCadence(client.closingCadence).includes(data.period)) {
      return err("Este período não pertence à periodicidade da empresa.");
    }

    if (data.completed) {
      await tx
        .insert(schema.accountingClosings)
        .values({
          orgId: ctx.orgId,
          clientId: client.id,
          year: data.year,
          period: data.period,
          completedBy: ctx.userId,
        })
        .onConflictDoNothing({
          target: [
            schema.accountingClosings.orgId,
            schema.accountingClosings.clientId,
            schema.accountingClosings.year,
            schema.accountingClosings.period,
          ],
        });
    } else {
      await tx
        .delete(schema.accountingClosings)
        .where(
          and(
            eq(schema.accountingClosings.orgId, ctx.orgId),
            eq(schema.accountingClosings.clientId, client.id),
            eq(schema.accountingClosings.year, data.year),
            eq(schema.accountingClosings.period, data.period),
          ),
        );
    }

    return { ok: true } as const;
  });

  if (!result.ok) return result;
  revalidatePath("/closings");
  return { ok: true };
}

const cadenceSchema = z.object({
  clientId: z.uuid(),
  cadence: z.enum(CLOSING_CADENCES),
});

/** Ajuste rápido da periodicidade diretamente na grade de fechamentos. */
export async function setClientClosingCadence(
  input: z.input<typeof cadenceSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = cadenceSchema.safeParse(input);
  if (!parsed.success) return err("Periodicidade inválida.");

  const updated = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .update(schema.clients)
      .set({ closingCadence: parsed.data.cadence })
      .where(
        and(
          eq(schema.clients.id, parsed.data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
          eq(schema.clients.active, true),
        ),
      )
      .returning({ id: schema.clients.id }),
  );

  if (updated.length === 0) return err("Empresa não encontrada.");

  revalidatePath("/closings");
  revalidatePath("/clients");
  return { ok: true };
}
