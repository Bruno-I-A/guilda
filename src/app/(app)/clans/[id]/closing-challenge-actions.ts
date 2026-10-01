"use server";

import { randomInt } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { CHALLENGE_RULE_LIMITS, challengeDeadline } from "@/domain/closing-challenge";
import { pickClosingDraw } from "@/domain/closing-draw";
import { err, requireMemberContext, type ActionResult } from "@/lib/action-context";
import { loadChallengePool } from "@/lib/closings/challenge-pool";
import { loadChallengeRules } from "@/lib/closings/challenge-rules";
import { requireClosingLeadership, requireClosingManager } from "@/lib/closings/gate";

/**
 * Ações do Desafio do dado. O sorteio é do servidor: se o navegador mandasse
 * a empresa, daria para escolher a fácil. As travas (um desafio por pessoa,
 * uma pessoa por empresa) são índices únicos parciais — clique duplo e duas
 * pessoas sorteando ao mesmo tempo batem no banco, não em sorte.
 *
 * O desfecho (fechou, travou, foi fechada por outra pessoa) não mora aqui: é
 * decidido pelo sync que a porta única de escrita chama
 * (`@/lib/closings/period-writes`).
 */

const clanIdField = { clanId: z.uuid("Clã inválido.") };
const LIDERANCA = "Apenas a liderança da Contabilidade ou um admin pode fazer isso.";

const rollSchema = z.object({
  ...clanIdField,
  year: z.number().int().min(2000).max(2100),
  group: z.enum(["mei", "simples", "presumido_association", "real"]),
});

type RolledChallenge = { id: string; clientId: string; clientName: string };

async function activeChallengeOf(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<RolledChallenge | null> {
  const [row] = await tx
    .select({
      id: schema.closingChallenges.id,
      clientId: schema.closingChallenges.clientId,
      clientName: schema.clients.name,
    })
    .from(schema.closingChallenges)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.closingChallenges.clientId))
    .where(
      and(
        eq(schema.closingChallenges.orgId, orgId),
        eq(schema.closingChallenges.userId, userId),
        eq(schema.closingChallenges.status, "active"),
      ),
    );
  return row ?? null;
}

export async function rollClosingChallenge(
  input: z.input<typeof rollSchema>,
): Promise<ActionResult<RolledChallenge>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;
  const parsed = rollSchema.safeParse(input);
  if (!parsed.success) return err("Dados inválidos.");
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<RolledChallenge>> => {
      const gate = await requireClosingManager(tx, ctx, data.clanId);
      if (!gate.ok) return gate;

      // Rolar com desafio em andamento devolve o que já existe: é o clique
      // duplo, ou outra aba aberta.
      const existing = await activeChallengeOf(tx, ctx.orgId, ctx.userId);
      if (existing) return { ok: true, data: existing };

      const rules = await loadChallengeRules(tx, ctx.orgId);
      let pool = await loadChallengePool(tx, {
        orgId: ctx.orgId,
        year: data.year,
        group: data.group,
      });

      // Quem desistiu e rola de novo não recebe a mesma empresa, se houver outra.
      const [last] = await tx
        .select({
          clientId: schema.closingChallenges.clientId,
          status: schema.closingChallenges.status,
        })
        .from(schema.closingChallenges)
        .where(
          and(
            eq(schema.closingChallenges.orgId, ctx.orgId),
            eq(schema.closingChallenges.userId, ctx.userId),
          ),
        )
        .orderBy(desc(schema.closingChallenges.startedAt))
        .limit(1);
      const previousId = last?.status === "abandoned" ? last.clientId : null;

      for (let tentativa = 0; tentativa < 3; tentativa += 1) {
        const pick = pickClosingDraw(pool, previousId, () => randomInt(1_000_000) / 1_000_000);
        if (!pick) return err(`Nenhuma empresa livre para sortear em ${data.year}.`);

        const startedAt = new Date();
        const [created] = await tx
          .insert(schema.closingChallenges)
          .values({
            orgId: ctx.orgId,
            userId: ctx.userId,
            clientId: pick.id,
            year: data.year,
            startedAt,
            deadlineAt: challengeDeadline(startedAt, rules.timeLimitMinutes),
            timeLimitMinutes: rules.timeLimitMinutes,
            baseXp: rules.baseXp,
            bonusXp: rules.bonusXp,
          })
          .onConflictDoNothing()
          .returning({ id: schema.closingChallenges.id });
        if (created) {
          return {
            ok: true,
            data: { id: created.id, clientId: pick.id, clientName: pick.name },
          };
        }
        // Conflito: ou outra aba desta pessoa rolou agora, ou outra pessoa
        // reservou esta empresa no mesmo instante.
        const mine = await activeChallengeOf(tx, ctx.orgId, ctx.userId);
        if (mine) return { ok: true, data: mine };
        pool = pool.filter((company) => company.id !== pick.id);
      }
      return err("Não consegui reservar uma empresa agora. Tente rolar de novo.");
    },
  );

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
    const [ended] = await tx
      .update(schema.closingChallenges)
      .set({ status: "abandoned", endedAt: new Date(), endedBy: ctx.userId })
      .where(
        and(
          eq(schema.closingChallenges.orgId, ctx.orgId),
          eq(schema.closingChallenges.id, parsed.data.challengeId),
          eq(schema.closingChallenges.userId, ctx.userId),
          eq(schema.closingChallenges.status, "active"),
        ),
      )
      .returning({ id: schema.closingChallenges.id });
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
    const [ended] = await tx
      .update(schema.closingChallenges)
      .set({ status: "abandoned", endedAt: new Date(), endedBy: ctx.userId })
      .where(
        and(
          eq(schema.closingChallenges.orgId, ctx.orgId),
          eq(schema.closingChallenges.id, parsed.data.challengeId),
          eq(schema.closingChallenges.status, "active"),
        ),
      )
      .returning({ id: schema.closingChallenges.id });
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
