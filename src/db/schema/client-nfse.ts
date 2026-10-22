import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
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
import { clients, nfseInvoiceEventType, nfseInvoiceStatus } from "./domain";

// ---------------------------------------------------------------------------
// Notas dos clientes: NFS-e emitidas pelo CNPJ das empresas-cliente, com o
// certificado de cada uma guardado no cofre (decisão de 2026-10-22). Desenho
// em docs/superpowers/specs/2026-10-22-notas-dos-clientes-design.md.
// ---------------------------------------------------------------------------

/** bytea do Postgres: o XML compactado (gzip) vai e volta como bytes crus. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

type AddressJson = {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
};

/** A que mês a nota se refere: o anterior ao da emissão ou o próprio. */
export const clientNfseReference = pgEnum("client_nfse_reference", ["previous", "current"]);

/**
 * A empresa-cliente que emite. O modelo fiscal (lib/nfse/template.ts) e a
 * numeração da DPS são dela: a DPS é numerada por CNPJ, então série e
 * contador não se misturam com os do escritório.
 */
export const clientNfseIssuers = pgTable(
  "client_nfse_issuers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    template: jsonb("template").notNull(),
    dpsSeries: varchar("dps_series", { length: 5 }).notNull(),
    nextDpsNumber: bigint("next_dps_number", { mode: "number" }).notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_nfse_issuers_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }).onDelete("cascade"),
    uniqueIndex("client_nfse_issuers_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("client_nfse_issuers_org_client_uidx").on(t.orgId, t.clientId),
    check("client_nfse_issuers_series_check", sql`${t.dpsSeries} ~ '^[0-9]{1,5}$'`),
    check("client_nfse_issuers_next_check", sql`${t.nextDpsNumber} >= 1`),
  ],
);

/** Os clientes da empresa emissora: quem recebe as notas dela. */
export const clientNfseTakers = pgTable(
  "client_nfse_takers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    issuerId: uuid("issuer_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    /** CPF (11) ou CNPJ (14), só dígitos. */
    document: varchar("document", { length: 14 }).notNull(),
    address: jsonb("address").$type<AddressJson>(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_nfse_takers_org_issuer_fk",
      columns: [t.orgId, t.issuerId],
      foreignColumns: [clientNfseIssuers.orgId, clientNfseIssuers.id],
    }).onDelete("cascade"),
    uniqueIndex("client_nfse_takers_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("client_nfse_takers_org_issuer_id_uidx").on(t.orgId, t.issuerId, t.id),
    uniqueIndex("client_nfse_takers_org_issuer_document_uidx").on(t.orgId, t.issuerId, t.document),
    check("client_nfse_takers_document_check", sql`${t.document} ~ '^([0-9]{11}|[0-9]{14})$'`),
    check("client_nfse_takers_name_check", sql`length(btrim(${t.name})) > 0`),
  ],
);

/**
 * A nota padrão: o que se repete todo mês. A FK composta com o emissor
 * garante que o tomador é DESTA empresa.
 */
export const clientNfseModels = pgTable(
  "client_nfse_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    issuerId: uuid("issuer_id").notNull(),
    takerId: uuid("taker_id").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    /** Com os marcadores {mes}/{competencia} e {ano}. */
    description: text("description").notNull(),
    reference: clientNfseReference("reference").notNull().default("previous"),
    /** Serviço próprio desta nota; null usa o do modelo fiscal do emissor. */
    service: jsonb("service").$type<{ nationalTaxCode: string; municipalTaxCode?: string; nbsCode?: string }>(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_nfse_models_org_issuer_taker_fk",
      columns: [t.orgId, t.issuerId, t.takerId],
      foreignColumns: [clientNfseTakers.orgId, clientNfseTakers.issuerId, clientNfseTakers.id],
    }).onDelete("cascade"),
    uniqueIndex("client_nfse_models_org_id_uidx").on(t.orgId, t.id),
    index("client_nfse_models_org_issuer_idx").on(t.orgId, t.issuerId),
    check("client_nfse_models_amount_check", sql`${t.amount} >= 0`),
    check("client_nfse_models_description_check", sql`length(btrim(${t.description})) BETWEEN 1 AND 2000`),
  ],
);

/**
 * A nota do mês: nasce da nota padrão ao abrir o mês, com valor e descrição
 * já resolvidos e editáveis só para este mês.
 */
export const clientNfseItems = pgTable(
  "client_nfse_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    modelId: uuid("model_id").notNull(),
    issuerId: uuid("issuer_id").notNull(),
    takerId: uuid("taker_id").notNull(),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    description: text("description").notNull(),
    createdBy: text("created_by").references(() => user.id),
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_nfse_items_org_model_fk",
      columns: [t.orgId, t.modelId],
      foreignColumns: [clientNfseModels.orgId, clientNfseModels.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "client_nfse_items_org_issuer_taker_fk",
      columns: [t.orgId, t.issuerId, t.takerId],
      foreignColumns: [clientNfseTakers.orgId, clientNfseTakers.issuerId, clientNfseTakers.id],
    }).onDelete("cascade"),
    uniqueIndex("client_nfse_items_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("client_nfse_items_org_model_period_uidx").on(t.orgId, t.modelId, t.periodYear, t.periodMonth),
    index("client_nfse_items_org_period_idx").on(t.orgId, t.periodYear, t.periodMonth),
    check("client_nfse_items_amount_check", sql`${t.amount} >= 0`),
    check("client_nfse_items_month_check", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check("client_nfse_items_description_check", sql`length(${t.description}) <= 2000`),
  ],
);

/**
 * A fila das notas dos clientes, no formato de nfse_invoices: o pedido
 * congela tomador, modelo fiscal e número da DPS. Aponta para emissor, tomador
 * e item SEM cascata: com nota pedida, o banco recusa apagar o cadastro.
 */
export const clientNfseInvoices = pgTable(
  "client_nfse_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    issuerId: uuid("issuer_id").notNull(),
    clientId: uuid("client_id").notNull(),
    takerId: uuid("taker_id").notNull(),
    itemId: uuid("item_id").notNull(),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    providerCnpj: varchar("provider_cnpj", { length: 14 }).notNull(),
    /** Modelo fiscal do emissor com o serviço da nota, congelado no pedido. */
    template: jsonb("template").notNull(),
    takerDocument: varchar("taker_document", { length: 14 }).notNull(),
    takerName: varchar("taker_name", { length: 300 }).notNull(),
    takerAddress: jsonb("taker_address").$type<{
      cityCode: string;
      zipCode: string;
      street: string;
      number: string;
      complement: string | null;
      district: string;
    }>(),
    description: varchar("description", { length: 2000 }).notNull(),
    dpsSeries: varchar("dps_series", { length: 5 }).notNull(),
    dpsNumber: bigint("dps_number", { mode: "number" }).notNull(),
    dpsId: varchar("dps_id", { length: 45 }).notNull(),
    status: nfseInvoiceStatus("status").notNull().default("queued"),
    environment: smallint("environment"),
    accessKey: varchar("access_key", { length: 50 }),
    nfseNumber: varchar("nfse_number", { length: 20 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    /** O XML da NFS-e emitida, para o PDF (o certificado é da empresa, não do escritório). */
    xmlGz: bytea("xml_gz"),
    lastError: text("last_error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockToken: uuid("lock_token"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    cancelRequestedBy: text("cancel_requested_by").references(() => user.id),
    cancelReasonCode: smallint("cancel_reason_code"),
    cancelReasonText: varchar("cancel_reason_text", { length: 255 }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_nfse_invoices_org_item_fk",
      columns: [t.orgId, t.itemId],
      foreignColumns: [clientNfseItems.orgId, clientNfseItems.id],
    }),
    foreignKey({
      name: "client_nfse_invoices_org_issuer_taker_fk",
      columns: [t.orgId, t.issuerId, t.takerId],
      foreignColumns: [clientNfseTakers.orgId, clientNfseTakers.issuerId, clientNfseTakers.id],
    }),
    foreignKey({
      name: "client_nfse_invoices_org_client_fk",
      columns: [t.orgId, t.clientId],
      foreignColumns: [clients.orgId, clients.id],
    }),
    uniqueIndex("client_nfse_invoices_org_id_uidx").on(t.orgId, t.id),
    uniqueIndex("client_nfse_invoices_org_dps_uidx").on(t.orgId, t.issuerId, t.dpsSeries, t.dpsNumber),
    uniqueIndex("client_nfse_invoices_active_item_uidx")
      .on(t.orgId, t.itemId)
      .where(sql`status <> 'cancelled'`),
    index("client_nfse_invoices_org_period_idx").on(t.orgId, t.periodYear, t.periodMonth),
    index("client_nfse_invoices_pending_idx")
      .on(t.orgId, t.nextAttemptAt)
      .where(sql`status IN ('queued', 'cancel_requested')`),
    check("client_nfse_invoices_amount_check", sql`${t.amount} > 0`),
    check("client_nfse_invoices_month_check", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check("client_nfse_invoices_document_check", sql`${t.takerDocument} ~ '^([0-9]{11}|[0-9]{14})$'`),
    check(
      "client_nfse_invoices_cancel_reason_check",
      sql`${t.cancelReasonCode} IS NULL OR ${t.cancelReasonCode} IN (1, 2, 9)`,
    ),
    check("client_nfse_invoices_environment_check", sql`${t.environment} IS NULL OR ${t.environment} IN (1, 2)`),
    check(
      "client_nfse_invoices_access_key_check",
      sql`${t.status} NOT IN ('issued', 'cancel_requested', 'cancelled') OR ${t.accessKey} IS NOT NULL`,
    ),
  ],
);

/** Histórico das notas dos clientes — só acréscimo. actor_id nulo = serviço fiscal. */
export const clientNfseInvoiceEvents = pgTable(
  "client_nfse_invoice_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    eventType: nfseInvoiceEventType("event_type").notNull(),
    actorId: text("actor_id").references(() => user.id),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "client_nfse_invoice_events_org_invoice_fk",
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [clientNfseInvoices.orgId, clientNfseInvoices.id],
    }).onDelete("cascade"),
    index("client_nfse_invoice_events_org_invoice_idx").on(t.orgId, t.invoiceId, t.createdAt),
  ],
);

export type ClientNfseIssuer = typeof clientNfseIssuers.$inferSelect;
export type ClientNfseTaker = typeof clientNfseTakers.$inferSelect;
export type ClientNfseModel = typeof clientNfseModels.$inferSelect;
export type ClientNfseItem = typeof clientNfseItems.$inferSelect;
export type ClientNfseInvoice = typeof clientNfseInvoices.$inferSelect;
