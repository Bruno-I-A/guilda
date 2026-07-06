"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { normalizeCnpj, validateCnpj } from "@/domain/cnpj";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { TAX_REGIMES } from "@/lib/clients-ui";

/**
 * Server Actions das empresas-cliente (Fase 5a).
 * Qualquer membro da org gerencia o cadastro (decisão de 2026-07-06).
 * Sem DELETE: cliente sai de cena com active = false.
 */

const clientFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome muito curto.")
    .max(200, "Nome muito longo."),
  taxRegime: z.enum(TAX_REGIMES, { error: "Escolha o regime tributário." }),
  cnpj: z
    .string()
    .optional()
    .transform((v) => (v ? normalizeCnpj(v) : undefined))
    .refine((v) => !v || validateCnpj(v), "CNPJ inválido — confira os dígitos."),
});

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code === "23505";
}

export async function createClient(
  input: z.input<typeof clientFieldsSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = clientFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  try {
    await withOrgTx(ctx.orgId, (tx) =>
      tx.insert(schema.clients).values({
        orgId: ctx.orgId,
        name: data.name,
        taxRegime: data.taxRegime,
        cnpj: data.cnpj ?? null,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err("Já existe uma empresa com este CNPJ na organização.");
    }
    throw error;
  }

  revalidatePath("/clients");
  return { ok: true };
}

const updateClientSchema = clientFieldsSchema.extend({
  clientId: z.uuid(),
});

export async function updateClient(
  input: z.input<typeof updateClientSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateClientSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  try {
    const updated = await withOrgTx(ctx.orgId, (tx) =>
      tx
        .update(schema.clients)
        .set({
          name: data.name,
          taxRegime: data.taxRegime,
          cnpj: data.cnpj ?? null,
        })
        .where(
          and(
            eq(schema.clients.id, data.clientId),
            eq(schema.clients.orgId, ctx.orgId),
          ),
        )
        .returning({ id: schema.clients.id }),
    );
    if (updated.length === 0) return err("Empresa não encontrada.");
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err("Já existe uma empresa com este CNPJ na organização.");
    }
    throw error;
  }

  revalidatePath("/clients");
  return { ok: true };
}

const setActiveSchema = z.object({
  clientId: z.uuid(),
  active: z.boolean(),
});

export async function setClientActive(
  input: z.input<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");

  const updated = await withOrgTx(ctx.orgId, (tx) =>
    tx
      .update(schema.clients)
      .set({ active: parsed.data.active })
      .where(
        and(
          eq(schema.clients.id, parsed.data.clientId),
          eq(schema.clients.orgId, ctx.orgId),
        ),
      )
      .returning({ id: schema.clients.id }),
  );
  if (updated.length === 0) return err("Empresa não encontrada.");

  revalidatePath("/clients");
  return { ok: true };
}
