"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { authorizePortfolioChange } from "@/domain/fiscal-portfolio";
import { canManageFiscalPortfolio } from "@/domain/guild-permissions";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { clanHasPortfolio } from "@/lib/clan-tabs";
import { isActiveClanMember, loadClanScopedFacts } from "@/lib/clans/facts";

/**
 * Server Actions da carteira fiscal — quem responde por qual empresa.
 *
 * Toda decisão de permissão sai de `canManageFiscalPortfolio` e toda regra de
 * mudança sai de `authorizePortfolioChange`, com os fatos carregados aqui do
 * banco. A interface não informa quem lidera nem quem é do clã.
 */

const assignSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  /** `null` devolve as empresas para a fila de "sem responsável". */
  userId: z.string().min(1, "Pessoa inválida.").nullable(),
  clientIds: z
    .array(z.uuid("Empresa inválida."))
    .min(1, "Escolha ao menos uma empresa.")
    .max(200, "Movimente no máximo 200 empresas por vez."),
  note: z.string().trim().max(300, "Observação muito longa.").optional(),
});

export interface PortfolioAssignSummary {
  moved: number;
  skipped: number;
}

export async function assignPortfolioClients(
  input: z.input<typeof assignSchema>,
): Promise<ActionResult<PortfolioAssignSummary>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;
  const clientIds = [...new Set(data.clientIds)];

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<PortfolioAssignSummary>> => {
      const { clan, facts } = await loadClanScopedFacts(
        tx,
        ctx.orgId,
        data.clanId,
        ctx.userId,
        ctx.role,
      );
      if (!clan) return err("Clã não encontrado.");
      if (!clanHasPortfolio(clan.slug)) {
        return err("Este clã não trabalha por carteira.");
      }
      if (!canManageFiscalPortfolio(facts)) {
        return err(
          "Apenas o líder deste clã ou um admin pode remanejar a carteira.",
        );
      }

      const targetIsActiveClanMember = data.userId
        ? await isActiveClanMember(tx, ctx.orgId, clan.id, data.userId)
        : false;
      if (data.userId && !targetIsActiveClanMember) {
        return err(
          "A carteira só pode ficar com quem é integrante ativo do clã Fiscal.",
        );
      }

      // Trava as empresas em ordem de id: duas pessoas remanejando ao mesmo
      // tempo serializam aqui em vez de sobrescreverem a decisão uma da outra,
      // e a ordem fixa evita deadlock entre lotes que se cruzam.
      const clients = await tx
        .select({
          id: schema.clients.id,
          name: schema.clients.name,
          active: schema.clients.active,
        })
        .from(schema.clients)
        .where(
          and(
            eq(schema.clients.orgId, ctx.orgId),
            inArray(schema.clients.id, clientIds),
          ),
        )
        .orderBy(asc(schema.clients.id))
        .for("update");

      if (clients.length === 0) {
        return err("Nenhuma das empresas informadas pertence a esta Guilda.");
      }

      const current = await tx
        .select({
          id: schema.fiscalPortfolios.id,
          clientId: schema.fiscalPortfolios.clientId,
          userId: schema.fiscalPortfolios.userId,
        })
        .from(schema.fiscalPortfolios)
        .where(
          and(
            eq(schema.fiscalPortfolios.orgId, ctx.orgId),
            inArray(
              schema.fiscalPortfolios.clientId,
              clients.map((client) => client.id),
            ),
          ),
        );
      const holderByClient = new Map(
        current.map((row) => [row.clientId, row.userId]),
      );

      // Empresas que a URL citou mas não existem na org entram como ignoradas.
      let skipped = clientIds.length - clients.length;
      const events: (typeof schema.fiscalPortfolioEvents.$inferInsert)[] = [];
      const now = new Date();

      for (const client of clients) {
        const currentHolderId = holderByClient.get(client.id) ?? null;
        const decision = authorizePortfolioChange({
          clientIsActive: client.active,
          currentHolderId,
          target: data.userId
            ? {
                userId: data.userId,
                isActiveClanMember: targetIsActiveClanMember,
              }
            : null,
        });
        if (!decision.allowed) {
          skipped += 1;
          continue;
        }

        if (data.userId) {
          await tx
            .insert(schema.fiscalPortfolios)
            .values({
              orgId: ctx.orgId,
              clientId: client.id,
              userId: data.userId,
              assignedBy: ctx.userId,
              notes: data.note ?? null,
            })
            .onConflictDoUpdate({
              target: [
                schema.fiscalPortfolios.orgId,
                schema.fiscalPortfolios.clientId,
              ],
              set: {
                userId: data.userId,
                assignedBy: ctx.userId,
                notes: data.note ?? null,
                updatedAt: now,
              },
            });
        } else {
          await tx
            .delete(schema.fiscalPortfolios)
            .where(
              and(
                eq(schema.fiscalPortfolios.orgId, ctx.orgId),
                eq(schema.fiscalPortfolios.clientId, client.id),
              ),
            );
        }

        events.push({
          orgId: ctx.orgId,
          clientId: client.id,
          fromUserId: currentHolderId,
          toUserId: data.userId,
          actorId: ctx.userId,
          note: data.note ?? null,
        });
      }

      if (events.length > 0) {
        await tx.insert(schema.fiscalPortfolioEvents).values(events);
      }

      return { ok: true, data: { moved: events.length, skipped } };
    },
  );

  if (result.ok) revalidatePath(`/clans/${data.clanId}`);
  return result;
}
