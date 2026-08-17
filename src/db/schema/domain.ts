import { relations, sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  date,
  foreignKey,
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

/**
 * Clãs operacionais da Guilda. O slug é a categoria estável usada nas regras
 * de negócio; o nome pode ser apresentado na interface.
 */
export const clans = pgTable(
  "clans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 60 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clans_org_slug_uidx").on(t.orgId, t.slug),
    uniqueIndex("clans_org_id_uidx").on(t.orgId, t.id),
    index("clans_org_active_idx").on(t.orgId, t.active),
  ],
);

/** Uma pessoa pode participar de vários clãs, mas só ter um clã principal. */
export const clanMemberships = pgTable(
  "clan_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    clanId: uuid("clan_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    isLeader: boolean("is_leader").notNull().default(false),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "clan_memberships_org_clan_fk",
      columns: [t.orgId, t.clanId],
      foreignColumns: [clans.orgId, clans.id],
    }).onDelete("cascade"),
    uniqueIndex("clan_memberships_org_clan_user_uidx").on(
      t.orgId,
      t.clanId,
      t.userId,
    ),
    uniqueIndex("clan_memberships_org_user_primary_uidx")
      .on(t.orgId, t.userId)
      .where(sql`is_primary = true`),
    index("clan_memberships_org_user_idx").on(t.orgId, t.userId),
    index("clan_memberships_org_clan_leader_idx").on(
      t.orgId,
      t.clanId,
      t.isLeader,
    ),
  ],
);

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
    assigneeId: text("assignee_id").references(() => user.id),
    clanId: uuid("clan_id"),
    clientId: uuid("client_id").references(() => clients.id),
    // Agrupa o "pacote" de missões nascidas do mesmo informativo — é o que a
    // Mesa do Líder usa para atribuir tudo de uma empresa de uma vez.
    informativeId: uuid("informative_id").references(() => informatives.id),
    closingId: uuid("closing_id").references(() => accountingClosings.id, {
      onDelete: "set null",
    }),
    closingYearId: uuid("closing_year_id").references(
      () => accountingClosingYears.id,
    ),
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
    foreignKey({
      name: "tasks_org_clan_fk",
      columns: [t.orgId, t.clanId],
      foreignColumns: [clans.orgId, clans.id],
    }),
    check(
      "tasks_assignee_or_clan_check",
      sql`${t.assigneeId} IS NOT NULL OR ${t.clanId} IS NOT NULL`,
    ),
    uniqueIndex("tasks_org_id_uidx").on(t.orgId, t.id),
    index("tasks_org_assignee_status_idx").on(t.orgId, t.assigneeId, t.status),
    index("tasks_org_clan_status_idx").on(t.orgId, t.clanId, t.status),
    index("tasks_org_due_date_idx").on(t.orgId, t.dueDate),
    index("tasks_org_client_idx").on(t.orgId, t.clientId),
    index("tasks_org_informative_idx").on(t.orgId, t.informativeId),
    index("tasks_org_closing_idx").on(t.orgId, t.closingId),
    index("tasks_org_closing_year_idx").on(t.orgId, t.closingYearId),
  ],
);

/** Histórico imutável de mudanças de responsável e/ou clã de uma missão. */
export const taskTransfers = pgTable(
  "task_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    taskId: uuid("task_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    fromAssigneeId: text("from_assignee_id").references(() => user.id),
    toAssigneeId: text("to_assignee_id").references(() => user.id),
    fromClanId: uuid("from_clan_id"),
    toClanId: uuid("to_clan_id").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "task_transfers_org_task_fk",
      columns: [t.orgId, t.taskId],
      foreignColumns: [tasks.orgId, tasks.id],
    }),
    foreignKey({
      name: "task_transfers_org_from_clan_fk",
      columns: [t.orgId, t.fromClanId],
      foreignColumns: [clans.orgId, clans.id],
    }),
    foreignKey({
      name: "task_transfers_org_to_clan_fk",
      columns: [t.orgId, t.toClanId],
      foreignColumns: [clans.orgId, clans.id],
    }),
    index("task_transfers_org_task_created_idx").on(
      t.orgId,
      t.taskId,
      t.createdAt,
    ),
    index("task_transfers_org_to_clan_created_idx").on(
      t.orgId,
      t.toClanId,
      t.createdAt,
    ),
  ],
);

/**
 * Sugestões de responsável extraídas do informativo ("Att. FULANO").
 * São SUGESTÃO, nunca atribuição: a missão de clã nasce sem responsável e o
 * líder decide. Uma linha pode citar duas pessoas ("Rafa/Bruno"), por isso é
 * tabela e não coluna. `user_id` fica nulo quando o nome não casa com ninguém
 * do diretório — o registro do nome cru é a trilha para o líder entender.
 */
export const taskAssigneeSuggestions = pgTable(
  "task_assignee_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    taskId: uuid("task_id").notNull(),
    userId: text("user_id").references(() => user.id),
    rawName: varchar("raw_name", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "task_assignee_suggestions_org_task_fk",
      columns: [t.orgId, t.taskId],
      foreignColumns: [tasks.orgId, tasks.id],
    }).onDelete("cascade"),
    index("task_assignee_suggestions_org_task_idx").on(t.orgId, t.taskId),
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
  (t) => [
    uniqueIndex("task_events_org_id_uidx").on(t.orgId, t.id),
    index("task_events_org_task_idx").on(t.orgId, t.taskId),
  ],
);

/**
 * Ledger IMUTÁVEL de XP — NUNCA sofre UPDATE/DELETE (o role da aplicação
 * tem esses privilégios revogados via migration). Crédito e estorno são
 * sempre NOVOS lançamentos:
 *   - reason 'task_completed': crédito na conclusão;
 *   - reason 'reversal': lançamento negativo quando admin reverte;
 *   - task_event_id torna cada lançamento de transição idempotente, sem
 *     impedir novos ciclos conclusão → reversão → reconclusão;
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
    taskEventId: uuid("task_event_id"),
    closingYearId: uuid("closing_year_id").references(
      () => accountingClosingYears.id,
    ),
    amount: integer("amount").notNull(), // positivo = crédito, negativo = estorno
    reason: varchar("reason", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "xp_ledger_org_task_event_fk",
      columns: [t.orgId, t.taskEventId],
      foreignColumns: [taskEvents.orgId, taskEvents.id],
    }),
    index("xp_ledger_org_user_idx").on(t.orgId, t.userId),
    uniqueIndex("xp_ledger_task_event_uidx")
      .on(t.taskEventId)
      .where(
        sql`task_event_id IS NOT NULL AND reason IN ('task_completed', 'reversal')`,
      ),
    uniqueIndex("xp_ledger_closing_year_closed_uidx")
      .on(t.closingYearId)
      .where(sql`reason = 'closing_year_closed'`),
  ],
);

export const xpLedgerRelations = relations(xpLedger, ({ one }) => ({
  user: one(user, { fields: [xpLedger.userId], references: [user.id] }),
  task: one(tasks, { fields: [xpLedger.taskId], references: [tasks.id] }),
  taskEvent: one(taskEvents, {
    fields: [xpLedger.taskEventId],
    references: [taskEvents.id],
  }),
  closingYear: one(accountingClosingYears, {
    fields: [xpLedger.closingYearId],
    references: [accountingClosingYears.id],
  }),
}));

export type XpLedgerEntry = typeof xpLedger.$inferSelect;

export const taskEventsRelations = relations(taskEvents, ({ one, many }) => ({
  task: one(tasks, { fields: [taskEvents.taskId], references: [tasks.id] }),
  actor: one(user, { fields: [taskEvents.actorId], references: [user.id] }),
  xpEntries: many(xpLedger),
}));

export const clansRelations = relations(clans, ({ one, many }) => ({
  organization: one(organization, {
    fields: [clans.orgId],
    references: [organization.id],
  }),
  memberships: many(clanMemberships),
  tasks: many(tasks),
  incomingTransfers: many(taskTransfers, { relationName: "transfer_to_clan" }),
  outgoingTransfers: many(taskTransfers, { relationName: "transfer_from_clan" }),
}));

export const clanMembershipsRelations = relations(
  clanMemberships,
  ({ one }) => ({
    organization: one(organization, {
      fields: [clanMemberships.orgId],
      references: [organization.id],
    }),
    clan: one(clans, {
      fields: [clanMemberships.clanId],
      references: [clans.id],
    }),
    user: one(user, {
      fields: [clanMemberships.userId],
      references: [user.id],
    }),
  }),
);

export const taskTransfersRelations = relations(taskTransfers, ({ one }) => ({
  organization: one(organization, {
    fields: [taskTransfers.orgId],
    references: [organization.id],
  }),
  task: one(tasks, {
    fields: [taskTransfers.taskId],
    references: [tasks.id],
  }),
  actor: one(user, {
    fields: [taskTransfers.actorId],
    references: [user.id],
    relationName: "transfer_actor",
  }),
  fromAssignee: one(user, {
    fields: [taskTransfers.fromAssigneeId],
    references: [user.id],
    relationName: "transfer_from_assignee",
  }),
  toAssignee: one(user, {
    fields: [taskTransfers.toAssigneeId],
    references: [user.id],
    relationName: "transfer_to_assignee",
  }),
  fromClan: one(clans, {
    fields: [taskTransfers.fromClanId],
    references: [clans.id],
    relationName: "transfer_from_clan",
  }),
  toClan: one(clans, {
    fields: [taskTransfers.toClanId],
    references: [clans.id],
    relationName: "transfer_to_clan",
  }),
}));

export type Clan = typeof clans.$inferSelect;
export type ClanMembership = typeof clanMemberships.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type TaskTransfer = typeof taskTransfers.$inferSelect;

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
  clan: one(clans, { fields: [tasks.clanId], references: [clans.id] }),
  client: one(clients, { fields: [tasks.clientId], references: [clients.id] }),
  informative: one(informatives, {
    fields: [tasks.informativeId],
    references: [informatives.id],
  }),
  suggestions: many(taskAssigneeSuggestions),
  closing: one(accountingClosings, {
    fields: [tasks.closingId],
    references: [accountingClosings.id],
  }),
  closingYear: one(accountingClosingYears, {
    fields: [tasks.closingYearId],
    references: [accountingClosingYears.id],
  }),
  events: many(taskEvents),
  transfers: many(taskTransfers),
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
    // Proveniência da automação. Sem FK para evitar um ciclo físico.
    completedByTaskId: uuid("completed_by_task_id"),
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
    // Proveniência da automação. Sem FK para evitar um ciclo físico tasks↔ano.
    closedByTaskId: uuid("closed_by_task_id"),
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

/**
 * Estado de confirmação de um informativo recebido.
 * O tipo no Postgres preserva o nome antigo (`telegram_ai_draft_status`)
 * porque renomear o tipo não traz ganho e custaria mais uma migration.
 */
export const informativeStatus = pgEnum("telegram_ai_draft_status", [
  "pending",
  "confirmed",
  "cancelled",
]);

/** Porta de entrada do informativo: bot do Telegram ou painel da Guilda. */
export const informativeSource = pgEnum("informative_source", [
  "telegram",
  "panel",
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
 * O informativo recebido: texto original, extração da IA e estado de
 * confirmação. Nenhuma missão é criada até alguém com permissão confirmar
 * a prévia — pelo Telegram ou pelo painel (`source`).
 *
 * `connection_id` é nulo quando o informativo entra pelo painel: nesse caso
 * não existe conversa do Telegram por trás da solicitação.
 */
export const informatives = pgTable(
  "informatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    connectionId: uuid("connection_id").references(() => telegramConnections.id),
    source: informativeSource("source").notNull().default("telegram"),
    sourceText: text("source_text").notNull(),
    model: varchar("model", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: informativeStatus("status").notNull().default("pending"),
    createdTaskIds: jsonb("created_task_ids").$type<unknown>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("informatives_org_id_uidx").on(t.orgId, t.id),
    index("informatives_org_user_status_idx").on(
      t.orgId,
      t.requestedBy,
      t.status,
    ),
    index("informatives_expires_idx").on(t.expiresAt),
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
export type Informative = typeof informatives.$inferSelect;
export type TaskAssigneeSuggestion = typeof taskAssigneeSuggestions.$inferSelect;

/** Tipo de aviso do mural: relato livre ou empresa nova entrando na carteira. */
export const guildNoticeKind = pgEnum("guild_notice_kind", [
  "notice",
  "new_client",
]);

/**
 * Mural da Guilda: quadro de avisos da organização inteira.
 * `requires_ack` e `pinned` são restritos a líder/admin/owner na action —
 * qualquer um pode avisar, mas nem todo mundo pode obrigar a Guilda a dar
 * ciência. O aviso de empresa nova nasce na mesma transação que confirma o
 * informativo, e o índice único parcial garante um aviso por informativo.
 */
export const guildNotices = pgTable(
  "guild_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    kind: guildNoticeKind("kind").notNull().default("notice"),
    title: varchar("title", { length: 160 }).notNull(),
    body: text("body").notNull(),
    clientId: uuid("client_id").references(() => clients.id),
    informativeId: uuid("informative_id").references(() => informatives.id),
    requiresAck: boolean("requires_ack").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("guild_notices_org_id_uidx").on(t.orgId, t.id),
    index("guild_notices_org_pinned_published_idx").on(
      t.orgId,
      t.pinned,
      t.publishedAt.desc(),
    ),
    uniqueIndex("guild_notices_new_client_uidx")
      .on(t.informativeId)
      .where(sql`kind = 'new_client'`),
  ],
);

/**
 * Confirmação de leitura: FATO REGISTRADO, não alternável.
 * Não existe "desconfirmar" — o insert é idempotente pela unicidade abaixo e
 * a action sempre usa o userId da SESSÃO, nunca um vindo do cliente.
 */
export const guildNoticeReads = pgTable(
  "guild_notice_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    noticeId: uuid("notice_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "guild_notice_reads_org_notice_fk",
      columns: [t.orgId, t.noticeId],
      foreignColumns: [guildNotices.orgId, guildNotices.id],
    }).onDelete("cascade"),
    uniqueIndex("guild_notice_reads_org_notice_user_uidx").on(
      t.orgId,
      t.noticeId,
      t.userId,
    ),
    index("guild_notice_reads_org_user_idx").on(t.orgId, t.userId),
  ],
);

export const guildNoticesRelations = relations(guildNotices, ({ one, many }) => ({
  author: one(user, {
    fields: [guildNotices.authorId],
    references: [user.id],
  }),
  client: one(clients, {
    fields: [guildNotices.clientId],
    references: [clients.id],
  }),
  informative: one(informatives, {
    fields: [guildNotices.informativeId],
    references: [informatives.id],
  }),
  reads: many(guildNoticeReads),
}));

export const guildNoticeReadsRelations = relations(guildNoticeReads, ({ one }) => ({
  notice: one(guildNotices, {
    fields: [guildNoticeReads.noticeId],
    references: [guildNotices.id],
  }),
  user: one(user, {
    fields: [guildNoticeReads.userId],
    references: [user.id],
  }),
}));

export const taskAssigneeSuggestionsRelations = relations(
  taskAssigneeSuggestions,
  ({ one }) => ({
    task: one(tasks, {
      fields: [taskAssigneeSuggestions.taskId],
      references: [tasks.id],
    }),
    user: one(user, {
      fields: [taskAssigneeSuggestions.userId],
      references: [user.id],
    }),
  }),
);

export type GuildNotice = typeof guildNotices.$inferSelect;
export type GuildNoticeRead = typeof guildNoticeReads.$inferSelect;
