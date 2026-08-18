"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import { isTransferableTaskStatus } from "@/domain/clans";
import { canDistributeClanTasks } from "@/domain/guild-permissions";
import {
  isActiveClanMember,
  loadClanScopedFacts,
} from "@/lib/clans/facts";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";

/**
 * Server Actions da Mesa do Líder — a distribuição das missões do clã.
 *
 * Toda decisão de permissão sai de `canDistributeClanTasks`, com os fatos
 * (papel na organização, liderança DESTE clã ativo) carregados aqui do banco.
 * A interface nunca informa quem é líder.
 */

const assignSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  assigneeId: z.string().min(1, "Escolha a pessoa responsável."),
  taskIds: z
    .array(z.uuid("Missão inválida."))
    .min(1, "Escolha ao menos uma missão.")
    .max(50, "Distribua no máximo 50 missões por vez."),
});

/**
 * Atribui em lote missões do clã que ainda não têm responsável.
 *
 * Cada missão é travada com FOR UPDATE e revalidada individualmente: duas
 * pessoas distribuindo ao mesmo tempo serializam aqui, e a segunda encontra
 * a missão já atribuída em vez de sobrescrever a decisão da primeira.
 */
export async function assignClanTasks(input: {
  clanId: string;
  assigneeId: string;
  taskIds: string[];
}): Promise<ActionResult<{ assigned: number; skipped: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ assigned: number; skipped: number }>> => {
      const { clan, facts } = await loadClanScopedFacts(
        tx,
        ctx.orgId,
        data.clanId,
        ctx.userId,
        ctx.role,
      );
      if (!clan) return err("Clã não encontrado.");
      if (!clan.active) return err("Este clã está inativo.");
      if (!canDistributeClanTasks(facts)) {
        return err("Apenas o líder deste clã ou um admin pode distribuir as missões.");
      }

      await lockActiveClansForMembershipRead(tx, ctx.orgId);
      if (!(await isActiveClanMember(tx, ctx.orgId, data.clanId, data.assigneeId))) {
        return err("A pessoa escolhida precisa ser integrante ativa deste clã.");
      }

      const tasks = await tx
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.orgId, ctx.orgId),
            eq(schema.tasks.clanId, data.clanId),
            inArray(schema.tasks.id, data.taskIds),
          ),
        )
        .for("update");

      let assigned = 0;
      const now = new Date();

      for (const task of tasks) {
        // Distribuir é dar dono a missão órfã. Trocar responsável de missão
        // que já tem dono é transferência — passa por `transferTask`.
        if (task.assigneeId) continue;
        if (!isTransferableTaskStatus(task.status)) continue;

        await tx
          .update(schema.tasks)
          .set({ assigneeId: data.assigneeId, updatedAt: now })
          .where(
            and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, ctx.orgId)),
          );

        await tx.insert(schema.taskTransfers).values({
          orgId: ctx.orgId,
          taskId: task.id,
          actorId: ctx.userId,
          fromAssigneeId: null,
          toAssigneeId: data.assigneeId,
          fromClanId: task.clanId,
          toClanId: data.clanId,
        });

        assigned += 1;
      }

      return {
        ok: true,
        data: { assigned, skipped: data.taskIds.length - assigned },
      };
    },
  );

  if (result.ok) {
    revalidatePath(`/clans/${data.clanId}`);
    revalidatePath("/clans");
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
  }
  return result;
}

const acceptSchema = z.object({
  clanId: z.uuid("Clã inválido."),
  informativeId: z.uuid("Informativo inválido.").optional(),
});

/**
 * Aceita de uma vez as sugestões que o informativo trouxe.
 *
 * Só entra missão órfã cuja sugestão seja ÚNICA e reconhecida (um único
 * `user_id` não nulo) e cuja pessoa ainda seja integrante ativa do clã.
 * "Att. Carol/Jenifer" tem duas sugestões: fica de fora, porque escolher
 * entre as duas é exatamente a decisão que cabe ao líder.
 */
export async function acceptClanSuggestions(input: {
  clanId: string;
  informativeId?: string;
}): Promise<ActionResult<{ assigned: number; ambiguous: number }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ assigned: number; ambiguous: number }>> => {
      const { clan, facts } = await loadClanScopedFacts(
        tx,
        ctx.orgId,
        data.clanId,
        ctx.userId,
        ctx.role,
      );
      if (!clan) return err("Clã não encontrado.");
      if (!clan.active) return err("Este clã está inativo.");
      if (!canDistributeClanTasks(facts)) {
        return err("Apenas o líder deste clã ou um admin pode distribuir as missões.");
      }

      await lockActiveClansForMembershipRead(tx, ctx.orgId);

      const orphanFilters = [
        eq(schema.tasks.orgId, ctx.orgId),
        eq(schema.tasks.clanId, data.clanId),
        isNull(schema.tasks.assigneeId),
      ];
      if (data.informativeId) {
        orphanFilters.push(eq(schema.tasks.informativeId, data.informativeId));
      }

      const orphans = await tx
        .select()
        .from(schema.tasks)
        .where(and(...orphanFilters))
        .for("update");

      if (orphans.length === 0) {
        return { ok: true, data: { assigned: 0, ambiguous: 0 } };
      }

      const suggestions = await tx
        .select({
          taskId: schema.taskAssigneeSuggestions.taskId,
          userId: schema.taskAssigneeSuggestions.userId,
        })
        .from(schema.taskAssigneeSuggestions)
        .where(
          and(
            eq(schema.taskAssigneeSuggestions.orgId, ctx.orgId),
            inArray(
              schema.taskAssigneeSuggestions.taskId,
              orphans.map((task) => task.id),
            ),
          ),
        );

      const byTask = new Map<string, Set<string>>();
      for (const suggestion of suggestions) {
        if (!suggestion.userId) continue;
        const current = byTask.get(suggestion.taskId) ?? new Set<string>();
        current.add(suggestion.userId);
        byTask.set(suggestion.taskId, current);
      }

      const eligibility = new Map<string, boolean>();
      let assigned = 0;
      let ambiguous = 0;
      const now = new Date();

      for (const task of orphans) {
        if (!isTransferableTaskStatus(task.status)) continue;

        const candidates = byTask.get(task.id);
        if (!candidates || candidates.size === 0) continue;
        if (candidates.size > 1) {
          ambiguous += 1;
          continue;
        }

        const [assigneeId] = [...candidates];
        let eligible = eligibility.get(assigneeId);
        if (eligible === undefined) {
          eligible = await isActiveClanMember(
            tx,
            ctx.orgId,
            data.clanId,
            assigneeId,
          );
          eligibility.set(assigneeId, eligible);
        }
        if (!eligible) {
          ambiguous += 1;
          continue;
        }

        await tx
          .update(schema.tasks)
          .set({ assigneeId, updatedAt: now })
          .where(
            and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, ctx.orgId)),
          );

        await tx.insert(schema.taskTransfers).values({
          orgId: ctx.orgId,
          taskId: task.id,
          actorId: ctx.userId,
          fromAssigneeId: null,
          toAssigneeId: assigneeId,
          fromClanId: task.clanId,
          toClanId: data.clanId,
        });

        assigned += 1;
      }

      return { ok: true, data: { assigned, ambiguous } };
    },
  );

  if (result.ok) {
    revalidatePath(`/clans/${data.clanId}`);
    revalidatePath("/clans");
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
  }
  return result;
}
