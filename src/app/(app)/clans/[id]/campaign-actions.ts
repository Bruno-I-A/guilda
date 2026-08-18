"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { canDistributeClanTasks } from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { loadClanScopedFacts } from "@/lib/clans/facts";

/**
 * Campanhas mensais do clã — o trabalho grande e recorrente do mês.
 *
 * Esta etapa cria e conduz o guarda-chuva. A materialização das missões a
 * partir dos templates sobre a carteira é a etapa seguinte; até lá a campanha
 * serve para o clã declarar o que está em jogo no mês e em que pé está.
 */

const CAMPAIGN_STATUSES = ["planned", "active", "completed", "cancelled"] as const;

const createSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  name: z
    .string()
    .trim()
    .min(3, "Dê um nome de ao menos 3 caracteres à campanha.")
    .max(200, "Nome muito longo."),
  periodYear: z
    .number()
    .int("Ano inválido.")
    .min(2000, "Ano inválido.")
    .max(2100, "Ano inválido."),
  periodMonth: z
    .number()
    .int("Mês inválido.")
    .min(1, "Mês inválido.")
    .max(12, "Mês inválido."),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Prazo inválido.")
    .optional()
    .or(z.literal("")),
});

const statusSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  campaignId: z.uuid("Campanha inválida."),
  status: z.enum(CAMPAIGN_STATUSES),
});

function revalidateClanCampaigns(clanId: string): void {
  revalidatePath(`/clans/${clanId}`);
}

export async function createClanCampaign(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ id: string }>> => {
      const { clan, facts } = await loadClanScopedFacts(
        tx,
        ctx.orgId,
        data.clanId,
        ctx.userId,
        ctx.role,
      );
      if (!clan) return err("Clã não encontrado.");
      if (!clan.active) return err("Clã inativo não recebe campanha nova.");
      if (!canDistributeClanTasks(facts)) {
        return err("Apenas o líder deste clã ou um admin pode abrir campanha.");
      }

      const [existing] = await tx
        .select({ id: schema.clanCampaigns.id })
        .from(schema.clanCampaigns)
        .where(
          and(
            eq(schema.clanCampaigns.orgId, ctx.orgId),
            eq(schema.clanCampaigns.clanId, clan.id),
            eq(schema.clanCampaigns.periodYear, data.periodYear),
            eq(schema.clanCampaigns.periodMonth, data.periodMonth),
            eq(schema.clanCampaigns.name, data.name),
          ),
        )
        .limit(1);
      if (existing) {
        return err("Este clã já tem uma campanha com esse nome nesse mês.");
      }

      const [created] = await tx
        .insert(schema.clanCampaigns)
        .values({
          orgId: ctx.orgId,
          clanId: clan.id,
          name: data.name,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          dueDate: data.dueDate ? data.dueDate : null,
          createdBy: ctx.userId,
        })
        .returning({ id: schema.clanCampaigns.id });

      return { ok: true, data: { id: created.id } };
    },
  );

  if (result.ok) revalidateClanCampaigns(data.clanId);
  return result;
}

export async function setClanCampaignStatus(
  input: z.input<typeof statusSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const { clan, facts } = await loadClanScopedFacts(
      tx,
      ctx.orgId,
      data.clanId,
      ctx.userId,
      ctx.role,
    );
    if (!clan) return err("Clã não encontrado.");
    if (!canDistributeClanTasks(facts)) {
      return err("Apenas o líder deste clã ou um admin pode conduzir campanha.");
    }

    // A campanha é travada: dois cliques concorrentes serializam aqui em vez
    // de sobrescreverem a decisão um do outro.
    const [campaign] = await tx
      .select({ id: schema.clanCampaigns.id })
      .from(schema.clanCampaigns)
      .where(
        and(
          eq(schema.clanCampaigns.orgId, ctx.orgId),
          eq(schema.clanCampaigns.id, data.campaignId),
          eq(schema.clanCampaigns.clanId, clan.id),
        ),
      )
      .for("update");
    if (!campaign) return err("Campanha não encontrada neste clã.");

    await tx
      .update(schema.clanCampaigns)
      .set({ status: data.status, updatedAt: new Date() })
      .where(
        and(
          eq(schema.clanCampaigns.orgId, ctx.orgId),
          eq(schema.clanCampaigns.id, campaign.id),
        ),
      );
    return { ok: true };
  });

  if (result.ok) revalidateClanCampaigns(data.clanId);
  return result;
}
