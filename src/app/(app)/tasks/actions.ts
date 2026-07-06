"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";
import {
  authorizeTransition,
  type OrgRole,
  type TaskStatus,
} from "@/domain/task-state";
import { calculateTaskXp } from "@/domain/xp";
import { auth } from "@/lib/auth";

/**
 * Server Actions de tarefas.
 * Regras inegociáveis aplicadas aqui:
 * - validação Zod de TODO input externo;
 * - verificação de sessão + papel em CADA action (nunca confiar na UI);
 * - todo cálculo de XP no servidor (xp_value congelado na criação);
 * - toda query dentro de withOrgTx (RLS) E filtrando org_id explicitamente;
 * - transições de status validadas pela máquina de estados no servidor.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function err(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Sessão + organização ativa + papel — obrigatório em toda action. */
async function requireMemberContext(): Promise<
  | { ok: true; userId: string; orgId: string; role: OrgRole }
  | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return err("Sessão expirada. Entre novamente.");
  }
  const orgId = session.session.activeOrganizationId;
  if (!orgId) {
    return err("Nenhuma organização ativa.");
  }
  const membership = await db.query.member.findFirst({
    where: and(
      eq(schema.member.userId, session.user.id),
      eq(schema.member.organizationId, orgId),
    ),
  });
  if (!membership) {
    return err("Você não é membro desta organização.");
  }
  return {
    ok: true,
    userId: session.user.id,
    orgId,
    role: membership.role as OrgRole,
  };
}

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

const createTaskSchema = z.object({
  title: z.string().trim().min(3, "Título muito curto.").max(200, "Título muito longo."),
  description: z
    .string()
    .trim()
    .max(5000, "Descrição muito longa.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  assigneeId: z.string().min(1, "Escolha a pessoa responsável."),
  priority: z.coerce.number().int().min(1).max(3),
  difficulty: z.coerce.number().int().min(1).max(5),
  dueDate: dueDateSchema,
});

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

  // Responsável precisa ser membro da MESMA organização (verificado no servidor)
  const assigneeMembership = await db.query.member.findFirst({
    where: and(
      eq(schema.member.userId, data.assigneeId),
      eq(schema.member.organizationId, ctx.orgId),
    ),
  });
  if (!assigneeMembership) {
    return err("A pessoa responsável precisa ser membro da organização.");
  }

  // XP calculado NO SERVIDOR e congelado na criação — nunca vem do cliente
  const xpValue = calculateTaskXp(data.difficulty, data.priority);

  const taskId = await withOrgTx(ctx.orgId, async (tx) => {
    const [task] = await tx
      .insert(schema.tasks)
      .values({
        orgId: ctx.orgId,
        creatorId: ctx.userId,
        assigneeId: data.assigneeId,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        difficulty: data.difficulty,
        xpValue,
        status: "pending",
        dueDate: dueDateFromInput(data.dueDate),
      })
      .returning({ id: schema.tasks.id });

    await tx.insert(schema.taskEvents).values({
      orgId: ctx.orgId,
      taskId: task.id,
      actorId: ctx.userId,
      fromStatus: null,
      toStatus: "pending",
    });

    return task.id;
  });

  revalidatePath("/tasks");
  return { ok: true, data: { taskId } };
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

    if (!task) return err("Tarefa não encontrada.");

    const isAdmin = ctx.role === "admin" || ctx.role === "owner";
    if (task.creatorId !== ctx.userId && !isAdmin) {
      return err("Apenas quem criou a tarefa ou um admin pode editá-la.");
    }
    const editableStatuses: TaskStatus[] = ["pending", "in_progress", "rejected"];
    if (!editableStatuses.includes(task.status)) {
      return err("Tarefas em aprovação, concluídas ou canceladas não podem ser editadas.");
    }

    await tx
      .update(schema.tasks)
      .set({
        title: data.title,
        description: data.description ?? null,
        dueDate: dueDateFromInput(data.dueDate),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, task.id));

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${data.taskId}`);
  }
  return result;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  sideEffect?: (tx: Tx, task: schema.Task) => Promise<void>;
}): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx.ok) return ctx;

  const idParse = z.uuid().safeParse(options.taskId);
  if (!idParse.success) return err("Tarefa inválida.");

  const result = await withOrgTx(ctx.orgId, async (tx): Promise<ActionResult> => {
    // Lock da linha: transições concorrentes serializam aqui e a segunda
    // falha na validação de estado (não há transição dupla).
    const [task] = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, idParse.data), eq(schema.tasks.orgId, ctx.orgId)))
      .for("update");

    if (!task) return err("Tarefa não encontrada.");
    if (!options.allowedFrom.includes(task.status)) {
      return err("A tarefa não está mais neste estado — atualize a página.");
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

    await tx
      .update(schema.tasks)
      .set({
        status: options.to,
        updatedAt: new Date(),
        completedAt: options.to === "completed" ? new Date() : task.completedAt,
      })
      .where(eq(schema.tasks.id, task.id));

    await tx.insert(schema.taskEvents).values({
      orgId: ctx.orgId,
      taskId: task.id,
      actorId: ctx.userId,
      fromStatus: task.status,
      toStatus: options.to,
      note: options.note ?? null,
    });

    if (options.sideEffect) {
      await options.sideEffect(tx, task);
    }

    return { ok: true };
  });

  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${options.taskId}`);
    revalidatePath("/dashboard");
  }
  return result;
}

const taskIdSchema = z.object({ taskId: z.uuid() });

/** Responsável inicia (pending) ou retoma após rejeição (rejected). */
export async function startTask(input: { taskId: string }): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Tarefa inválida.");
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "in_progress",
    allowedFrom: ["pending", "rejected"],
  });
}

/** Responsável marca como feita — vai para aprovação. */
export async function submitTask(input: { taskId: string }): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Tarefa inválida.");
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "awaiting_approval",
    allowedFrom: ["in_progress"],
  });
}

/**
 * Crédito de XP da conclusão — SEMPRE na mesma transação da transição.
 * Idempotente: o índice único parcial (task_id) WHERE reason =
 * 'task_completed' impede crédito duplo; onConflictDoNothing faz a
 * reinserção ser um no-op.
 */
async function creditTaskXp(tx: Tx, task: schema.Task): Promise<void> {
  await tx
    .insert(schema.xpLedger)
    .values({
      orgId: task.orgId,
      userId: task.assigneeId,
      taskId: task.id,
      amount: task.xpValue, // congelado na criação — nunca vem do cliente
      reason: "task_completed",
    })
    .onConflictDoNothing();
}

/** Criador ou admin aprova uma entrega em awaiting_approval. */
export async function approveTask(input: { taskId: string }): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Tarefa inválida.");
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "completed",
    allowedFrom: ["awaiting_approval"],
    sideEffect: creditTaskXp,
  });
}

/**
 * Auto-tarefa (criador == responsável) conclui direto de in_progress,
 * sem aprovação — a autorização no domínio garante a exclusividade.
 */
export async function completeOwnTask(input: {
  taskId: string;
}): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return err("Tarefa inválida.");
  return transitionTask({
    taskId: parsed.data.taskId,
    to: "completed",
    allowedFrom: ["in_progress"],
    sideEffect: creditTaskXp,
  });
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
 * o crédito original nunca é apagado. Único por tarefa (índice parcial).
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
    sideEffect: async (tx, task) => {
      await tx
        .insert(schema.xpLedger)
        .values({
          orgId: task.orgId,
          userId: task.assigneeId,
          taskId: task.id,
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
