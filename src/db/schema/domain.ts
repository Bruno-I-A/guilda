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
 * Clãs operacionais da Guilda. O slug preserva integrações especiais já
 * existentes; nome, descrição, composição e roteamento são configuráveis.
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
    description: text("description"),
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
    functionTitle: varchar("function_title", { length: 100 }),
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

/** Atalhos pessoais exibidos no início; cada usuário organiza os seus. */
export const dashboardShortcuts = pgTable(
  "dashboard_shortcuts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    target: varchar("target", { length: 180 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    sortOrder: smallint("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dashboard_shortcuts_org_user_target_uidx").on(
      t.orgId,
      t.userId,
      t.target,
    ),
    index("dashboard_shortcuts_org_user_order_idx").on(
      t.orgId,
      t.userId,
      t.sortOrder,
    ),
    check("dashboard_shortcuts_label_check", sql`length(btrim(${t.label})) > 0`),
    check("dashboard_shortcuts_sort_order_check", sql`${t.sortOrder} >= 0`),
  ],
);

/**
 * Regra configurável de roteamento do Informativo.
 * Cada nome de setor normalizado aponta para a fila do clã (userId nulo) ou
 * diretamente para uma pessoa que participa daquele clã.
 */
export const clanInformativeRoutes = pgTable(
  "clan_informative_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clanId: uuid("clan_id").notNull(),
    userId: text("user_id").references(() => user.id),
    sector: varchar("sector", { length: 120 }).notNull(),
    normalizedSector: varchar("normalized_sector", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "clan_informative_routes_org_clan_fk",
      columns: [t.orgId, t.clanId],
      foreignColumns: [clans.orgId, clans.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "clan_informative_routes_membership_fk",
      columns: [t.orgId, t.clanId, t.userId],
      foreignColumns: [
        clanMemberships.orgId,
        clanMemberships.clanId,
        clanMemberships.userId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("clan_informative_routes_org_sector_uidx").on(
      t.orgId,
      t.normalizedSector,
    ),
    index("clan_informative_routes_org_clan_idx").on(t.orgId, t.clanId),
    index("clan_informative_routes_org_user_idx").on(t.orgId, t.userId),
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
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    // Agrupa o "pacote" de missões nascidas do mesmo informativo — é o que a
    // Mesa do Líder usa para atribuir tudo de uma empresa de uma vez.
    informativeId: uuid("informative_id").references(() => informatives.id),
    closingId: uuid("closing_id").references(() => accountingClosings.id, {
      onDelete: "set null",
    }),
    closingYearId: uuid("closing_year_id").references(
      () => accountingClosingYears.id,
    ),
    // Período de distribuição de lucros que gerou esta missão. Sem FK
    // (mesma razão de closing_by_task_id): evita ciclo físico entre as duas
    // tabelas, que se referenciam nos dois sentidos.
    commitmentPeriodId: uuid("commitment_period_id"),
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
    }).onDelete("cascade"),
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
 * equipe decide. Uma linha pode citar duas pessoas ("Rafa/Bruno"), por isso é
 * tabela e não coluna. `user_id` fica nulo quando o nome não casa com ninguém
 * do diretório — o registro do nome cru é a trilha para a equipe entender.
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
      .references(() => tasks.id, { onDelete: "cascade" }),
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
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    taskEventId: uuid("task_event_id").references(() => taskEvents.id, {
      onDelete: "set null",
    }),
    closingYearId: uuid("closing_year_id").references(
      () => accountingClosingYears.id,
      { onDelete: "set null" },
    ),
    amount: integer("amount").notNull(), // positivo = crédito, negativo = estorno
    reason: varchar("reason", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
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
  informativeRoutes: many(clanInformativeRoutes),
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
  "mei",
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
    tradeName: varchar("trade_name", { length: 200 }),
    operationalEmail: varchar("operational_email", { length: 200 }),
    operationalPhone: varchar("operational_phone", { length: 20 }),
    revenueEmail: varchar("revenue_email", { length: 200 }),
    revenuePhones: jsonb("revenue_phones").$type<string[]>().notNull().default([]),
    address: jsonb("address").$type<{
      street: string | null;
      number: string | null;
      complement: string | null;
      district: string | null;
      city: string | null;
      state: string | null;
      zipCode: string | null;
    }>(),
    cadastralSituation: varchar("cadastral_situation", { length: 80 }),
    cadastralSituationDate: date("cadastral_situation_date", { mode: "string" }),
    companySize: varchar("company_size", { length: 120 }),
    legalNature: varchar("legal_nature", { length: 200 }),
    shareCapital: numeric("share_capital", { precision: 15, scale: 2 }),
    headquartersType: varchar("headquarters_type", { length: 40 }),
    qsa: jsonb("qsa").$type<{
      name: string;
      document: string | null;
      qualification: string | null;
      joinedAt: string | null;
      participation: string | null;
    }[]>().notNull().default([]),
    taxRegimeHistory: jsonb("tax_regime_history").$type<{
      year: number | null;
      form: string;
    }[]>().notNull().default([]),
    cnpjSyncedAt: timestamp("cnpj_synced_at", { withTimezone: true }),
    // Preenchidos só pelo fluxo "Novo cliente" dos Informativos (consulta de
    // CNPJ na Receita via BrasilAPI) — nulos no cadastro manual/import CSV.
    cnaeCode: varchar("cnae_code", { length: 10 }),
    cnaeDescription: varchar("cnae_description", { length: 200 }),
    secondaryCnaes: jsonb("secondary_cnaes").$type<
      { code: string; description: string }[]
    >(),
    openedAt: date("opened_at", { mode: "string" }),
    // Combinado do Fiscal extraído do informativo de cliente novo (ex.: Fator
    // R, faturamento) — mora aqui só até a equipe confirmar a carteira. A Ficha
    // Fiscal permanente recebe o texto antes de estes campos serem limpos;
    // trocar o responsável não altera a ficha.
    pendingFiscalNote: text("pending_fiscal_note"),
    suggestedFiscalOwnerId: text("suggested_fiscal_owner_id").references(
      () => user.id,
    ),
    // true em TODO cliente recém-criado (qualquer via, não só o fluxo de
    // CNPJ) — inclusive quando não há nota nenhuma (ex.: "FISCAL - sem
    // particularidades"). Sem isto, esse caso ficaria indistinguível de
    // qualquer empresa antiga sem responsável na aba Carteira. Zerado junto
    // com os dois campos acima quando o líder confirma quem assume.
    pendingFiscalAssignment: boolean("pending_fiscal_assignment")
      .notNull()
      .default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clients_org_active_idx").on(t.orgId, t.active),
    // Permite FKs compostas nas tabelas novas, impedindo que um registro de
    // uma organização aponte por engano para um cliente de outra organização.
    uniqueIndex("clients_org_id_uidx").on(t.orgId, t.id),
    // CNPJ único por org QUANDO presente (chave de dedup do import)
    uniqueIndex("clients_org_cnpj_uidx")
      .on(t.orgId, t.cnpj)
      .where(sql`cnpj IS NOT NULL`),
  ],
);

export type Client = typeof clients.$inferSelect;

/**
 * Lote durável da importação de clientes. As consultas externas são feitas em
 * pequenos blocos; somente a confirmação final inclui os CNPJs ainda ausentes,
 * dentro de uma única transação.
 */
export const clientImportBatches = pgTable(
  "client_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("processing"),
    rows: jsonb("rows").$type<unknown[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("client_import_batches_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

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
      .references(() => clients.id, { onDelete: "cascade" }),
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
      .references(() => clients.id, { onDelete: "cascade" }),
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

/** Pedido físico que o dono encaminha ao Societário antes de virar informativo. */
export const companyFlowKind = pgEnum("company_flow_kind", [
  "opening",
  "amendment",
  "closure",
]);

/** Etapas do vai-e-volta dono → Societário → dono → Informativos. */
export const companyFlowStatus = pgEnum("company_flow_status", [
  "sent_to_corporate",
  "in_progress",
  "awaiting_owner",
  "informative_drafting",
  "completed",
  "cancelled",
]);

export const companyFlowSource = pgEnum("company_flow_source", [
  "written",
  "whatsapp",
  "phone",
  "other",
]);

/** Histórico operacional — só recebe novos eventos, nunca é reescrito. */
export const companyFlowEventType = pgEnum("company_flow_event_type", [
  "created",
  "claimed",
  "assigned",
  "returned_to_owner",
  "informative_prepared",
  "informative_cancelled",
  "informative_confirmed",
  "cancelled",
]);

export interface CompanyFlowActivity {
  code?: string | null;
  description: string;
}

export interface CompanyFlowQsaMember {
  name: string;
  document?: string | null;
  qualification?: string | null;
  previousParticipation?: string | null;
  participation?: string | null;
  quotaTransferDetails?: string | null;
  changeType?: "entered" | "left" | "updated" | "remaining" | null;
}

/**
 * Fluxo Societário. A senha do Gov.br deliberadamente NÃO mora nesta tabela:
 * ela fica cifrada e separada em `company_flow_secrets`, fora de eventos,
 * listagens e informativos.
 */
export const companyFlows = pgTable(
  "company_flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    societarioClanId: uuid("societario_clan_id").notNull(),
    kind: companyFlowKind("kind").notNull(),
    status: companyFlowStatus("status").notNull().default("sent_to_corporate"),
    source: companyFlowSource("source").notNull().default("written"),
    existingClientId: uuid("existing_client_id"),
    requestedLegalName: varchar("requested_legal_name", { length: 200 }),
    requestedActivities: jsonb("requested_activities")
      .$type<CompanyFlowActivity[]>()
      .notNull()
      .default([]),
    removedActivities: jsonb("removed_activities")
      .$type<CompanyFlowActivity[]>()
      .notNull()
      .default([]),
    taxRegime: taxRegime("tax_regime"),
    iptu: varchar("iptu", { length: 120 }),
    /** Dados físicos e societários solicitados para a abertura. */
    socialCapital: numeric("social_capital", { precision: 15, scale: 2 }),
    roomSize: varchar("room_size", { length: 100 }),
    address: text("address"),
    clientResponsible: varchar("client_responsible", { length: 160 }),
    qsa: jsonb("qsa").$type<CompanyFlowQsaMember[]>().notNull().default([]),
    contactName: varchar("contact_name", { length: 160 }),
    contactPhone: varchar("contact_phone", { length: 40 }),
    contactEmail: varchar("contact_email", { length: 200 }),
    requestDetails: text("request_details"),
    /** Cobrança do serviço de alteração/baixa, destinada ao Financeiro. */
    billingAmount: numeric("billing_amount", { precision: 15, scale: 2 }),
    billingDescription: text("billing_description"),
    /** Missão preventiva do RH que libera a conclusão de uma baixa. */
    rhVerificationTaskId: uuid("rh_verification_task_id"),
    assignedTo: text("assigned_to").references(() => user.id),
    resultCnpj: varchar("result_cnpj", { length: 14 }),
    approvedLegalName: varchar("approved_legal_name", { length: 200 }),
    approvedActivities: jsonb("approved_activities")
      .$type<CompanyFlowActivity[]>()
      .notNull()
      .default([]),
    /** Dados efetivamente alterados, preenchidos pelo Societário. */
    approvedTaxRegime: taxRegime("approved_tax_regime"),
    approvedAddress: text("approved_address"),
    approvedQsa: jsonb("approved_qsa")
      .$type<CompanyFlowQsaMember[]>()
      .notNull()
      .default([]),
    processingNotes: text("processing_notes"),
    informativeId: uuid("informative_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "company_flows_org_societario_clan_fk",
      columns: [t.orgId, t.societarioClanId],
      foreignColumns: [clans.orgId, clans.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "company_flows_org_client_fk",
      columns: [t.orgId, t.existingClientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "company_flows_org_informative_fk",
      columns: [t.orgId, t.informativeId],
      foreignColumns: [informatives.orgId, informatives.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "company_flows_org_rh_verification_task_fk",
      columns: [t.orgId, t.rhVerificationTaskId],
      foreignColumns: [tasks.orgId, tasks.id],
    }).onDelete("restrict"),
    uniqueIndex("company_flows_org_id_uidx").on(t.orgId, t.id),
    index("company_flows_org_clan_status_idx").on(
      t.orgId,
      t.societarioClanId,
      t.status,
      t.updatedAt,
    ),
    index("company_flows_org_assigned_status_idx").on(
      t.orgId,
      t.assignedTo,
      t.status,
    ),
    index("company_flows_org_creator_idx").on(t.orgId, t.createdBy, t.updatedAt),
    uniqueIndex("company_flows_org_informative_uidx")
      .on(t.orgId, t.informativeId)
      .where(sql`${t.informativeId} IS NOT NULL`),
    uniqueIndex("company_flows_org_rh_verification_task_uidx")
      .on(t.orgId, t.rhVerificationTaskId)
      .where(sql`${t.rhVerificationTaskId} IS NOT NULL`),
    check(
      "company_flows_kind_client_check",
      sql`(${t.kind} = 'opening' AND ${t.existingClientId} IS NULL) OR (${t.kind} <> 'opening' AND ${t.existingClientId} IS NOT NULL)`,
    ),
    check(
      "company_flows_result_cnpj_check",
      sql`${t.resultCnpj} IS NULL OR ${t.resultCnpj} ~ '^\\d{14}$'`,
    ),
    check(
      "company_flows_billing_pair_check",
      sql`(${t.billingAmount} IS NULL AND ${t.billingDescription} IS NULL) OR (${t.billingAmount} IS NOT NULL AND ${t.billingDescription} IS NOT NULL AND ${t.billingAmount} > 0 AND length(btrim(${t.billingDescription})) > 0)`,
    ),
    check(
      "company_flows_billing_kind_check",
      sql`${t.kind} <> 'opening' OR (${t.billingAmount} IS NULL AND ${t.billingDescription} IS NULL)`,
    ),
    check(
      "company_flows_rh_verification_kind_check",
      sql`${t.kind} = 'closure' OR ${t.rhVerificationTaskId} IS NULL`,
    ),
  ],
);

export const clanInformativeRoutesRelations = relations(
  clanInformativeRoutes,
  ({ one }) => ({
    organization: one(organization, {
      fields: [clanInformativeRoutes.orgId],
      references: [organization.id],
    }),
    clan: one(clans, {
      fields: [clanInformativeRoutes.clanId],
      references: [clans.id],
    }),
    user: one(user, {
      fields: [clanInformativeRoutes.userId],
      references: [user.id],
    }),
  }),
);

/** Credencial do Gov.br cifrada com AES-GCM; uma por fluxo, sem histórico. */
export const companyFlowSecrets = pgTable(
  "company_flow_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    flowId: uuid("flow_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: varchar("iv", { length: 32 }).notNull(),
    authTag: varchar("auth_tag", { length: 32 }).notNull(),
    keyVersion: smallint("key_version").notNull().default(1),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "company_flow_secrets_org_flow_fk",
      columns: [t.orgId, t.flowId],
      foreignColumns: [companyFlows.orgId, companyFlows.id],
    }).onDelete("cascade"),
    uniqueIndex("company_flow_secrets_org_flow_uidx").on(t.orgId, t.flowId),
    uniqueIndex("company_flow_secrets_org_id_uidx").on(t.orgId, t.id),
  ],
);

export const companyFlowEvents = pgTable(
  "company_flow_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    flowId: uuid("flow_id").notNull(),
    eventType: companyFlowEventType("event_type").notNull(),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    note: text("note"),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "company_flow_events_org_flow_fk",
      columns: [t.orgId, t.flowId],
      foreignColumns: [companyFlows.orgId, companyFlows.id],
    }).onDelete("cascade"),
    index("company_flow_events_org_flow_created_idx").on(
      t.orgId,
      t.flowId,
      t.createdAt,
    ),
  ],
);



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
    // Avisos do Mural que exigem confirmação de leitura. Aviso sem
    // requires_ack nunca notifica — senão o mural vira spam.
    muralNotifications: boolean("mural_notifications").notNull().default(true),
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
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
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

/**
 * Carteira do clã Fiscal: qual pessoa responde por qual empresa-cliente.
 *
 * Uma linha = uma empresa sob responsabilidade de alguém. A carteira de uma
 * pessoa é o conjunto das suas linhas — não existe entidade "carteira" com
 * nome próprio, porque a unidade que o escritório move é a EMPRESA, não o
 * pacote. A AUSÊNCIA de linha é estado válido e o mais importante da tela:
 * é a empresa sem responsável que o líder precisa distribuir.
 *
 * Escopo deliberadamente fiscal (decisão de 2026-08-18): Contabilidade
 * trabalha por fechamento (accounting_closings) e os demais clãs por
 * informativo, não por carteira. Se outro clã pedir o mesmo, aí sim vale
 * generalizar para (clan_id, client_id, user_id).
 */
export const fiscalPortfolios = pgTable(
  "fiscal_portfolios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** Quem fez a atribuição — o líder ou admin que distribuiu. */
    assignedBy: text("assigned_by")
      .notNull()
      .references(() => user.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Um único responsável fiscal por empresa: é o que torna "sem responsável"
    // um LEFT JOIN ... IS NULL em vez de contagem, e impede duas pessoas
    // acharem que a empresa é da outra.
    uniqueIndex("fiscal_portfolios_org_client_uidx").on(t.orgId, t.clientId),
    index("fiscal_portfolios_org_user_idx").on(t.orgId, t.userId),
  ],
);

/**
 * Histórico imutável de repasses da carteira fiscal. Existe porque "essa
 * empresa não é minha" é discussão real: guarda quem passou o quê para quem
 * e quando. `fromUserId` nulo = empresa não tinha responsável; `toUserId`
 * nulo = empresa saiu da carteira sem destino.
 */
export const fiscalPortfolioEvents = pgTable(
  "fiscal_portfolio_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => user.id),
    toUserId: text("to_user_id").references(() => user.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fiscal_portfolio_events_org_client_idx").on(t.orgId, t.clientId),
    index("fiscal_portfolio_events_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const fiscalPortfoliosRelations = relations(fiscalPortfolios, ({ one }) => ({
  client: one(clients, {
    fields: [fiscalPortfolios.clientId],
    references: [clients.id],
  }),
  user: one(user, {
    fields: [fiscalPortfolios.userId],
    references: [user.id],
  }),
}));

export type FiscalPortfolio = typeof fiscalPortfolios.$inferSelect;
export type FiscalPortfolioEvent = typeof fiscalPortfolioEvents.$inferSelect;

/** Situação de uma campanha mensal de clã. */
export const clanCampaignStatus = pgEnum("clan_campaign_status", [
  "planned",
  "active",
  "completed",
  "cancelled",
]);

/**
 * Campanha mensal de clã: o trabalho grande e recorrente do mês
 * (apuração do Fiscal, folha do RH, …). O guarda-chuva vive aqui; a
 * materialização das missões a partir dos templates sobre a carteira é a
 * etapa seguinte — por isso `tasks` ainda não referencia esta tabela.
 */
export const clanCampaigns = pgTable(
  "clan_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    clanId: uuid("clan_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    status: clanCampaignStatus("status").notNull().default("planned"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "clan_campaigns_org_clan_fk",
      columns: [t.orgId, t.clanId],
      foreignColumns: [clans.orgId, clans.id],
    }).onDelete("cascade"),
    check(
      "clan_campaigns_period_month_check",
      sql`${t.periodMonth} BETWEEN 1 AND 12`,
    ),
    check(
      "clan_campaigns_period_year_check",
      sql`${t.periodYear} BETWEEN 2000 AND 2100`,
    ),
    uniqueIndex("clan_campaigns_org_clan_period_name_uidx").on(
      t.orgId,
      t.clanId,
      t.periodYear,
      t.periodMonth,
      t.name,
    ),
    index("clan_campaigns_org_clan_period_idx").on(
      t.orgId,
      t.clanId,
      t.periodYear,
      t.periodMonth,
    ),
    uniqueIndex("clan_campaigns_org_id_uidx").on(t.orgId, t.id),
  ],
);

export const clanCampaignsRelations = relations(clanCampaigns, ({ one }) => ({
  clan: one(clans, {
    fields: [clanCampaigns.clanId],
    references: [clans.id],
  }),
  createdByUser: one(user, {
    fields: [clanCampaigns.createdBy],
    references: [user.id],
  }),
}));

export type ClanCampaign = typeof clanCampaigns.$inferSelect;

/** Se uma etapa do controle mensal se aplica à empresa. */
export const fiscalApplicability = pgEnum("fiscal_applicability", [
  "unknown",
  "required",
  "not_required",
  "not_applicable",
]);

/** Origem de um nome alternativo usado na conciliação de planilhas. */
export const fiscalAliasSource = pgEnum("fiscal_alias_source", [
  "client_name",
  "manual",
  "import_reconciliation",
]);

export const fiscalProfileEventType = pgEnum("fiscal_profile_event_type", [
  "created",
  "updated",
  "backfilled",
  "imported",
]);

export const fiscalImportBatchStatus = pgEnum("fiscal_import_batch_status", [
  "pending",
  "reconciling",
  "ready",
  "completed",
  "failed",
]);

/** Qual configuração fiscal está sendo conciliada no arquivo importado. */
export const fiscalImportKind = pgEnum("fiscal_import_kind", [
  "fiscal_profile",
  "office_fee",
]);

export const fiscalImportRowStatus = pgEnum("fiscal_import_row_status", [
  "pending",
  "suggested",
  "matched",
  "ignored",
  "imported",
  "error",
]);

export const fiscalImportResolutionMethod = pgEnum(
  "fiscal_import_resolution_method",
  ["exact_alias", "exact_name", "exact_cnpj", "fuzzy", "manual"],
);

/** Situação de cada célula operacional da competência fiscal. */
export const fiscalStepStatus = pgEnum("fiscal_step_status", [
  "not_applicable",
  "pending",
  "completed",
  "blocked",
]);

/** Situação consolidada de uma empresa em uma competência. */
export const fiscalControlStatus = pgEnum("fiscal_control_status", [
  "not_started",
  "in_progress",
  "blocked",
  "completed",
]);

export const fiscalControlEventType = pgEnum("fiscal_control_event_type", [
  "created",
  "profile_synced",
  "campaign_linked",
  "step_updated",
  "status_updated",
  "note_updated",
  "completed",
  "reopened",
]);

export const fiscalControlStage = pgEnum("fiscal_control_stage", [
  "movements",
  "incoming",
  "outgoing",
  "guide",
  "nfs",
  "delivery",
]);

/** Meio usado pelo escritório para cobrar o honorário mensal. */
export const officeFeeBillingMethod = pgEnum("office_fee_billing_method", [
  "asaas",
  "recibo",
  "pix",
  "other",
]);

export const officeFeeProfileEventType = pgEnum("office_fee_profile_event_type", [
  "created",
  "updated",
  "imported",
]);

export const officeFeeControlEventType = pgEnum("office_fee_control_event_type", [
  "created",
  "step_updated",
  "status_updated",
  "note_updated",
  "completed",
  "reopened",
]);

export const officeFeeControlStage = pgEnum("office_fee_control_stage", [
  "invoice",
  "additional_installment",
  "collection",
]);

export type FiscalClientProfileSnapshot = {
  version: number;
  movementsApplicability: (typeof fiscalApplicability.enumValues)[number];
  incomingApplicability: (typeof fiscalApplicability.enumValues)[number];
  outgoingApplicability: (typeof fiscalApplicability.enumValues)[number];
  guideApplicability: (typeof fiscalApplicability.enumValues)[number];
  nfsApplicability: (typeof fiscalApplicability.enumValues)[number];
  deliveryChannel: string | null;
  factorRApplicability: (typeof fiscalApplicability.enumValues)[number];
  revenueReference: string | null;
  permanentNotes: string | null;
};

export type FiscalImportReport = {
  totalRows: number;
  matchedRows: number;
  pendingRows: number;
  ignoredRows: number;
  errorRows: number;
  createdProfiles?: number;
  updatedProfiles?: number;
  unchangedProfiles?: number;
  rejectedRows?: number;
};

/** Retrato de como o honorário deve ser tratado quando o mês foi aberto. */
export type OfficeFeeProfileSnapshot = {
  version: number;
  billingMethod: (typeof officeFeeBillingMethod.enumValues)[number];
  chargesAdditionalInstallment: boolean;
  monthlyFee: string;
  permanentNotes: string | null;
};

/**
 * Ficha Fiscal permanente da empresa. Ela não pertence a uma carteira: trocar
 * o responsável nunca apaga os combinados operacionais do cliente.
 */
export const fiscalClientProfiles = pgTable(
  "fiscal_client_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    movementsApplicability: fiscalApplicability("movements_applicability")
      .notNull()
      .default("unknown"),
    incomingApplicability: fiscalApplicability("incoming_applicability")
      .notNull()
      .default("unknown"),
    outgoingApplicability: fiscalApplicability("outgoing_applicability")
      .notNull()
      .default("unknown"),
    guideApplicability: fiscalApplicability("guide_applicability")
      .notNull()
      .default("unknown"),
    nfsApplicability: fiscalApplicability("nfs_applicability")
      .notNull()
      .default("unknown"),
    deliveryChannel: varchar("delivery_channel", { length: 120 }),
    factorRApplicability: fiscalApplicability("factor_r_applicability")
      .notNull()
      .default("unknown"),
    revenueReference: numeric("revenue_reference", { precision: 15, scale: 2 }),
    permanentNotes: text("permanent_notes"),
    version: integer("version").notNull().default(1),
    // Nulos apenas no backfill inicial, onde não existe um ator humano.
    createdBy: text("created_by").references(() => user.id),
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_client_profiles_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("fiscal_client_profiles_org_client_uidx").on(t.orgId, t.clientId),
    uniqueIndex("fiscal_client_profiles_org_id_uidx").on(t.orgId, t.id),
    check("fiscal_client_profiles_version_check", sql`${t.version} >= 1`),
  ],
);

/** Snapshot imutável de cada versão da Ficha Fiscal. */
export const fiscalClientProfileEvents = pgTable(
  "fiscal_client_profile_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull(),
    clientId: uuid("client_id").notNull(),
    eventType: fiscalProfileEventType("event_type").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<FiscalClientProfileSnapshot>().notNull(),
    changedFields: jsonb("changed_fields").$type<string[]>().notNull().default([]),
    actorId: text("actor_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_client_profile_events_org_profile_fk",
      columns: [t.orgId, t.profileId],
      foreignColumns: [fiscalClientProfiles.orgId, fiscalClientProfiles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fiscal_client_profile_events_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("fiscal_client_profile_events_org_profile_version_uidx").on(
      t.orgId,
      t.profileId,
      t.version,
    ),
    index("fiscal_client_profile_events_org_client_idx").on(t.orgId, t.clientId),
    check("fiscal_client_profile_events_version_check", sql`${t.version} >= 1`),
    check(
      "fiscal_client_profile_events_snapshot_version_check",
      sql`(${t.snapshot} ->> 'version')::integer = ${t.version}`,
    ),
  ],
);

/** Nome da planilha já conciliado com uma empresa do cadastro. */
export const fiscalClientAliases = pgTable(
  "fiscal_client_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    aliasName: varchar("alias_name", { length: 240 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 240 }).notNull(),
    source: fiscalAliasSource("source").notNull().default("manual"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_client_aliases_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("fiscal_client_aliases_org_normalized_name_uidx").on(
      t.orgId,
      t.normalizedName,
    ),
    uniqueIndex("fiscal_client_aliases_org_id_uidx").on(t.orgId, t.id),
    index("fiscal_client_aliases_org_client_idx").on(t.orgId, t.clientId),
    check(
      "fiscal_client_aliases_normalized_name_check",
      sql`length(btrim(${t.normalizedName})) > 0`,
    ),
  ],
);

/**
 * Parcelamentos acompanhados pelo Fiscal. Não há unicidade por empresa:
 * cada cliente pode manter vários parcelamentos de tipos diferentes.
 */
export const fiscalInstallments = pgTable(
  "fiscal_installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    installmentType: varchar("installment_type", { length: 240 }).notNull(),
    notes: text("notes"),
    deliveryMethod: varchar("delivery_method", { length: 240 }),
    paidInstallments: integer("paid_installments").notNull().default(0),
    totalInstallments: integer("total_installments"),
    // Mantém o texto original de importações antigas quando não for possível
    // interpretar o formato como progresso numérico.
    installmentNumber: varchar("installment_number", { length: 120 }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_installments_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("fiscal_installments_org_id_uidx").on(t.orgId, t.id),
    index("fiscal_installments_org_client_idx").on(t.orgId, t.clientId),
    index("fiscal_installments_org_updated_idx").on(t.orgId, t.updatedAt),
    check(
      "fiscal_installments_type_check",
      sql`length(btrim(${t.installmentType})) > 0`,
    ),
    check(
      "fiscal_installments_progress_check",
      sql`${t.paidInstallments} >= 0 AND (${t.totalInstallments} IS NULL OR (${t.totalInstallments} >= 1 AND ${t.paidInstallments} <= ${t.totalInstallments}))`,
    ),
  ],
);

/** Uma marcação por mês informa que a parcela daquele período foi gerada. */
export const fiscalInstallmentIssuances = pgTable(
  "fiscal_installment_issuances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    installmentId: uuid("installment_id").notNull(),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    // Só desfaz o avanço automático ao desmarcar se esta própria geração o
    // tiver criado. Marcações anteriores à automação permanecem seguras.
    advancedPaid: boolean("advanced_paid").notNull().default(false),
    generatedBy: text("generated_by")
      .notNull()
      .references(() => user.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_installment_issuances_org_installment_fk",
      columns: [t.orgId, t.installmentId],
      foreignColumns: [fiscalInstallments.orgId, fiscalInstallments.id],
    }).onDelete("cascade"),
    uniqueIndex("fiscal_installment_issuances_org_period_uidx").on(
      t.orgId,
      t.installmentId,
      t.periodYear,
      t.periodMonth,
    ),
    index("fiscal_installment_issuances_org_period_idx").on(
      t.orgId,
      t.periodYear,
      t.periodMonth,
    ),
    check(
      "fiscal_installment_issuances_period_check",
      sql`${t.periodYear} BETWEEN 2000 AND 2100 AND ${t.periodMonth} BETWEEN 1 AND 12`,
    ),
  ],
);

/** Um arquivo de planilha submetido ao processo assistido de conciliação. */
export const fiscalImportBatches = pgTable(
  "fiscal_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    kind: fiscalImportKind("kind").notNull().default("fiscal_profile"),
    status: fiscalImportBatchStatus("status").notNull().default("pending"),
    totalRows: integer("total_rows").notNull().default(0),
    matchedRows: integer("matched_rows").notNull().default(0),
    pendingRows: integer("pending_rows").notNull().default(0),
    ignoredRows: integer("ignored_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    report: jsonb("report").$type<FiscalImportReport>(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fiscal_import_batches_org_id_uidx").on(t.orgId, t.id),
    index("fiscal_import_batches_org_created_idx").on(t.orgId, t.createdAt),
    check(
      "fiscal_import_batches_counts_check",
      sql`${t.totalRows} >= 0 AND ${t.matchedRows} >= 0 AND ${t.pendingRows} >= 0 AND ${t.ignoredRows} >= 0 AND ${t.errorRows} >= 0`,
    ),
  ],
);

/** Linha original e sua decisão de conciliação, preservadas para auditoria. */
export const fiscalImportRows = pgTable(
  "fiscal_import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    sourceName: varchar("source_name", { length: 240 }).notNull(),
    normalizedSourceName: varchar("normalized_source_name", { length: 240 }).notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull(),
    status: fiscalImportRowStatus("status").notNull().default("pending"),
    suggestedClientId: uuid("suggested_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    resolvedClientId: uuid("resolved_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    resolvedAliasId: uuid("resolved_alias_id").references(
      () => fiscalClientAliases.id,
      { onDelete: "set null" },
    ),
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 4 }),
    resolutionMethod: fiscalImportResolutionMethod("resolution_method"),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolutionNote: text("resolution_note"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_import_rows_org_batch_fk",
      columns: [t.orgId, t.batchId],
      foreignColumns: [fiscalImportBatches.orgId, fiscalImportBatches.id],
    }).onDelete("cascade"),
    uniqueIndex("fiscal_import_rows_org_batch_row_uidx").on(
      t.orgId,
      t.batchId,
      t.rowNumber,
    ),
    index("fiscal_import_rows_org_status_idx").on(t.orgId, t.status),
    check("fiscal_import_rows_row_number_check", sql`${t.rowNumber} >= 1`),
    check(
      "fiscal_import_rows_confidence_check",
      sql`${t.matchConfidence} IS NULL OR (${t.matchConfidence} >= 0 AND ${t.matchConfidence} <= 1)`,
    ),
    check(
      "fiscal_import_rows_resolved_check",
      sql`${t.status} NOT IN ('matched', 'imported') OR ${t.resolvedClientId} IS NOT NULL`,
    ),
  ],
);

/**
 * Uma linha do controle fiscal mensal. A ficha, o responsável e o regime são
 * snapshots: mudanças futuras jamais reescrevem uma competência já aberta.
 */
export const fiscalControlPeriods = pgTable(
  "fiscal_control_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    profileId: uuid("profile_id").notNull(),
    profileVersion: integer("profile_version").notNull(),
    profileSnapshot: jsonb("profile_snapshot")
      .$type<FiscalClientProfileSnapshot>()
      .notNull(),
    responsibleUserId: text("responsible_user_id").references(() => user.id),
    taxRegimeSnapshot: taxRegime("tax_regime_snapshot").notNull(),
    campaignId: uuid("campaign_id").references(() => clanCampaigns.id, {
      onDelete: "set null",
    }),
    movementsStatus: fiscalStepStatus("movements_status").notNull(),
    incomingStatus: fiscalStepStatus("incoming_status").notNull(),
    outgoingStatus: fiscalStepStatus("outgoing_status").notNull(),
    guideStatus: fiscalStepStatus("guide_status").notNull(),
    nfsStatus: fiscalStepStatus("nfs_status").notNull(),
    deliveryStatus: fiscalStepStatus("delivery_status").notNull(),
    status: fiscalControlStatus("status").notNull().default("not_started"),
    monthlyNotes: text("monthly_notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    completedBy: text("completed_by").references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_control_periods_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fiscal_control_periods_org_profile_fk",
      columns: [t.orgId, t.profileId],
      foreignColumns: [fiscalClientProfiles.orgId, fiscalClientProfiles.id],
    }),
    uniqueIndex("fiscal_control_periods_org_client_period_uidx").on(
      t.orgId,
      t.clientId,
      t.periodYear,
      t.periodMonth,
    ),
    uniqueIndex("fiscal_control_periods_org_id_uidx").on(t.orgId, t.id),
    index("fiscal_control_periods_org_period_status_idx").on(
      t.orgId,
      t.periodYear,
      t.periodMonth,
      t.status,
    ),
    index("fiscal_control_periods_org_responsible_idx").on(
      t.orgId,
      t.responsibleUserId,
      t.periodYear,
      t.periodMonth,
    ),
    check("fiscal_control_periods_month_check", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check("fiscal_control_periods_year_check", sql`${t.periodYear} BETWEEN 2000 AND 2100`),
    check("fiscal_control_periods_profile_version_check", sql`${t.profileVersion} >= 1`),
    check(
      "fiscal_control_periods_snapshot_version_check",
      sql`(${t.profileSnapshot} ->> 'version')::integer = ${t.profileVersion}`,
    ),
    check(
      "fiscal_control_periods_completion_check",
      sql`(${t.status} = 'completed' AND ${t.completedAt} IS NOT NULL AND ${t.completedBy} IS NOT NULL) OR (${t.status} <> 'completed' AND ${t.completedAt} IS NULL AND ${t.completedBy} IS NULL)`,
    ),
  ],
);

/** Evento imutável de uma alteração no controle fiscal mensal. */
export const fiscalControlEvents = pgTable(
  "fiscal_control_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    controlPeriodId: uuid("control_period_id").notNull(),
    clientId: uuid("client_id").notNull(),
    eventType: fiscalControlEventType("event_type").notNull(),
    stage: fiscalControlStage("stage"),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    note: text("note"),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fiscal_control_events_org_period_fk",
      columns: [t.orgId, t.controlPeriodId],
      foreignColumns: [fiscalControlPeriods.orgId, fiscalControlPeriods.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fiscal_control_events_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    index("fiscal_control_events_org_period_created_idx").on(
      t.orgId,
      t.controlPeriodId,
      t.createdAt,
    ),
  ],
);

/**
 * Regra permanente de cobrança dos honorários do escritório. Diferente da
 * carteira, mudar o responsável nunca altera meio, valor ou observações.
 */
export const officeFeeProfiles = pgTable(
  "office_fee_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    billingMethod: officeFeeBillingMethod("billing_method").notNull(),
    chargesAdditionalInstallment: boolean("charges_additional_installment")
      .notNull()
      .default(false),
    monthlyFee: numeric("monthly_fee", { precision: 15, scale: 2 }).notNull(),
    permanentNotes: text("permanent_notes"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id),
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "office_fee_profiles_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("office_fee_profiles_org_client_uidx").on(t.orgId, t.clientId),
    uniqueIndex("office_fee_profiles_org_id_uidx").on(t.orgId, t.id),
    check("office_fee_profiles_version_check", sql`${t.version} >= 1`),
    check("office_fee_profiles_monthly_fee_check", sql`${t.monthlyFee} >= 0`),
  ],
);

/** Histórico de versões da base de honorários — somente acréscimo. */
export const officeFeeProfileEvents = pgTable(
  "office_fee_profile_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull(),
    clientId: uuid("client_id").notNull(),
    eventType: officeFeeProfileEventType("event_type").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<OfficeFeeProfileSnapshot>().notNull(),
    changedFields: jsonb("changed_fields").$type<string[]>().notNull().default([]),
    actorId: text("actor_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "office_fee_profile_events_org_profile_fk",
      columns: [t.orgId, t.profileId],
      foreignColumns: [officeFeeProfiles.orgId, officeFeeProfiles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "office_fee_profile_events_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("office_fee_profile_events_org_profile_version_uidx").on(
      t.orgId,
      t.profileId,
      t.version,
    ),
    index("office_fee_profile_events_org_client_idx").on(t.orgId, t.clientId),
    check("office_fee_profile_events_version_check", sql`${t.version} >= 1`),
    check(
      "office_fee_profile_events_snapshot_version_check",
      sql`(${t.snapshot} ->> 'version')::integer = ${t.version}`,
    ),
  ],
);

/**
 * Uma competência de honorário por empresa cadastrada. A linha só nasce para
 * empresas que possuem regra de honorário, e congela nome, CNPJ, responsável
 * e configuração para que o fechamento mensal permaneça auditável.
 */
export const officeFeeControlPeriods = pgTable(
  "office_fee_control_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    clientNameSnapshot: varchar("client_name_snapshot", { length: 200 }).notNull(),
    clientCnpjSnapshot: varchar("client_cnpj_snapshot", { length: 14 }),
    profileId: uuid("profile_id").notNull(),
    profileVersion: integer("profile_version").notNull(),
    profileSnapshot: jsonb("profile_snapshot")
      .$type<OfficeFeeProfileSnapshot>()
      .notNull(),
    responsibleUserId: text("responsible_user_id").references(() => user.id),
    invoiceStatus: fiscalStepStatus("invoice_status").notNull(),
    additionalInstallmentStatus: fiscalStepStatus("additional_installment_status").notNull(),
    collectionStatus: fiscalStepStatus("collection_status").notNull(),
    status: fiscalControlStatus("status").notNull().default("not_started"),
    monthlyNotes: text("monthly_notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    completedBy: text("completed_by").references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "office_fee_control_periods_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "office_fee_control_periods_org_profile_fk",
      columns: [t.orgId, t.profileId],
      foreignColumns: [officeFeeProfiles.orgId, officeFeeProfiles.id],
    }),
    uniqueIndex("office_fee_control_periods_org_client_period_uidx").on(
      t.orgId,
      t.clientId,
      t.periodYear,
      t.periodMonth,
    ),
    uniqueIndex("office_fee_control_periods_org_id_uidx").on(t.orgId, t.id),
    index("office_fee_control_periods_org_period_status_idx").on(
      t.orgId,
      t.periodYear,
      t.periodMonth,
      t.status,
    ),
    index("office_fee_control_periods_org_responsible_idx").on(
      t.orgId,
      t.responsibleUserId,
      t.periodYear,
      t.periodMonth,
    ),
    check("office_fee_control_periods_month_check", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check("office_fee_control_periods_year_check", sql`${t.periodYear} BETWEEN 2000 AND 2100`),
    check("office_fee_control_periods_profile_version_check", sql`${t.profileVersion} >= 1`),
    check(
      "office_fee_control_periods_snapshot_version_check",
      sql`(${t.profileSnapshot} ->> 'version')::integer = ${t.profileVersion}`,
    ),
    check(
      "office_fee_control_periods_completion_check",
      sql`(${t.status} = 'completed' AND ${t.completedAt} IS NOT NULL AND ${t.completedBy} IS NOT NULL) OR (${t.status} <> 'completed' AND ${t.completedAt} IS NULL AND ${t.completedBy} IS NULL)`,
    ),
  ],
);

/** Evento operacional e imutável de cada alteração no fechamento mensal. */
export const officeFeeControlEvents = pgTable(
  "office_fee_control_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    controlPeriodId: uuid("control_period_id").notNull(),
    clientId: uuid("client_id").notNull(),
    eventType: officeFeeControlEventType("event_type").notNull(),
    stage: officeFeeControlStage("stage"),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    note: text("note"),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "office_fee_control_events_org_period_fk",
      columns: [t.orgId, t.controlPeriodId],
      foreignColumns: [officeFeeControlPeriods.orgId, officeFeeControlPeriods.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "office_fee_control_events_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    index("office_fee_control_events_org_period_created_idx").on(
      t.orgId,
      t.controlPeriodId,
      t.createdAt,
    ),
  ],
);

export const fiscalClientProfilesRelations = relations(
  fiscalClientProfiles,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [fiscalClientProfiles.clientId],
      references: [clients.id],
    }),
    events: many(fiscalClientProfileEvents),
    controlPeriods: many(fiscalControlPeriods),
  }),
);

export const fiscalClientProfileEventsRelations = relations(
  fiscalClientProfileEvents,
  ({ one }) => ({
    profile: one(fiscalClientProfiles, {
      fields: [fiscalClientProfileEvents.profileId],
      references: [fiscalClientProfiles.id],
    }),
    client: one(clients, {
      fields: [fiscalClientProfileEvents.clientId],
      references: [clients.id],
    }),
  }),
);

export const fiscalClientAliasesRelations = relations(
  fiscalClientAliases,
  ({ one }) => ({
    client: one(clients, {
      fields: [fiscalClientAliases.clientId],
      references: [clients.id],
    }),
  }),
);

export const fiscalInstallmentsRelations = relations(
  fiscalInstallments,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [fiscalInstallments.clientId],
      references: [clients.id],
    }),
    creator: one(user, {
      fields: [fiscalInstallments.createdBy],
      references: [user.id],
      relationName: "fiscal_installment_creator",
    }),
    updater: one(user, {
      fields: [fiscalInstallments.updatedBy],
      references: [user.id],
      relationName: "fiscal_installment_updater",
    }),
    issuances: many(fiscalInstallmentIssuances),
  }),
);

export const fiscalInstallmentIssuancesRelations = relations(
  fiscalInstallmentIssuances,
  ({ one }) => ({
    installment: one(fiscalInstallments, {
      fields: [fiscalInstallmentIssuances.installmentId],
      references: [fiscalInstallments.id],
    }),
    generatedByUser: one(user, {
      fields: [fiscalInstallmentIssuances.generatedBy],
      references: [user.id],
    }),
  }),
);

export const fiscalImportBatchesRelations = relations(
  fiscalImportBatches,
  ({ one, many }) => ({
    creator: one(user, {
      fields: [fiscalImportBatches.createdBy],
      references: [user.id],
    }),
    rows: many(fiscalImportRows),
  }),
);

export const fiscalImportRowsRelations = relations(fiscalImportRows, ({ one }) => ({
  batch: one(fiscalImportBatches, {
    fields: [fiscalImportRows.batchId],
    references: [fiscalImportBatches.id],
  }),
  suggestedClient: one(clients, {
    fields: [fiscalImportRows.suggestedClientId],
    references: [clients.id],
    relationName: "fiscal_import_row_suggested_client",
  }),
  resolvedClient: one(clients, {
    fields: [fiscalImportRows.resolvedClientId],
    references: [clients.id],
    relationName: "fiscal_import_row_resolved_client",
  }),
  resolvedAlias: one(fiscalClientAliases, {
    fields: [fiscalImportRows.resolvedAliasId],
    references: [fiscalClientAliases.id],
  }),
}));

export const fiscalControlPeriodsRelations = relations(
  fiscalControlPeriods,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [fiscalControlPeriods.clientId],
      references: [clients.id],
    }),
    profile: one(fiscalClientProfiles, {
      fields: [fiscalControlPeriods.profileId],
      references: [fiscalClientProfiles.id],
    }),
    campaign: one(clanCampaigns, {
      fields: [fiscalControlPeriods.campaignId],
      references: [clanCampaigns.id],
    }),
    responsibleUser: one(user, {
      fields: [fiscalControlPeriods.responsibleUserId],
      references: [user.id],
    }),
    events: many(fiscalControlEvents),
  }),
);

export const fiscalControlEventsRelations = relations(
  fiscalControlEvents,
  ({ one }) => ({
    controlPeriod: one(fiscalControlPeriods, {
      fields: [fiscalControlEvents.controlPeriodId],
      references: [fiscalControlPeriods.id],
    }),
    client: one(clients, {
      fields: [fiscalControlEvents.clientId],
      references: [clients.id],
    }),
    actor: one(user, {
      fields: [fiscalControlEvents.actorId],
      references: [user.id],
    }),
  }),
);

export const officeFeeProfilesRelations = relations(
  officeFeeProfiles,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [officeFeeProfiles.clientId],
      references: [clients.id],
    }),
    events: many(officeFeeProfileEvents),
    controlPeriods: many(officeFeeControlPeriods),
  }),
);

export const officeFeeProfileEventsRelations = relations(
  officeFeeProfileEvents,
  ({ one }) => ({
    profile: one(officeFeeProfiles, {
      fields: [officeFeeProfileEvents.profileId],
      references: [officeFeeProfiles.id],
    }),
    client: one(clients, {
      fields: [officeFeeProfileEvents.clientId],
      references: [clients.id],
    }),
    actor: one(user, {
      fields: [officeFeeProfileEvents.actorId],
      references: [user.id],
    }),
  }),
);

export const officeFeeControlPeriodsRelations = relations(
  officeFeeControlPeriods,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [officeFeeControlPeriods.clientId],
      references: [clients.id],
    }),
    profile: one(officeFeeProfiles, {
      fields: [officeFeeControlPeriods.profileId],
      references: [officeFeeProfiles.id],
    }),
    responsibleUser: one(user, {
      fields: [officeFeeControlPeriods.responsibleUserId],
      references: [user.id],
    }),
    events: many(officeFeeControlEvents),
  }),
);

export const officeFeeControlEventsRelations = relations(
  officeFeeControlEvents,
  ({ one }) => ({
    controlPeriod: one(officeFeeControlPeriods, {
      fields: [officeFeeControlEvents.controlPeriodId],
      references: [officeFeeControlPeriods.id],
    }),
    client: one(clients, {
      fields: [officeFeeControlEvents.clientId],
      references: [clients.id],
    }),
    actor: one(user, {
      fields: [officeFeeControlEvents.actorId],
      references: [user.id],
    }),
  }),
);

export type FiscalClientProfile = typeof fiscalClientProfiles.$inferSelect;
export type FiscalClientProfileEvent = typeof fiscalClientProfileEvents.$inferSelect;
export type FiscalClientAlias = typeof fiscalClientAliases.$inferSelect;
export type FiscalInstallment = typeof fiscalInstallments.$inferSelect;
export type FiscalInstallmentIssuance = typeof fiscalInstallmentIssuances.$inferSelect;
export type FiscalImportBatch = typeof fiscalImportBatches.$inferSelect;
export type FiscalImportRow = typeof fiscalImportRows.$inferSelect;
export type FiscalControlPeriod = typeof fiscalControlPeriods.$inferSelect;
export type FiscalControlEvent = typeof fiscalControlEvents.$inferSelect;
export type OfficeFeeProfile = typeof officeFeeProfiles.$inferSelect;
export type OfficeFeeProfileEvent = typeof officeFeeProfileEvents.$inferSelect;
export type OfficeFeeControlPeriod = typeof officeFeeControlPeriods.$inferSelect;
export type OfficeFeeControlEvent = typeof officeFeeControlEvents.$inferSelect;

/** Com que frequência a distribuição de lucros é planejada. */
export const commitmentCadence = pgEnum("commitment_cadence", [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
]);

/**
 * Planejamento recorrente de distribuição de lucros de UMA empresa-cliente.
 * O nome físico legado é mantido para preservar os registros existentes.
 */
export const clientCommitments = pgTable(
  "client_commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    /** O clã Contabilidade, que responde pelo planejamento. */
    clanId: uuid("clan_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    /** O combinado: valores, condições, o que observar. */
    notes: text("notes"),
    /** Meta opcional do planejamento; os valores realizados ficam nos períodos. */
    targetAmount: numeric("target_amount", { precision: 15, scale: 2 }),
    cadence: commitmentCadence("cadence").notNull(),
    /** Alimenta o XP da missão gerada a cada período (fórmula de sempre). */
    difficulty: smallint("difficulty").notNull().default(2),
    active: boolean("active").notNull().default(true),
    /** De qual informativo este planejamento nasceu, quando veio de um. */
    sourceInformativeId: uuid("source_informative_id").references(
      () => informatives.id,
    ),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_commitments_org_clan_fk",
      columns: [t.orgId, t.clanId],
      foreignColumns: [clans.orgId, clans.id],
    }),
    uniqueIndex("client_commitments_org_id_uidx").on(t.orgId, t.id),
    index("client_commitments_org_clan_idx").on(t.orgId, t.clanId, t.active),
    index("client_commitments_org_client_idx").on(t.orgId, t.clientId),
  ],
);

/**
 * A ocorrência de um período: "distribuição de lucros do 1º tri/2026".
 *
 * Nasce em lote com o ano inteiro planejado — é o que dá o controle de
 * enxergar o ano de uma vez. A MISSÃO (`task_id`) só nasce quando o período
 * chega, para não entupir a fila do clã em janeiro com trabalho de dezembro.
 * A ocorrência também pode ser concluída direto, sem missão, para o que não
 * precisa ser distribuído.
 */
export const clientCommitmentPeriods = pgTable(
  "client_commitment_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    commitmentId: uuid("commitment_id").notNull(),
    periodYear: smallint("period_year").notNull(),
    /** 1-based dentro do ano: 1–12 mensal, 1–4 trimestral, 1–2 semestral, 1 anual. */
    periodIndex: smallint("period_index").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    /** Total distribuído no período. Nulo significa "ainda não informado". */
    distributedAmount: numeric("distributed_amount", { precision: 15, scale: 2 }),
    notes: text("notes"),
    completedBy: text("completed_by").references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** A missão gerada para este período. Sem FK: evita ciclo físico com tasks. */
    taskId: uuid("task_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_commitment_periods_org_commitment_fk",
      columns: [t.orgId, t.commitmentId],
      foreignColumns: [clientCommitments.orgId, clientCommitments.id],
    }).onDelete("cascade"),
    // Regerar o ano é idempotente: a ocorrência do período já existente não
    // duplica nem perde o que já foi feito nela.
    uniqueIndex("client_commitment_periods_uidx").on(
      t.orgId,
      t.commitmentId,
      t.periodYear,
      t.periodIndex,
    ),
    index("client_commitment_periods_org_due_idx").on(t.orgId, t.dueDate),
  ],
);

export const clientCommitmentsRelations = relations(
  clientCommitments,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [clientCommitments.clientId],
      references: [clients.id],
    }),
    clan: one(clans, {
      fields: [clientCommitments.clanId],
      references: [clans.id],
    }),
    periods: many(clientCommitmentPeriods),
  }),
);

export const clientCommitmentPeriodsRelations = relations(
  clientCommitmentPeriods,
  ({ one }) => ({
    commitment: one(clientCommitments, {
      fields: [clientCommitmentPeriods.commitmentId],
      references: [clientCommitments.id],
    }),
    completedByUser: one(user, {
      fields: [clientCommitmentPeriods.completedBy],
      references: [user.id],
    }),
  }),
);

export type ClientCommitment = typeof clientCommitments.$inferSelect;
export type ClientCommitmentPeriod = typeof clientCommitmentPeriods.$inferSelect;
