import "server-only";

import { and, eq } from "drizzle-orm";

import type { OrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

/**
 * Conclui uma missão como consequência de outro ato do sistema — hoje, o
 * Societário confirmando a conclusão de um Fluxo.
 *
 * A pessoa nunca clica "concluir" nessas missões: elas fecham sozinhas quando
 * o trabalho de verdade acontece. Missão que exige um segundo clique para dizer
 * "sim, terminei mesmo" é burocracia que ninguém faz, e o painel passa a mentir.
 *
 * Duas garantias:
 *
 * - **Idempotente.** Missão já concluída ou cancelada devolve `false` sem tocar
 *   em nada. O crédito de XP usa `onConflictDoNothing` sobre o índice parcial de
 *   `task_event_id`, então nem uma corrida credita duas vezes.
 * - **Sempre tem executor.** Se a missão caiu na fila do clã e ninguém assumiu,
 *   quem dispara a conclusão é registrado como executor — com linha em
 *   `task_transfers` e o evento da transição, preservando autoria e XP. Mesmo
 *   desenho de `quickCompleteUnassignedInformativeTask`.
 */
export async function completeTaskFromSystem(
  tx: OrgTx,
  input: {
    orgId: string;
    taskId: string;
    /** Quem provocou a conclusão; vira executor se a missão estiver sem dono. */
    actorId: string;
    note: string;
  },
): Promise<{ concluida: boolean; xpValue: number; executorId: string | null }> {
  const [task] = await tx
    .select()
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.orgId, input.orgId), eq(schema.tasks.id, input.taskId)),
    )
    .for("update");

  if (!task) return { concluida: false, xpValue: 0, executorId: null };
  if (task.status === "completed" || task.status === "cancelled") {
    return { concluida: false, xpValue: task.xpValue, executorId: task.assigneeId };
  }

  const agora = new Date();
  const executorId = task.assigneeId ?? input.actorId;
  const statusAnterior = task.status;

  // Sem dono: registra o executor antes de concluir, para o XP ter destinatário
  // e o histórico não mostrar uma missão que se concluiu sozinha do nada.
  if (!task.assigneeId) {
    // task_transfers exige clã de destino. Missão de Fluxo sempre tem um, mas o
    // schema permite missão sem clã — sem ele o repasse não é registrável, e o
    // evento da transição abaixo já preserva a autoria.
    if (task.clanId) {
      await tx.insert(schema.taskTransfers).values({
        orgId: input.orgId,
        taskId: task.id,
        actorId: input.actorId,
        fromAssigneeId: null,
        toAssigneeId: executorId,
        fromClanId: task.clanId,
        toClanId: task.clanId,
        note: input.note,
      });
    }
    await tx.insert(schema.taskEvents).values({
      orgId: input.orgId,
      taskId: task.id,
      actorId: input.actorId,
      fromStatus: statusAnterior,
      toStatus: "in_progress",
      note: input.note,
    });
  }

  await tx
    .update(schema.tasks)
    .set({
      assigneeId: executorId,
      status: "completed",
      completedAt: agora,
      updatedAt: agora,
    })
    .where(
      and(eq(schema.tasks.orgId, input.orgId), eq(schema.tasks.id, task.id)),
    );

  const [evento] = await tx
    .insert(schema.taskEvents)
    .values({
      orgId: input.orgId,
      taskId: task.id,
      actorId: input.actorId,
      fromStatus: task.assigneeId ? statusAnterior : "in_progress",
      toStatus: "completed",
      note: input.note,
    })
    .returning({ id: schema.taskEvents.id });

  // XP na MESMA transação da transição — regra inegociável nº 1 do projeto.
  await tx
    .insert(schema.xpLedger)
    .values({
      orgId: input.orgId,
      userId: executorId,
      taskId: task.id,
      taskEventId: evento.id,
      amount: task.xpValue, // congelado na criação; nunca vem do cliente
      reason: "task_completed",
    })
    .onConflictDoNothing();

  return { concluida: true, xpValue: task.xpValue, executorId };
}
