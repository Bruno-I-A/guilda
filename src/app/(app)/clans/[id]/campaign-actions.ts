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
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { FISCAL_CLAN_SLUG } from "@/lib/clans/rules";
import { materializeFiscalControl } from "@/lib/fiscal/materialize";

/**
 * Campanhas mensais do clã — o trabalho grande e recorrente do mês.
 *
 * No Fiscal, a campanha pode materializar o controle da competência na mesma
 * transação, sem gerar uma missão para cada célula. Missões ficam reservadas
 * às exceções; nos demais clãs a campanha segue como guarda-chuva mensal.
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
  openFiscalControl: z.boolean().optional().default(false),
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
): Promise<ActionResult<{ id: string; fiscalControlCreated: number; fiscalControlConflicts: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ id: string; fiscalControlCreated: number; fiscalControlConflicts: number }>> => {
      await lockActiveClansForMembershipRead(tx, ctx.orgId);
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
        return err("Apenas integrantes deste clã ou um admin podem abrir campanha.");
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
        .onConflictDoNothing({
          target: [
            schema.clanCampaigns.orgId,
            schema.clanCampaigns.clanId,
            schema.clanCampaigns.periodYear,
            schema.clanCampaigns.periodMonth,
            schema.clanCampaigns.name,
          ],
        })
        .returning({ id: schema.clanCampaigns.id });
      if (!created) {
        return err("Este clã já tem uma campanha com esse nome nesse mês.");
      }

      const fiscalControl =
        clan.slug === FISCAL_CLAN_SLUG && data.openFiscalControl
          ? await materializeFiscalControl(tx, {
              orgId: ctx.orgId,
              actorId: ctx.userId,
              periodYear: data.periodYear,
              periodMonth: data.periodMonth,
              campaignId: created.id,
            })
          : { created: 0, existing: 0, synchronized: 0, campaignConflicts: 0 };

      return {
        ok: true,
        data: {
          id: created.id,
          fiscalControlCreated: fiscalControl.created,
          fiscalControlConflicts: fiscalControl.campaignConflicts,
        },
      };
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
    await lockActiveClansForMembershipRead(tx, ctx.orgId);
    const { clan, facts } = await loadClanScopedFacts(
      tx,
      ctx.orgId,
      data.clanId,
      ctx.userId,
      ctx.role,
    );
    if (!clan) return err("Clã não encontrado.");
    if (!canDistributeClanTasks(facts)) {
      return err("Apenas integrantes deste clã ou um admin podem conduzir campanha.");
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
