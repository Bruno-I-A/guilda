"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canHandleInformatives } from "@/domain/guild-permissions";
import type { OrgRole } from "@/domain/task-state";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import {
  cancelInformative,
  confirmInformative,
  type InformativeTaskDecision,
} from "@/lib/informatives/confirm";
import {
  buildInformativeDraft,
  saveInformativeDraft,
  type InformativeActor,
} from "@/lib/informatives/draft";

/**
 * Server Actions do painel de informativos.
 *
 * Segunda porta de entrada do mesmo pipeline do Telegram: extrai, roteia e
 * mostra a prévia. NADA é criado antes de uma confirmação explícita.
 * Decisão 9: líder de clã também opera informativo, não só admin/owner.
 */

/** Lidera ao menos um clã ativo — habilita operar informativos. */
async function leadsAnyActiveClan(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
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
  return Boolean(row);
}

async function requireInformativeActor(): Promise<
  { ok: true; actor: InformativeActor } | { ok: false; error: string }
> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const leadsAnyClan = await withOrgTx(ctx.orgId, (tx) =>
    leadsAnyActiveClan(tx, ctx.orgId, ctx.userId),
  );

  if (!canHandleInformatives({ role: ctx.role as OrgRole, leadsAnyClan })) {
    return err("Apenas um líder de clã, admin ou owner pode processar informativos.");
  }

  return {
    ok: true,
    actor: { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role as OrgRole },
  };
}

const analyzeSchema = z.object({
  sourceText: z
    .string()
    .trim()
    .min(10, "Cole o informativo — está curto demais para analisar.")
    .max(12_000, "O informativo excede 12.000 caracteres. Envie uma empresa por vez."),
});

/**
 * Extrai e roteia, salvando a prévia. Substitui a prévia pendente anterior
 * desta mesma pessoa (`saveInformativeDraft` cancela a antiga), então não
 * há duas prévias competindo pela confirmação.
 */
export async function analyzeInformative(input: {
  sourceText: string;
}): Promise<ActionResult<{ informativeId: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = analyzeSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  let draft;
  try {
    draft = await buildInformativeDraft(gate.actor, parsed.data.sourceText);
  } catch (error) {
    // Falha de rede/chave de API não deve vazar detalhe interno para a tela.
    console.error("informativo: falha ao extrair", error);
    return err("Não foi possível analisar o informativo agora. Tente de novo.");
  }

  if (!draft.ok) return err(draft.message);

  const saved = await saveInformativeDraft({
    actor: gate.actor,
    payload: draft.payload,
    model: draft.model,
    sourceText: parsed.data.sourceText,
    source: "panel",
    connectionId: null,
  });

  revalidatePath("/informativos");
  return { ok: true, data: { informativeId: saved.id } };
}

const decisionSchema = z.object({
  index: z.number().int().min(0).max(59),
  clanId: z.uuid("Clã inválido.").nullish(),
  assigneeId: z.string().min(1).nullish(),
});

const confirmSchema = z.object({
  informativeId: z.uuid("Informativo inválido."),
  decisions: z.array(decisionSchema).max(60).optional(),
});

export async function confirmInformativeDraft(input: {
  informativeId: string;
  decisions?: InformativeTaskDecision[];
}): Promise<ActionResult<{ taskIds: string[]; message: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const result = await confirmInformative(gate.actor, parsed.data.informativeId, {
    decisions: parsed.data.decisions,
  });

  if (!result.ok) return err(result.message);

  revalidatePath("/informativos");
  revalidatePath("/tasks");
  revalidatePath("/clans");
  revalidatePath("/mural");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { ok: true, data: { taskIds: result.taskIds, message: result.message } };
}

export async function cancelInformativeDraft(input: {
  informativeId: string;
}): Promise<ActionResult<{ message: string }>> {
  const gate = await requireInformativeActor();
  if (!gate.ok) return gate;

  const parsed = z
    .object({ informativeId: z.uuid("Informativo inválido.") })
    .safeParse(input);
  if (!parsed.success) return err("Informativo inválido.");

  const result = await cancelInformative(gate.actor, parsed.data.informativeId);
  if (!result.ok) return err(result.message);

  revalidatePath("/informativos");
  return { ok: true, data: { message: result.message } };
}
