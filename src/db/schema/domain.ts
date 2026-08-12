import { relations, sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
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
    clientId: uuid("client_id").references(() => clients.id),
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
    index("tasks_org_client_idx").on(t.orgId, t.clientId),
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
    closingYearId: uuid("closing_year_id").references(
      () => accountingClosingYears.id,
    ),
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
    uniqueIndex("xp_ledger_closing_year_closed_uidx")
      .on(t.closingYearId)
      .where(sql`reason = 'closing_year_closed'`),
  ],
);

export const xpLedgerRelations = relations(xpLedger, ({ one }) => ({
  user: one(user, { fields: [xpLedger.userId], references: [user.id] }),
  task: one(tasks, { fields: [xpLedger.taskId], references: [tasks.id] }),
  closingYear: one(accountingClosingYears, {
    fields: [xpLedger.closingYearId],
    references: [accountingClosingYears.id],
  }),
}));

export type XpLedgerEntry = typeof xpLedger.$inferSelect;

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
  task: one(tasks, { fields: [taskEvents.taskId], references: [tasks.id] }),
  actor: one(user, { fields: [taskEvents.actorId], references: [user.id] }),
}));

export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;

/** Regime tributário — chave que casa template→cliente nas Campanhas (Fase 5). */
export const taxRegime = pgEnum("tax_regime", [
  "simples",
  "presumido",
  "association",
  "real",
]);

/** Situação operacional de um fechamento contábil planejado. */
export const closingStatus = pgEnum("closing_status", [
  "pending",
  "blocked",
  "completed",
]);

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

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  creator: one(user, { fields: [tasks.creatorId], references: [user.id] }),
  assignee: one(user, { fields: [tasks.assigneeId], references: [user.id] }),
  client: one(clients, { fields: [tasks.clientId], references: [clients.id] }),
  events: many(taskEvents),
}));

/**
 * Fechamentos contábeis livres: cada linha é uma necessidade real com prazo,
 * situação e observações próprias. Uma empresa pode ter qualquer quantidade
 * de fechamentos no ano.
 */
export const accountingClosings = pgTable(
  "accounting_closings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    title: varchar("title", { length: 160 }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: closingStatus("status").notNull().default("pending"),
    notes: text("notes"),
    cashBalance: numeric("cash_balance", { precision: 15, scale: 2 }),
    periodResult: numeric("period_result", { precision: 15, scale: 2 }),
    shareholderLoan: numeric("shareholder_loan", { precision: 15, scale: 2 }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    completedBy: text("completed_by").references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accounting_closings_org_due_date_idx").on(t.orgId, t.dueDate),
    index("accounting_closings_org_client_idx").on(t.orgId, t.clientId),
  ],
);

export const accountingClosingsRelations = relations(
  accountingClosings,
  ({ one }) => ({
    client: one(clients, {
      fields: [accountingClosings.clientId],
      references: [clients.id],
    }),
    completedByUser: one(user, {
      fields: [accountingClosings.completedBy],
      references: [user.id],
    }),
    createdByUser: one(user, {
      fields: [accountingClosings.createdBy],
      references: [user.id],
    }),
  }),
);

export type AccountingClosing = typeof accountingClosings.$inferSelect;

/**
 * Controle anual por empresa. O encerramento do ano é uma decisão explícita:
 * não depende da quantidade de fechamentos, pois cada cliente pode ter uma
 * rotina diferente. Para empresas do Simples, também registra a entrega da
 * DEFIS, que só pode acontecer depois do encerramento anual.
 */
export const accountingClosingYears = pgTable(
  "accounting_closing_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    year: smallint("year").notNull(),
    notes: text("notes"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").references(() => user.id),
    defisNotes: text("defis_notes"),
    defisCompletedAt: timestamp("defis_completed_at", { withTimezone: true }),
    defisCompletedBy: text("defis_completed_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accounting_closing_years_org_client_year_uidx").on(
      t.orgId,
      t.clientId,
      t.year,
    ),
    index("accounting_closing_years_org_year_idx").on(t.orgId, t.year),
  ],
);

export const accountingClosingYearsRelations = relations(
  accountingClosingYears,
  ({ one }) => ({
    client: one(clients, {
      fields: [accountingClosingYears.clientId],
      references: [clients.id],
    }),
    closedByUser: one(user, {
      fields: [accountingClosingYears.closedBy],
      references: [user.id],
      relationName: "closing_year_closed_by",
    }),
    defisCompletedByUser: one(user, {
      fields: [accountingClosingYears.defisCompletedBy],
      references: [user.id],
      relationName: "closing_year_defis_completed_by",
    }),
  }),
);

export type AccountingClosingYear = typeof accountingClosingYears.$inferSelect;

/**
 * Templates de campanha (Fase 5b): checklist reutilizável POR REGIME
 * (~3–5 no total, não 250). Vários templates por regime são permitidos —
 * a criação de campanha (5c) seleciona qual usar. A instanciação COPIA
 * os itens para `tasks`; nada referencia estas tabelas, então delete
 * físico é permitido e nunca afeta campanhas já instanciadas.
 */
export const missionTemplates = pgTable(
  "mission_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    name: varchar("name", { length: 120 }).notNull(),
    taxRegime: taxRegime("tax_regime").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mission_templates_org_idx").on(t.orgId)],
);

export const missionTemplateItems = pgTable(
  "mission_template_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => missionTemplates.id),
    title: varchar("title", { length: 200 }).notNull(),
    difficulty: smallint("difficulty").notNull().default(2), // 1–5, alimenta o XP
    orderIndex: smallint("order_index").notNull().default(0), // sequência de execução (gate na 5c)
  },
  (t) => [index("mission_template_items_org_template_idx").on(t.orgId, t.templateId)],
);

export const missionTemplatesRelations = relations(missionTemplates, ({ many }) => ({
  items: many(missionTemplateItems),
}));

export const missionTemplateItemsRelations = relations(
  missionTemplateItems,
  ({ one }) => ({
    template: one(missionTemplates, {
      fields: [missionTemplateItems.templateId],
      references: [missionTemplates.id],
    }),
  }),
);

export type MissionTemplate = typeof missionTemplates.$inferSelect;
export type MissionTemplateItem = typeof missionTemplateItems.$inferSelect;

/** Estado de entrega de uma mensagem na fila transacional do Telegram. */
export const telegramOutboxStatus = pgEnum("telegram_outbox_status", [
  "pending",
  "processing",
  "sent",
  "failed",
  "cancelled",
]);

export const telegramAiDraftStatus = pgEnum("telegram_ai_draft_status", [
  "pending",
  "confirmed",
  "cancelled",
]);

/**
 * Vínculo entre uma pessoa da Guilda e uma conversa privada do Telegram.
 *
 * O vínculo é sempre escopado por organização. Os índices parciais também
 * impedem que uma conta/uma pessoa possua dois vínculos ativos, evitando que
 * um comando recebido antes de conhecermos o tenant seja ambíguo.
 */
export const telegramConnections = pgTable(
  "telegram_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // IDs do Bot API têm até 52 bits significativos, portanto são seguros em
    // number/JavaScript e preservados em bigint no Postgres.
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    username: varchar("username", { length: 64 }),
    firstName: varchar("first_name", { length: 255 }),
    lastName: varchar("last_name", { length: 255 }),
    languageCode: varchar("language_code", { length: 16 }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("telegram_connections_org_user_active_uidx")
      .on(t.orgId, t.userId)
      .where(sql`revoked_at IS NULL`),
    uniqueIndex("telegram_connections_telegram_user_active_uidx")
      .on(t.telegramUserId)
      .where(sql`revoked_at IS NULL`),
    index("telegram_connections_org_idx").on(t.orgId),
  ],
);

/** Token descartável de conexão. Somente o SHA-256 é persistido. */
export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("telegram_link_tokens_hash_uidx").on(t.tokenHash),
    index("telegram_link_tokens_org_user_idx").on(t.orgId, t.userId),
    index("telegram_link_tokens_expires_idx").on(t.expiresAt),
  ],
);

/** Preferências de notificação por pessoa e organização. */
export const telegramPreferences = pgTable(
  "telegram_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    taskNotifications: boolean("task_notifications").notNull().default(true),
    approvalNotifications: boolean("approval_notifications")
      .notNull()
      .default(true),
    deadlineReminders: boolean("deadline_reminders").notNull().default(true),
    xpNotifications: boolean("xp_notifications").notNull().default(true),
    closingNotifications: boolean("closing_notifications")
      .notNull()
      .default(true),
    campaignNotifications: boolean("campaign_notifications")
      .notNull()
      .default(true),
    dailySummary: boolean("daily_summary").notNull().default(false),
    dailySummaryTime: time("daily_summary_time").notNull().default("08:00:00"),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("America/Sao_Paulo"),
    quietHoursStart: time("quiet_hours_start"),
    quietHoursEnd: time("quiet_hours_end"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("telegram_preferences_org_user_uidx").on(t.orgId, t.userId),
    index("telegram_preferences_summary_idx").on(
      t.orgId,
      t.dailySummary,
      t.dailySummaryTime,
    ),
  ],
);

/**
 * Dedupe global de updates do Telegram. Não armazena payload nem dados do
 * tenant: a organização ainda é desconhecida quando o update chega.
 */
export const telegramUpdates = pgTable(
  "telegram_updates",
  {
    updateId: bigint("update_id", { mode: "number" }).primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastError: text("last_error"),
  },
  (t) => [index("telegram_updates_pending_idx").on(t.processedAt, t.lockedAt)],
);

/**
 * Prévia gerada pela IA. Nenhuma missão é criada até um admin/owner confirmar
 * explicitamente o rascunho pelo Telegram.
 */
export const telegramAiDrafts = pgTable(
  "telegram_ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => telegramConnections.id),
    sourceText: text("source_text").notNull(),
    model: varchar("model", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: telegramAiDraftStatus("status").notNull().default("pending"),
    createdTaskIds: jsonb("created_task_ids").$type<unknown>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("telegram_ai_drafts_org_user_status_idx").on(
      t.orgId,
      t.requestedBy,
      t.status,
    ),
    index("telegram_ai_drafts_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Outbox transacional: produtores inserem eventos na mesma transação da
 * mudança de domínio; um worker os envia depois, com retry e deduplicação.
 */
export const telegramOutbox = pgTable(
  "telegram_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    connectionId: uuid("connection_id").references(() => telegramConnections.id),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 255 }).notNull(),
    // `unknown` força consumidores a validar a versão/formato antes do envio,
    // sem exigir index signature nos payloads discriminados do domínio.
    payload: jsonb("payload").$type<unknown>().notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: telegramOutboxStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockToken: uuid("lock_token"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("telegram_outbox_org_dedupe_uidx").on(t.orgId, t.dedupeKey),
    index("telegram_outbox_pending_idx").on(t.status, t.scheduledFor),
    index("telegram_outbox_org_user_idx").on(t.orgId, t.userId),
  ],
);

export type TelegramConnection = typeof telegramConnections.$inferSelect;
export type TelegramLinkToken = typeof telegramLinkTokens.$inferSelect;
export type TelegramPreferences = typeof telegramPreferences.$inferSelect;
export type TelegramUpdateRecord = typeof telegramUpdates.$inferSelect;
export type TelegramOutboxEntry = typeof telegramOutbox.$inferSelect;
export type TelegramAiDraft = typeof telegramAiDrafts.$inferSelect;
