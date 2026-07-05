/**
 * Seed de demonstração: 1 organização, 4 pessoas e tarefas em todos os
 * estados do ciclo de vida, com ledger de XP consistente (créditos e um
 * estorno) espalhados no tempo para preencher os períodos do ranking.
 *
 * Uso: npm run seed   (idempotente: aborta se a org demo já existe)
 * Login demo: helena@demo.guilda.dev / demo123456 (e demais e-mails)
 */
import "./load-env";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "../src/db";
import { withOrgTx } from "../src/db/org-tx";
import * as schema from "../src/db/schema";
import type { TaskStatus } from "../src/domain/task-state";
import { calculateTaskXp } from "../src/domain/xp";
import { auth } from "../src/lib/auth";

const PASSWORD = "demo123456";
const ORG_SLUG = "guilda-demo";

const PEOPLE = [
  { key: "helena", name: "Helena Prado", email: "helena@demo.guilda.dev", role: "owner" },
  { key: "rafael", name: "Rafael Dias", email: "rafael@demo.guilda.dev", role: "admin" },
  { key: "juliana", name: "Juliana Melo", email: "juliana@demo.guilda.dev", role: "member" },
  { key: "tiago", name: "Tiago Alves", email: "tiago@demo.guilda.dev", role: "member" },
] as const;

type PersonKey = (typeof PEOPLE)[number]["key"];

function daysAgo(days: number, hours = 0): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000);
}

async function ensureUser(name: string, email: string): Promise<string> {
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  });
  if (existing) return existing.id;
  await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
  const created = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  });
  if (!created) throw new Error(`falha ao criar usuário ${email}`);
  return created.id;
}

async function main() {
  const existingOrg = await db.query.organization.findFirst({
    where: eq(schema.organization.slug, ORG_SLUG),
  });
  if (existingOrg) {
    console.log(`Org demo já existe (${existingOrg.id}) — nada a fazer.`);
    console.log(`Logins: helena@demo.guilda.dev / ${PASSWORD}`);
    return;
  }

  console.log("Criando usuários…");
  const ids = {} as Record<PersonKey, string>;
  for (const person of PEOPLE) {
    ids[person.key] = await ensureUser(person.name, person.email);
  }

  console.log("Criando organização e membros…");
  const orgId = randomUUID();
  await db.insert(schema.organization).values({
    id: orgId,
    name: "Guilda Demo",
    slug: ORG_SLUG,
    createdAt: daysAgo(45),
  });
  for (const person of PEOPLE) {
    await db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: ids[person.key],
      role: person.role,
      createdAt: daysAgo(44),
    });
  }

  interface SeedTask {
    title: string;
    description?: string;
    creator: PersonKey;
    assignee: PersonKey;
    priority: 1 | 2 | 3;
    difficulty: 1 | 2 | 3 | 4 | 5;
    status: TaskStatus;
    /** dias atrás em que a tarefa foi criada */
    createdDaysAgo: number;
    /** dias atrás da conclusão (para completed/revertida) */
    completedDaysAgo?: number;
    rejectionNote?: string;
    dueInDays?: number;
    reverted?: boolean;
  }

  const TASKS: SeedTask[] = [
    // Concluídas na última semana (ranking semanal)
    { title: "Publicar landing page da campanha", creator: "helena", assignee: "juliana", priority: 3, difficulty: 4, status: "completed", createdDaysAgo: 6, completedDaysAgo: 2 },
    { title: "Corrigir bug do fechamento de caixa", creator: "rafael", assignee: "tiago", priority: 3, difficulty: 3, status: "completed", createdDaysAgo: 5, completedDaysAgo: 1 },
    { title: "Responder tickets acumulados do suporte", creator: "helena", assignee: "juliana", priority: 2, difficulty: 2, status: "completed", createdDaysAgo: 4, completedDaysAgo: 3 },
    // Concluídas no último mês (ranking mensal)
    { title: "Migrar planilha de clientes para o CRM", creator: "helena", assignee: "rafael", priority: 2, difficulty: 5, status: "completed", createdDaysAgo: 20, completedDaysAgo: 12 },
    { title: "Organizar onboarding de novos membros", creator: "rafael", assignee: "juliana", priority: 1, difficulty: 3, status: "completed", createdDaysAgo: 18, completedDaysAgo: 10 },
    { title: "Revisar contrato com fornecedor", creator: "helena", assignee: "tiago", priority: 2, difficulty: 2, status: "completed", createdDaysAgo: 15, completedDaysAgo: 9 },
    // Concluída há mais de 30 dias (aparece só no geral)
    { title: "Definir identidade visual da guilda", creator: "helena", assignee: "rafael", priority: 2, difficulty: 4, status: "completed", createdDaysAgo: 42, completedDaysAgo: 35 },
    // Revertida: crédito + estorno no ledger, volta a in_progress
    { title: "Atualizar catálogo de produtos", creator: "rafael", assignee: "tiago", priority: 2, difficulty: 3, status: "in_progress", createdDaysAgo: 8, completedDaysAgo: 4, reverted: true },
    // Em fluxo
    { title: "Preparar apresentação para o conselho", creator: "helena", assignee: "rafael", priority: 3, difficulty: 4, status: "awaiting_approval", createdDaysAgo: 3, dueInDays: 2 },
    { title: "Mapear processos do financeiro", creator: "rafael", assignee: "juliana", priority: 2, difficulty: 3, status: "in_progress", createdDaysAgo: 2, dueInDays: 5 },
    { title: "Cotar novos notebooks para a equipe", creator: "helena", assignee: "tiago", priority: 1, difficulty: 1, status: "pending", createdDaysAgo: 1, dueInDays: 7 },
    { title: "Escrever post de lançamento no blog", creator: "helena", assignee: "juliana", priority: 2, difficulty: 2, status: "rejected", createdDaysAgo: 4, rejectionNote: "Faltou incluir os depoimentos dos clientes beta.", dueInDays: 1 },
    { title: "Auditar acessos antigos do sistema", creator: "rafael", assignee: "rafael", priority: 1, difficulty: 2, status: "cancelled", createdDaysAgo: 12 },
  ];

  console.log("Criando tarefas, eventos e ledger…");
  await withOrgTx(orgId, async (tx) => {
    for (const seed of TASKS) {
      const taskId = randomUUID();
      const creatorId = ids[seed.creator];
      const assigneeId = ids[seed.assignee];
      const xpValue = calculateTaskXp(seed.difficulty, seed.priority);
      const createdAt = daysAgo(seed.createdDaysAgo, 6);
      const completedAt =
        seed.completedDaysAgo !== undefined ? daysAgo(seed.completedDaysAgo, 3) : null;

      await tx.insert(schema.tasks).values({
        id: taskId,
        orgId,
        creatorId,
        assigneeId,
        title: seed.title,
        description: seed.description ?? null,
        priority: seed.priority,
        difficulty: seed.difficulty,
        xpValue,
        status: seed.status,
        dueDate: seed.dueInDays !== undefined ? daysAgo(-seed.dueInDays) : null,
        createdAt,
        updatedAt: completedAt ?? createdAt,
        completedAt: seed.status === "completed" ? completedAt : null,
      });

      const events: {
        from: TaskStatus | null;
        to: TaskStatus;
        actor: string;
        at: Date;
        note?: string;
      }[] = [{ from: null, to: "pending", actor: creatorId, at: createdAt }];

      const wasStarted = seed.status !== "pending" && seed.status !== "cancelled";
      if (wasStarted) {
        events.push({
          from: "pending",
          to: "in_progress",
          actor: assigneeId,
          at: daysAgo(seed.createdDaysAgo, 2),
        });
      }
      if (
        seed.status === "awaiting_approval" ||
        seed.status === "completed" ||
        seed.status === "rejected" ||
        seed.reverted
      ) {
        events.push({
          from: "in_progress",
          to: "awaiting_approval",
          actor: assigneeId,
          at: completedAt ? new Date(completedAt.getTime() - 60 * 60 * 1000) : daysAgo(seed.createdDaysAgo, 1),
        });
      }
      if (seed.status === "completed" || seed.reverted) {
        events.push({
          from: "awaiting_approval",
          to: "completed",
          actor: creatorId,
          at: completedAt ?? createdAt,
        });
      }
      if (seed.reverted && completedAt) {
        events.push({
          from: "completed",
          to: "in_progress",
          actor: ids.helena,
          at: new Date(completedAt.getTime() + 12 * 60 * 60 * 1000),
          note: "Catálogo publicado com preços desatualizados.",
        });
      }
      if (seed.status === "rejected") {
        events.push({
          from: "awaiting_approval",
          to: "rejected",
          actor: creatorId,
          at: daysAgo(seed.createdDaysAgo - 1, 1),
          note: seed.rejectionNote,
        });
      }
      if (seed.status === "cancelled") {
        events.push({
          from: "pending",
          to: "cancelled",
          actor: creatorId,
          at: daysAgo(seed.createdDaysAgo - 1, 5),
        });
      }

      for (const event of events) {
        await tx.insert(schema.taskEvents).values({
          id: randomUUID(),
          orgId,
          taskId,
          actorId: event.actor,
          fromStatus: event.from,
          toStatus: event.to,
          note: event.note ?? null,
          createdAt: event.at,
        });
      }

      if ((seed.status === "completed" || seed.reverted) && completedAt) {
        await tx.insert(schema.xpLedger).values({
          id: randomUUID(),
          orgId,
          userId: assigneeId,
          taskId,
          amount: xpValue,
          reason: "task_completed",
          createdAt: completedAt,
        });
      }
      if (seed.reverted && completedAt) {
        await tx.insert(schema.xpLedger).values({
          id: randomUUID(),
          orgId,
          userId: assigneeId,
          taskId,
          amount: -xpValue,
          reason: "reversal",
          createdAt: new Date(completedAt.getTime() + 12 * 60 * 60 * 1000),
        });
      }
    }
  });

  console.log("\nSeed concluído! Organização: Guilda Demo");
  console.log(`Senha de todos: ${PASSWORD}`);
  for (const person of PEOPLE) {
    console.log(`  ${person.role.padEnd(6)} ${person.email}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
