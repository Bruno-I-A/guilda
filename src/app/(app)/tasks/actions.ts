"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type OrgTx, withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  authorizeTaskTransfer,
  resolveAssigneeClan,
} from "@/domain/clans";
import {
  authorizeTaskDeletion,
  authorizeTransition,
  type TaskStatus,
} from "@/domain/task-state";
import {
  err,
  requireMemberContext,
  type ActionResult,
} from "@/lib/action-context";
import { syncClosingFromTask } from "@/lib/closings/task-sync";
import { lockActiveClansForMembershipRead } from "@/lib/clans/locks";
import { createTaskRecord } from "@/lib/tasks/create";
import { encodeTaskCallback } from "@/lib/telegram/endpoint";
import {
  enqueueTelegramNotificationIfEnabled,
  notificationPayload,
} from "@/lib/telegram/notifications";
import { taskUrl } from "@/lib/telegram/notification-payload";

/**
 * Server Actions de tarefas.
 * Regras inegociáveis aplicadas aqui:
 * - validação Zod de TODO input externo;
 * - verificação de sessão + papel em CADA action (nunca confiar na UI);
 * - todo cálculo de XP no servidor (xp_value congelado na criação);
 * - toda query dentro de withOrgTx (RLS) E filtrando org_id explicitamente;
 * - transições de status validadas pela máquina de estados no servidor.
 */


/** 'YYYY-MM-DD' → Date ao meio-dia UTC (evita virada de dia por fuso). */
function dueDateFromInput(value: string | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`);
}

const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .optional()
  .or(z.literal("").transform(() => undefined));

const createTaskFields = {
  title: z.string().trim().min(3, "Título muito curto.").max(200, "Título muito longo."),
  description: z
    .string()
    .trim()
    .max(5000, "Descrição muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  priority: z.coerce.number().int().min(1).max(3),
  difficulty: z.coerce.number().int().min(1).max(5),
  dueDate: dueDateSchema,
};

const createTaskSchema = z.discriminatedUnion("assignmentType", [
  z.object({
    ...createTaskFields,
    assignmentType: z.literal("individual"),
    assigneeId: z.string().min(1, "Escolha a pessoa responsável."),
  }),
  z.object({
    ...createTaskFields,
    assignmentType: z.literal("clan"),
    clanId: z.uuid("Escolha um clã válido."),
  }),
]);

async function activeClanMembershipsForUser(
  tx: OrgTx,
  orgId: string,
  userId: string,
): Promise<Array<{ clanId: string; isPrimary: boolean }>> {
  await lockActiveClansForMembershipRead(tx, orgId);
  return tx
    .select({
      clanId: schema.clanMemberships.clanId,
      isPrimary: schema.clanMemberships.isPrimary,
    })
    .from(schema.clanMemberships)
    .innerJoin(
      schema.clans,
      and(
        eq(schema.clans.id, schema.clanMemberships.clanId),
        eq(schema.clans.orgId, schema.clanMemberships.orgId),
      ),
    )
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.userId, schema.clanMemberships.userId),
        eq(schema.member.organizationId, schema.clanMemberships.orgId),
      ),
    )
    .where(
      and(
        eq(schema.clanMemberships.orgId, orgId),
        eq(schema.clanMemberships.userId, userId),
        eq(schema.clans.orgId, orgId),
        eq(schema.clans.active, true),
        eq(schema.member.organizationId, orgId),
        eq(schema.member.userId, userId),
      ),
    );
}

export async function createTask(
  input: z.input<typeof createTaskSchema>,
): Promise<ActionResult<{ taskId: string }>> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(
    ctx.orgId,
    async (tx): Promise<ActionResult<{ taskId: string }>> => {
      let assigneeId: string | null = null;
      let clanId: string;

      if (data.assignmentType === "individual") {
        // A identidade do clã nunca vem da UI na criação individual.
        const [assigneeMembership] = await tx
          .select({ userId: schema.member.userId })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.userId, data.assigneeId),
              eq(schema.member.organizationId, ctx.orgId),
            ),
          )
          .limit(1);
        if (!assigneeMembership) {
          return err(
            "A pessoa responsável precisa ser membro da organização.",
          );
        }

        const memberships = await activeClanMembershipsForUser(
          tx,
          ctx.orgId,
          data.assigneeId,
        );
        const resolution = resolveAssigneeClan(memberships);
        if (!resolution.ok) return err(resolution.reason);

        assigneeId = data.assigneeId;
        clanId = resolution.clanId;
      } else {
        const [clan] = await tx
          .select({ id: schema.clans.id })
          .from(schema.clans)
          .where(
            and(
              eq(schema.clans.id, data.clanId),
              eq(schema.clans.orgId, ctx.orgId),
              eq(schema.clans.active, true),
            ),
          )
          .limit(1);
        if (!clan) return err("Clã ativo não encontrado.");
        clanId = clan.id;
      }

      const task = await createTaskRecord(tx, {
        orgId: ctx.orgId,
        creatorId: ctx.userId,
        assigneeId,
        clanId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        difficulty: data.difficulty,
        dueDate: dueDateFromInput(data.dueDate),
      });
      return { ok: true, data: { taskId: task.id } };
    },
  );

  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    revalidatePath("/clans");
  }
  return result;
}

const updateTaskSchema = z.object({
  taskId: z.uuid(),
  title: z.string().trim().min(3, "Título muito curto.").max(200, "Título muito longo."),
  description: z
    .string()
    .trim()
    .max(5000, "Descrição muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  dueDate: dueDateSchema,
});

/**
 * Edita título/descrição/prazo. Dificuldade e prioridade são IMUTÁVEIS
 * após a criação (xp_value é congelado — regra de negócio).
 */
export async function updateTask(
  input: z.input<typeof updateTaskSchema>,
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, data.taskId), eq(schema.tasks.orgId, ctx.orgId)))
      .for("update");

    if (!task) return err("Missão não encontrada.");

    const isAdmin = ctx.role === "admin" || ctx.role === "owner";
    if (task.creatorId !== ctx.userId && !isAdmin) {
      return err("Apenas quem criou a missão ou um admin pode editá-la.");
    }
    const editableStatuses: TaskStatus[] = ["pending", "in_progress", "rejected"];
    if (!editableStatuses.includes(task.status)) {
      return err("Missões em aprovação, concluídas ou canceladas não podem ser editadas.");
    }

    await tx
      .update(schema.tasks)
      .set({
        title: data.title,
        description: data.description ?? null,
        dueDate: dueDateFromInput(data.dueDate),
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, ctx.orgId)),
      );

    return { ok: true };
  });

  if (result.ok) {
    revalidateTaskPaths(data.taskId);
  }
  return result;
}

type Tx = OrgTx;

/**
 * Núcleo compartilhado das transições de status.
 * `allowedFrom` declara a intenção da action (dupla validação: intenção
 * da action + máquina de estados + papel). `sideEffect` roda DENTRO da
 * mesma transação — é onde o crédito/estorno de XP acontece.
 */
async function transitionTask(options: {
  taskId: string;
  to: TaskStatus;
  allowedFrom: TaskStatus[];
  note?: string;
  sideEffect?: (tx: Tx, task: schema.Task, taskEventId: string) => Promise<void>;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const idParse = z.uuid().safeParse(options.taskId);
  if (!idParse.success) return err("Missão inválida.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    // Lock da linha: transições concorrentes serializam aqui e a segunda
    // falha na validação de estado (não há transição dupla).
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, idParse.data), eq(schema.tasks.orgId, ctx.orgId)))
      .for("update");

    if (!task) return err("Missão não encontrada.");
    if (!options.allowedFrom.includes(task.status)) {
      return err("A missão não está mais neste estado — atualize a página.");
    }
    if (options.to === "completed" && !task.assigneeId) {
      return err("A missão precisa ter uma pessoa responsável antes da conclusão.");
    }
    if (task.status === "completed" && options.to === "in_progress") {
      if (!task.assigneeId) {
        return err("A missão concluída não possui mais uma pessoa responsável.");
      }

      // Reativar a missão volta a impedir a remoção do responsável. O
      // mesmo mutex do trigger de DELETE fecha a janela entre validar o
      // vínculo e persistir o novo estado ativo.
      await lockActiveClansForMembershipRead(tx, ctx.orgId);
      const [activeMember] = await tx
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, ctx.orgId),
            eq(schema.member.userId, task.assigneeId),
          ),
        )
        .limit(1);
      if (!activeMember) {
        return err(
          "A pessoa responsável não pertence mais à organização. Transfira a missão antes de reativá-la.",
        );
      }

      if (task.clanId) {
        const [activeClanMembership] = await tx
          .select({ id: schema.clanMemberships.id })
          .from(schema.clanMemberships)
          .innerJoin(
            schema.clans,
            and(
              eq(schema.clans.orgId, schema.clanMemberships.orgId),
              eq(schema.clans.id, schema.clanMemberships.clanId),
            ),
          )
          .where(
            and(
              eq(schema.clanMemberships.orgId, ctx.orgId),
              eq(schema.clanMemberships.clanId, task.clanId),
              eq(schema.clanMemberships.userId, task.assigneeId),
              eq(schema.clans.orgId, ctx.orgId),
              eq(schema.clans.active, true),
            ),
          )
          .limit(1);
        if (!activeClanMembership) {
          return err(
            "A pessoa responsável não pertence mais ao clã ativo da missão. Transfira-a antes de reativá-la.",
          );
        }
      }
    }

    const decision = authorizeTransition(options.to, {
      actor: { id: ctx.userId, role: ctx.role },
      task: {
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        status: task.status,
      },
    });
    if (!decision.allowed) {
      return err(decision.reason);
    }

    const now = new Date();
    await tx
      .update(schema.tasks)
      .set({
        status: options.to,
        updatedAt: now,
        completedAt:
          options.to === "completed"
            ? now
            : task.status === "completed"
              ? null
              : task.completedAt,
      })
      .where(
        and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, ctx.orgId)),
      );

    const [event] = await tx
      .insert(schema.taskEvents)
      .values({
        orgId: ctx.orgId,
        taskId: task.id,
        actorId: ctx.userId,
        fromStatus: task.status,
        toStatus: options.to,
        note: options.note ?? null,
      })
      .returning({ id: schema.taskEvents.id });

    if (options.sideEffect) {
      await options.sideEffect(tx, task, event.id);
    }
    await syncClosingFromTask(tx, {
      task,
      fromStatus: task.status,
      toStatus: options.to,
      changedAt: now,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
    if (options.to === "awaiting_approval") {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: ctx.orgId,
        userId: task.creatorId,
        eventType: "task_awaiting_approval",
        dedupeKey: `task-event:${event.id}:awaiting`,
        payload: notificationPayload(
          "approvals",
          `🛡️ Missão aguardando aprovação\n\n${task.title}\nRecompensa: ${task.xpValue} XP`,
          [[
            { text: "Aprovar", callbackData: encodeTaskCallback("approve", task.id) },
            { text: "Abrir", url: taskUrl(task.id, baseUrl) },
          ]],
        ),
      });
    } else if (options.to === "completed" && task.assigneeId) {
      const completionEventType =
        task.status === "awaiting_approval" ? "task_approved" : "task_completed";
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: ctx.orgId,
        userId: task.assigneeId,
        eventType: completionEventType,
        dedupeKey: `task-event:${event.id}:completed`,
        payload: notificationPayload(
          "xp",
          `🏆 Missão concluída\n\n${task.title}\n+${task.xpValue} XP`,
          [[{ text: "Ver missão", url: taskUrl(task.id, baseUrl) }]],
        ),
      });
    } else if (options.to === "rejected" && task.assigneeId) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: ctx.orgId,
        userId: task.assigneeId,
        eventType: "task_rejected",
        dedupeKey: `task-event:${event.id}:rejected`,
        payload: notificationPayload(
          "approvals",
          `↩️ Missão devolvida para ajustes\n\n${task.title}\nMotivo: ${options.note ?? "Consulte a missão."}`,
          [[
            { text: "Retomar", callbackData: encodeTaskCallback("start", task.id) },
            { text: "Abrir", url: taskUrl(task.id, baseUrl) },
          ]],
        ),
      });
    }

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${options.taskId}`);
    revalidatePath("/dashboard");
    revalidatePath("/clans");
    revalidatePath("/clans/[id]", "page");
    revalidatePath("/profile");
    revalidatePath("/leaderboard");
  }
  return result;
}

const taskIdSchema = z.object({ taskId: z.uuid() });

function revalidateTaskPaths(taskId: string): void {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/dashboard");
  revalidatePath("/clans");
}

/** Membro ativo assume atomicamente uma missão pendente e sem responsável. */
export async function claimTask(input: {
  taskId: string;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Missão inválida.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, parsed.data.taskId),
          eq(schema.tasks.orgId, ctx.orgId),
        ),
      )
      .for("update");

    if (!task) return err("Missão não encontrada.");
    if (task.status !== "pending" || task.assigneeId) {
      return err(
        "Esta missão já foi assumida ou não está mais pendente. Atualize a página.",
      );
    }
    if (!task.clanId) {
      return err("Esta missão não está vinculada a um clã.");
    }
    await lockActiveClansForMembershipRead(tx, ctx.orgId);

    const [membership] = await tx
      .select({ id: schema.clanMemberships.id })
      .from(schema.clanMemberships)
      .innerJoin(
        schema.clans,
        and(
          eq(schema.clans.id, schema.clanMemberships.clanId),
          eq(schema.clans.orgId, schema.clanMemberships.orgId),
        ),
      )
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.userId, schema.clanMemberships.userId),
          eq(schema.member.organizationId, schema.clanMemberships.orgId),
        ),
      )
      .where(
        and(
          eq(schema.clanMemberships.orgId, ctx.orgId),
          eq(schema.clanMemberships.clanId, task.clanId),
          eq(schema.clanMemberships.userId, ctx.userId),
          eq(schema.clans.orgId, ctx.orgId),
          eq(schema.clans.active, true),
          eq(schema.member.organizationId, ctx.orgId),
          eq(schema.member.userId, ctx.userId),
        ),
      )
      .limit(1);
    if (!membership) {
      return err("Apenas um membro ativo deste clã pode assumir a missão.");
    }

    const now = new Date();
    await tx
      .update(schema.tasks)
      .set({ assigneeId: ctx.userId, updatedAt: now })
      .where(
        and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, ctx.orgId)),
      );
    await tx.insert(schema.taskTransfers).values({
      orgId: ctx.orgId,
      taskId: task.id,
      actorId: ctx.userId,
      fromAssigneeId: null,
      toAssigneeId: ctx.userId,
      fromClanId: task.clanId,
      toClanId: task.clanId,
    });

    return { ok: true };
  });

  if (result.ok) revalidateTaskPaths(parsed.data.taskId);
  return result;
}

const transferTaskSchema = z.object({
  taskId: z.uuid(),
  assigneeId: z.string().min(1, "Escolha a nova pessoa responsável."),
  clanId: z.uuid("Clã inválido.").optional(),
  note: z
    .string()
    .trim()
    .max(2000, "Nota muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/**
 * Transfere/atribui uma missão preservando seu status. O clã pode ser
 * omitido: nesse caso ele é inferido do cadastro da nova pessoa responsável.
 */
export async function transferTask(input: {
  taskId: string;
  assigneeId: string;
  clanId?: string;
  note?: string;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = transferTaskSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  const data = parsed.data;

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.id, data.taskId), eq(schema.tasks.orgId, ctx.orgId)),
      )
      .for("update");
    if (!task) return err("Missão não encontrada.");

    const destinationMemberships = await activeClanMembershipsForUser(
      tx,
      ctx.orgId,
      data.assigneeId,
    );
    const destination = resolveAssigneeClan(
      destinationMemberships,
      data.clanId,
    );
    if (!destination.ok) return err(destination.reason);

    let actorIsLeader = false;
    if (task.clanId) {
      const [leaderMembership] = await tx
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
            eq(schema.clanMemberships.orgId, ctx.orgId),
            eq(schema.clanMemberships.clanId, task.clanId),
            eq(schema.clanMemberships.userId, ctx.userId),
            eq(schema.clanMemberships.isLeader, true),
            eq(schema.clans.orgId, ctx.orgId),
            eq(schema.clans.active, true),
          ),
        )
        .limit(1);
      actorIsLeader = Boolean(leaderMembership);
    }

    const decision = authorizeTaskTransfer({
      actor: { id: ctx.userId, role: ctx.role },
      task: {
        assigneeId: task.assigneeId,
        clanId: task.clanId,
        status: task.status,
      },
      destination: {
        assigneeId: data.assigneeId,
        clanId: destination.clanId,
        assigneeIsActiveMember: true,
      },
      actorIsActiveLeaderOfTaskClan: actorIsLeader,
    });
    if (!decision.allowed) return err(decision.reason);

    const now = new Date();
    await tx
      .update(schema.tasks)
      .set({
        assigneeId: data.assigneeId,
        clanId: destination.clanId,
        updatedAt: now,
      })
      .where(
        and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, ctx.orgId)),
      );
    const [transfer] = await tx
      .insert(schema.taskTransfers)
      .values({
        orgId: ctx.orgId,
        taskId: task.id,
        actorId: ctx.userId,
        fromAssigneeId: task.assigneeId,
        toAssigneeId: data.assigneeId,
        fromClanId: task.clanId,
        toClanId: destination.clanId,
        note: data.note ?? null,
      })
      .returning({ id: schema.taskTransfers.id });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
    if (data.assigneeId !== ctx.userId) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: ctx.orgId,
        userId: data.assigneeId,
        eventType: "task_transferred_in",
        dedupeKey: `task-transfer:${transfer.id}:incoming`,
        payload: notificationPayload(
          "tasks",
          `⚔️ Missão atribuída a você\n\n${task.title}`,
          [[
            {
              text: "Abrir na Guilda",
              url: taskUrl(task.id, baseUrl),
            },
          ]],
        ),
      });
    }
    if (
      task.assigneeId &&
      task.assigneeId !== data.assigneeId &&
      task.assigneeId !== ctx.userId
    ) {
      await enqueueTelegramNotificationIfEnabled(tx, {
        orgId: ctx.orgId,
        userId: task.assigneeId,
        eventType: "task_transferred_out",
        dedupeKey: `task-transfer:${transfer.id}:outgoing`,
        payload: notificationPayload(
          "tasks",
          `🔄 Missão transferida para outra pessoa\n\n${task.title}`,
          [[
            {
              text: "Ver missão",
              url: taskUrl(task.id, baseUrl),
            },
          ]],
        ),
      });
    }

    return { ok: true };
  });

  if (result.ok) revalidateTaskPaths(data.taskId);
  return result;
}

/** Responsável inicia (pending) ou retoma após rejeição (rejected). */
export async function startTask(input: { taskId: string }): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Missão inválida.");
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "in_progress",
    allowedFrom: ["pending", "rejected"],
  });
}

/** @deprecated Consumidores antigos agora concluem diretamente. */
export async function submitTask(input: { taskId: string }): Promise<ActionResult> {
  return completeTask(input);
}

/**
 * Crédito de XP da conclusão — SEMPRE na mesma transação da transição.
 * Idempotente por evento: o índice parcial de task_event_id impede repetir a
 * mesma transição, mas permite creditar uma reconclusão depois de reversão.
 */
async function creditTaskXp(
  tx: Tx,
  task: schema.Task,
  taskEventId: string,
): Promise<void> {
  if (!task.assigneeId) {
    throw new Error("Invariante violada: missão concluída sem responsável.");
  }
  await tx
    .insert(schema.xpLedger)
    .values({
      orgId: task.orgId,
      userId: task.assigneeId,
      taskId: task.id,
      taskEventId,
      amount: task.xpValue, // congelado na criação — nunca vem do cliente
      reason: "task_completed",
    })
    .onConflictDoNothing();
}

/** Aprova uma entrega legada que já esteja em awaiting_approval. */
export async function approveTask(input: { taskId: string }): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Missão inválida.");
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "completed",
    allowedFrom: ["awaiting_approval"],
    sideEffect: creditTaskXp,
  });
}

/** Responsável conclui diretamente uma missão em andamento. */
export async function completeTask(input: {
  taskId: string;
}): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Missão inválida.");
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "completed",
    allowedFrom: ["in_progress"],
    sideEffect: creditTaskXp,
  });
}

/** @deprecated Compatibilidade temporária com consumidores anteriores. */
export async function completeOwnTask(input: {
  taskId: string;
}): Promise<ActionResult> {
  return completeTask(input);
}

const revertSchema = z.object({
  taskId: z.uuid(),
  note: z
    .string()
    .trim()
    .max(2000, "Nota muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/**
 * Admin/owner reverte uma conclusão: a tarefa volta a in_progress e o
 * estorno entra como NOVO lançamento negativo (reason 'reversal') —
 * o crédito original nunca é apagado. Cada evento de reversão é idempotente.
 */
export async function revertCompletion(input: {
  taskId: string;
  note?: string;
}): Promise<ActionResult> {
  const parsed = revertSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "in_progress",
    allowedFrom: ["completed"],
    note: parsed.data.note,
    sideEffect: async (tx, task, taskEventId) => {
      if (!task.assigneeId) {
        throw new Error("Invariante violada: missão concluída sem responsável.");
      }
      await tx
        .insert(schema.xpLedger)
        .values({
          orgId: task.orgId,
          userId: task.assigneeId,
          taskId: task.id,
          taskEventId,
          amount: -task.xpValue,
          reason: "reversal",
        })
        .onConflictDoNothing();
    },
  });
}

const rejectSchema = z.object({
  taskId: z.uuid(),
  note: z
    .string()
    .trim()
    .min(3, "Explique o motivo da rejeição.")
    .max(2000, "Nota muito longa."),
});

/** Rejeição SEMPRE com nota — o responsável precisa saber o que ajustar. */
export async function rejectTask(input: {
  taskId: string;
  note: string;
}): Promise<ActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "rejected",
    allowedFrom: ["awaiting_approval"],
    note: parsed.data.note,
  });
}

const cancelSchema = z.object({
  taskId: z.uuid(),
  note: z
    .string()
    .trim()
    .max(2000, "Nota muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** Criador ou admin cancela (estado terminal). */
export async function cancelTask(input: {
  taskId: string;
  note?: string;
}): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "cancelled",
    allowedFrom: ["pending", "in_progress", "awaiting_approval", "rejected"],
    note: parsed.data.note,
  });
}

const deleteTaskSchema = z.object({ taskId: z.uuid() });

/**
 * Exclusão física — diferente de cancelar, que arquiva mantendo o
 * histórico. Só é permitida para missão que NUNCA foi concluída e NUNCA
 * mudou de mãos (`authorizeTaskDeletion`): uma missão concluída sempre
 * deixa lançamento em `xp_ledger`, e `task_transfers` é INSERT-only para o
 * role da aplicação (UPDATE/DELETE revogados na migration 0022) — não há
 * como apagar a linha de transferência, então a missão com esse histórico
 * também não pode ser apagada.
 *
 * `task_events` não tem cascade de propósito — é apagado aqui, dentro da
 * mesma transação, antes da linha da missão. `task_assignee_suggestions`
 * tem `onDelete: cascade` e cuida de si mesma.
 */
export async function deleteTask(input: {
  taskId: string;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const parsed = deleteTaskSchema.safeParse(input);
  if (!parsed.success) return err("Missão inválida.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    // Lock da linha: uma conclusão concorrente perde a corrida contra a
    // exclusão, ou a exclusão perde contra a conclusão — nunca as duas juntas.
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, parsed.data.taskId), eq(schema.tasks.orgId, ctx.orgId)))
      .for("update");
    if (!task) return err("Missão não encontrada.");

    const [completedEvent] = await tx
      .select({ id: schema.taskEvents.id })
      .from(schema.taskEvents)
      .where(
        and(
          eq(schema.taskEvents.orgId, ctx.orgId),
          eq(schema.taskEvents.taskId, task.id),
          eq(schema.taskEvents.toStatus, "completed"),
        ),
      )
      .limit(1);
    const [transfer] = await tx
      .select({ id: schema.taskTransfers.id })
      .from(schema.taskTransfers)
      .where(
        and(
          eq(schema.taskTransfers.orgId, ctx.orgId),
          eq(schema.taskTransfers.taskId, task.id),
        ),
      )
      .limit(1);

    const decision = authorizeTaskDeletion({
      actor: { id: ctx.userId, role: ctx.role },
      task: {
        creatorId: task.creatorId,
        everCompleted: Boolean(completedEvent),
        everTransferred: Boolean(transfer),
      },
    });
    if (!decision.allowed) return err(decision.reason);

    await tx
      .delete(schema.taskEvents)
      .where(
        and(
          eq(schema.taskEvents.orgId, ctx.orgId),
          eq(schema.taskEvents.taskId, task.id),
        ),
      );
    await tx
      .delete(schema.tasks)
      .where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.orgId, ctx.orgId)));

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    revalidatePath("/clans");
    revalidatePath("/clans/[id]", "page");
  }
  return result;
}
