import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

/**
 * Tabelas de domínio do Guilda.
 * REGRA INEGOCIÁVEL: toda tabela de domínio tem org_id, toda query filtra
 * por org_id E o Postgres garante o isolamento via Row Level Security
 * (políticas criadas em migration custom — ver src/db/migrations).
 */

export const taskStatus = pgEnum("task_status", [
  "pending", //           criada, ainda não iniciada
  "in_progress", //       responsável começou
  "awaiting_approval", // responsável marcou como feita; aguarda aprovação
  "completed", //         aprovada; XP creditado
  "rejected", //          aprovador devolveu; volta a in_progress após ajuste
  "cancelled",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => user.id),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    priority: smallint("priority").notNull().default(2), // 1 baixa, 2 média, 3 alta
    difficulty: smallint("difficulty").notNull().default(2), // 1 a 5, define o XP
    xpValue: integer("xp_value").notNull(), // congelado na criação
    status: taskStatus("status").notNull().default("pending"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_org_assignee_status_idx").on(t.orgId, t.assigneeId, t.status),
    index("tasks_org_due_date_idx").on(t.orgId, t.dueDate),
  ],
);

/** Histórico de transições de status (auditoria). */
export const taskEvents = pgTable(
  "task_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    fromStatus: taskStatus("from_status"),
    toStatus: taskStatus("to_status").notNull(),
    note: text("note"), // ex.: motivo da rejeição
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_events_org_task_idx").on(t.orgId, t.taskId)],
);

/**
 * Ledger IMUTÁVEL de XP — NUNCA sofre UPDATE/DELETE (o role da aplicação
 * tem esses privilégios revogados via migration). Crédito e estorno são
 * sempre NOVOS lançamentos:
 *   - reason 'task_completed': crédito na aprovação (único por tarefa —
 *     índice parcial impede crédito duplo);
 *   - reason 'reversal': lançamento negativo quando admin reverte
 *     (também único por tarefa);
 *   - reason 'bonus': reservado para usos futuros.
 */
export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    taskId: uuid("task_id").references(() => tasks.id),
    amount: integer("amount").notNull(), // positivo = crédito, negativo = estorno
    reason: varchar("reason", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("xp_ledger_org_user_idx").on(t.orgId, t.userId),
    uniqueIndex("xp_ledger_task_completed_uidx")
      .on(t.taskId)
      .where(sql`reason = 'task_completed'`),
    uniqueIndex("xp_ledger_task_reversal_uidx")
      .on(t.taskId)
      .where(sql`reason = 'reversal'`),
  ],
);

export const xpLedgerRelations = relations(xpLedger, ({ one }) => ({
  user: one(user, { fields: [xpLedger.userId], references: [user.id] }),
  task: one(tasks, { fields: [xpLedger.taskId], references: [tasks.id] }),
}));

export type XpLedgerEntry = typeof xpLedger.$inferSelect;

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  creator: one(user, { fields: [tasks.creatorId], references: [user.id] }),
  assignee: one(user, { fields: [tasks.assigneeId], references: [user.id] }),
  events: many(taskEvents),
}));

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
  task: one(tasks, { fields: [taskEvents.taskId], references: [tasks.id] }),
  actor: one(user, { fields: [taskEvents.actorId], references: [user.id] }),
}));

export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;

/** Regime tributário — chave que casa template→cliente nas Campanhas (Fase 5). */
export const taxRegime = pgEnum("tax_regime", ["simples", "presumido", "real"]);

/**
 * Empresas-cliente (Fase 5a): OBJETO do trabalho das campanhas, NÃO usuárias
 * do sistema (não confundir com organization = tenant). Cadastro estável,
 * carga inicial via `npm run import:clients`. Sem DELETE no fluxo — cliente
 * sai de cena com active = false (campanhas futuras referenciam clients).
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    name: varchar("name", { length: 200 }).notNull(),
    taxRegime: taxRegime("tax_regime").notNull(),
    cnpj: varchar("cnpj", { length: 14 }), // opcional; normalizado (só dígitos)
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clients_org_active_idx").on(t.orgId, t.active),
    // CNPJ único por org QUANDO presente (chave de dedup do import)
    uniqueIndex("clients_org_cnpj_uidx")
      .on(t.orgId, t.cnpj)
      .where(sql`cnpj IS NOT NULL`),
  ],
);

export type Client = typeof clients.$inferSelect;
