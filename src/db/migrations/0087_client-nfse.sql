CREATE TYPE "public"."client_nfse_reference" AS ENUM('previous', 'current');--> statement-breakpoint
CREATE TABLE "client_nfse_invoice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"event_type" "nfse_invoice_event_type" NOT NULL,
	"actor_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "client_nfse_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"issuer_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"taker_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"provider_cnpj" varchar(14) NOT NULL,
	"template" jsonb NOT NULL,
	"taker_document" varchar(14) NOT NULL,
	"taker_name" varchar(300) NOT NULL,
	"taker_address" jsonb,
	"description" varchar(2000) NOT NULL,
	"dps_series" varchar(5) NOT NULL,
	"dps_number" bigint NOT NULL,
	"dps_id" varchar(45) NOT NULL,
	"status" "nfse_invoice_status" DEFAULT 'queued' NOT NULL,
	"environment" smallint,
	"access_key" varchar(50),
	"nfse_number" varchar(20),
	"issued_at" timestamp with time zone,
	"xml_gz" "bytea",
	"last_error" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"requested_by" text NOT NULL,
	"cancel_requested_by" text,
	"cancel_reason_code" smallint,
	"cancel_reason_text" varchar(255),
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_nfse_invoices_amount_check" CHECK ("client_nfse_invoices"."amount" > 0),
	CONSTRAINT "client_nfse_invoices_month_check" CHECK ("client_nfse_invoices"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "client_nfse_invoices_document_check" CHECK ("client_nfse_invoices"."taker_document" ~ '^([0-9]{11}|[0-9]{14})$'),
	CONSTRAINT "client_nfse_invoices_cancel_reason_check" CHECK ("client_nfse_invoices"."cancel_reason_code" IS NULL OR "client_nfse_invoices"."cancel_reason_code" IN (1, 2, 9)),
	CONSTRAINT "client_nfse_invoices_environment_check" CHECK ("client_nfse_invoices"."environment" IS NULL OR "client_nfse_invoices"."environment" IN (1, 2)),
	CONSTRAINT "client_nfse_invoices_access_key_check" CHECK ("client_nfse_invoices"."status" NOT IN ('issued', 'cancel_requested', 'cancelled') OR "client_nfse_invoices"."access_key" IS NOT NULL)
);--> statement-breakpoint
CREATE TABLE "client_nfse_issuers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"template" jsonb NOT NULL,
	"dps_series" varchar(5) NOT NULL,
	"next_dps_number" bigint DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_nfse_issuers_series_check" CHECK ("client_nfse_issuers"."dps_series" ~ '^[0-9]{1,5}$'),
	CONSTRAINT "client_nfse_issuers_next_check" CHECK ("client_nfse_issuers"."next_dps_number" >= 1)
);--> statement-breakpoint
CREATE TABLE "client_nfse_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"model_id" uuid NOT NULL,
	"issuer_id" uuid NOT NULL,
	"taker_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" text NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_nfse_items_amount_check" CHECK ("client_nfse_items"."amount" >= 0),
	CONSTRAINT "client_nfse_items_month_check" CHECK ("client_nfse_items"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "client_nfse_items_description_check" CHECK (length("client_nfse_items"."description") <= 2000)
);--> statement-breakpoint
CREATE TABLE "client_nfse_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"issuer_id" uuid NOT NULL,
	"taker_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" text NOT NULL,
	"reference" "client_nfse_reference" DEFAULT 'previous' NOT NULL,
	"service" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_nfse_models_amount_check" CHECK ("client_nfse_models"."amount" >= 0),
	CONSTRAINT "client_nfse_models_description_check" CHECK (length(btrim("client_nfse_models"."description")) BETWEEN 1 AND 2000)
);--> statement-breakpoint
CREATE TABLE "client_nfse_takers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"issuer_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"document" varchar(14) NOT NULL,
	"address" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_nfse_takers_document_check" CHECK ("client_nfse_takers"."document" ~ '^([0-9]{11}|[0-9]{14})$'),
	CONSTRAINT "client_nfse_takers_name_check" CHECK (length(btrim("client_nfse_takers"."name")) > 0)
);--> statement-breakpoint
CREATE INDEX "client_nfse_invoice_events_org_invoice_idx" ON "client_nfse_invoice_events" USING btree ("org_id","invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_invoices_org_id_uidx" ON "client_nfse_invoices" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_invoices_org_dps_uidx" ON "client_nfse_invoices" USING btree ("org_id","issuer_id","dps_series","dps_number");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_invoices_active_item_uidx" ON "client_nfse_invoices" USING btree ("org_id","item_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "client_nfse_invoices_org_period_idx" ON "client_nfse_invoices" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "client_nfse_invoices_pending_idx" ON "client_nfse_invoices" USING btree ("org_id","next_attempt_at") WHERE status IN ('queued', 'cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_issuers_org_id_uidx" ON "client_nfse_issuers" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_issuers_org_client_uidx" ON "client_nfse_issuers" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_items_org_id_uidx" ON "client_nfse_items" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_items_org_model_period_uidx" ON "client_nfse_items" USING btree ("org_id","model_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "client_nfse_items_org_period_idx" ON "client_nfse_items" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_models_org_id_uidx" ON "client_nfse_models" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "client_nfse_models_org_issuer_idx" ON "client_nfse_models" USING btree ("org_id","issuer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_takers_org_id_uidx" ON "client_nfse_takers" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_takers_org_issuer_id_uidx" ON "client_nfse_takers" USING btree ("org_id","issuer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_takers_org_issuer_document_uidx" ON "client_nfse_takers" USING btree ("org_id","issuer_id","document");--> statement-breakpoint
ALTER TABLE "client_nfse_invoice_events" ADD CONSTRAINT "client_nfse_invoice_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoice_events" ADD CONSTRAINT "client_nfse_invoice_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoice_events" ADD CONSTRAINT "client_nfse_invoice_events_org_invoice_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."client_nfse_invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD CONSTRAINT "client_nfse_invoices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD CONSTRAINT "client_nfse_invoices_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD CONSTRAINT "client_nfse_invoices_cancel_requested_by_user_id_fk" FOREIGN KEY ("cancel_requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD CONSTRAINT "client_nfse_invoices_org_item_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."client_nfse_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD CONSTRAINT "client_nfse_invoices_org_issuer_taker_fk" FOREIGN KEY ("org_id","issuer_id","taker_id") REFERENCES "public"."client_nfse_takers"("org_id","issuer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD CONSTRAINT "client_nfse_invoices_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_issuers" ADD CONSTRAINT "client_nfse_issuers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_issuers" ADD CONSTRAINT "client_nfse_issuers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_issuers" ADD CONSTRAINT "client_nfse_issuers_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_issuers" ADD CONSTRAINT "client_nfse_issuers_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_items" ADD CONSTRAINT "client_nfse_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_items" ADD CONSTRAINT "client_nfse_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_items" ADD CONSTRAINT "client_nfse_items_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_items" ADD CONSTRAINT "client_nfse_items_org_model_fk" FOREIGN KEY ("org_id","model_id") REFERENCES "public"."client_nfse_models"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_items" ADD CONSTRAINT "client_nfse_items_org_issuer_taker_fk" FOREIGN KEY ("org_id","issuer_id","taker_id") REFERENCES "public"."client_nfse_takers"("org_id","issuer_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_models" ADD CONSTRAINT "client_nfse_models_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_models" ADD CONSTRAINT "client_nfse_models_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_models" ADD CONSTRAINT "client_nfse_models_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_models" ADD CONSTRAINT "client_nfse_models_org_issuer_taker_fk" FOREIGN KEY ("org_id","issuer_id","taker_id") REFERENCES "public"."client_nfse_takers"("org_id","issuer_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_takers" ADD CONSTRAINT "client_nfse_takers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_takers" ADD CONSTRAINT "client_nfse_takers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_takers" ADD CONSTRAINT "client_nfse_takers_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_takers" ADD CONSTRAINT "client_nfse_takers_org_issuer_fk" FOREIGN KEY ("org_id","issuer_id") REFERENCES "public"."client_nfse_issuers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Notas dos clientes: isolamento por organizacao (decisao de 2026-10-22).
-- Indices unicos antes das FKs compostas que dependem deles.
ALTER TABLE "client_nfse_issuers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_nfse_issuers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_nfse_issuers"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "client_nfse_takers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_nfse_takers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_nfse_takers"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "client_nfse_models" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_nfse_models" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_nfse_models"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "client_nfse_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_nfse_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_nfse_items"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_nfse_invoices"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "client_nfse_invoice_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_nfse_invoice_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation_select" ON "client_nfse_invoice_events"
  FOR SELECT USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation_insert" ON "client_nfse_invoice_events"
  FOR INSERT WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges
-- (docker/*/init/01-roles): GRANT sozinho nao restringe nada. Cadastro e
-- itens do mes se editam e se apagam (a nota sem cascata segura o que tem
-- nota). Nota nao se apaga e so muda as colunas do ciclo de vida; historico
-- e so acrescimo. Cascata das FKs roda como dono.
GRANT SELECT, INSERT ON "client_nfse_invoices" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "client_nfse_invoices" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "environment", "access_key", "nfse_number", "issued_at", "xml_gz", "last_error", "attempt_count", "next_attempt_at", "locked_at", "lock_token", "taker_address", "dps_series", "dps_number", "dps_id", "cancel_requested_by", "cancel_reason_code", "cancel_reason_text", "cancelled_at", "updated_at") ON "client_nfse_invoices" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "client_nfse_invoice_events" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "client_nfse_invoice_events" FROM guilda_app;
