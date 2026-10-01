"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { CHALLENGE_RULE_LIMITS } from "@/domain/closing-challenge";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import {
  abandonChallenge,
  releaseChallenge,
  rollChallenge,
} from "@/lib/closings/challenge-commands";
import { requireClosingLeadership, requireClosingManager } from "@/lib/closings/gate";

/**
 * Ações do Desafio do dado na aba: autorização e revalidação. A regra do jogo
 * (sorteio no servidor, travas, desistência) mora em
 * `@/lib/closings/challenge-commands`, a mesma usada pelas ferramentas do MCP.
 *
 * O desfecho (fechou, travou, foi fechada por outra pessoa) também não mora
 * aqui: é decidido pelo sync que a porta única de escrita chama
 * (`@/lib/closings/period-writes`).
 */

const clanIdField = { clanId: z.uuid("Clã inválido.") };
const LIDERANCA = "Apenas a liderança da Contabilidade ou um admin pode fazer isso.";

const rollSchema = z.object({
  ...clanIdField,
  year: z.number().int().min(2000).max(2100),
  group: z.enum(["mei", "simples", "presumido_association", "real"]),
});

type RolledView = { id: string; clientId: string; clientName: string };

export async function rollClosingChallenge(
  input: z.input<typeof rollSchema>,
): Promise<ActionResult<RolledView>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = rollSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult<RolledView>> => {
    const gate = await requireClosingManager(tx, ctx, data.clanId);
    if (!gate.ok) return gate;
    const rolled = await rollChallenge(tx, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      year: data.year,
      group: data.group,
    });
    if (!rolled.ok) return err(rolled.error);
    const { id, clientId, clientName } = rolled.challenge;
    return { ok: true, data: { id, clientId, clientName } };
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}

const endSchema = z.object({ ...clanIdField, challengeId: z.uuid("Desafio inválido.") });

export async function abandonClosingChallenge(
  input: z.input<typeof endSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireClosingManager(tx, ctx, parsed.data.clanId);
    if (!gate.ok) return gate;
    const ended = await abandonChallenge(tx, {
      orgId: ctx.orgId,
      challengeId: parsed.data.challengeId,
      userId: ctx.userId,
    });
    if (!ended) return err("Este desafio não está mais em andamento.");
    return { ok: true };
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}

/** A liderança libera a reserva de outra pessoa — vira desistência, sem XP. */
export async function releaseClosingChallenge(
  input: z.input<typeof endSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireClosingLeadership(tx, ctx, parsed.data.clanId, LIDERANCA);
    if (!gate.ok) return gate;
    const ended = await releaseChallenge(tx, {
      orgId: ctx.orgId,
      challengeId: parsed.data.challengeId,
      releasedBy: ctx.userId,
    });
    if (!ended) return err("Este desafio não está mais em andamento.");
    return { ok: true };
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}

function ruleField(key: keyof typeof CHALLENGE_RULE_LIMITS, label: string) {
  const { min, max } = CHALLENGE_RULE_LIMITS[key];
  return z
    .number(`${label}: informe um número.`)
    .int(`${label}: use um número inteiro.`)
    .min(min, `${label}: o mínimo é ${min}.`)
    .max(max, `${label}: o máximo é ${max}.`);
}

const settingsSchema = z.object({
  ...clanIdField,
  timeLimitMinutes: ruleField("timeLimitMinutes", "Prazo"),
  baseXp: ruleField("baseXp", "XP ao fechar"),
  bonusXp: ruleField("bonusXp", "Bônus no prazo"),
  dailyPaidCap: ruleField("dailyPaidCap", "Desafios pagos por dia"),
});

export async function updateClosingChallengeSettings(
  input: z.input<typeof settingsSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Regras inválidas.");
  }
  const { clanId, ...rules } = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const gate = await requireClosingLeadership(tx, ctx, clanId, LIDERANCA);
    if (!gate.ok) return gate;
    const now = new Date();
    await tx
      .insert(schema.closingChallengeSettings)
      .values({ orgId: ctx.orgId, ...rules, updatedBy: ctx.userId, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.closingChallengeSettings.orgId,
        set: { ...rules, updatedBy: ctx.userId, updatedAt: now },
      });
    return { ok: true };
  });

  if (result.ok) revalidatePath("/clans/[id]", "page");
  return result;
}
