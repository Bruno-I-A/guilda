CREATE TYPE "public"."nfse_invoice_event_type" AS ENUM('requested', 'issued', 'failed', 'retried', 'cancel_requested', 'cancelled', 'cancel_failed');--> statement-breakpoint
CREATE TYPE "public"."nfse_invoice_kind" AS ENUM('monthly', 'additional_installment');--> statement-breakpoint
CREATE TYPE "public"."nfse_invoice_status" AS ENUM('queued', 'issued', 'failed', 'cancel_requested', 'cancelled');--> statement-breakpoint
CREATE TABLE "nfse_invoice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"event_type" "nfse_invoice_event_type" NOT NULL,
	"actor_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfse_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"control_period_id" uuid NOT NULL,
	"kind" "nfse_invoice_kind" NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"taker_cnpj" varchar(14) NOT NULL,
	"taker_name" varchar(300) NOT NULL,
	"description" varchar(2000) NOT NULL,
	"dps_series" varchar(5) NOT NULL,
	"dps_number" bigint NOT NULL,
	"dps_id" varchar(45) NOT NULL,
	"status" "nfse_invoice_status" DEFAULT 'queued' NOT NULL,
	"environment" smallint,
	"access_key" varchar(50),
	"nfse_number" varchar(20),
	"issued_at" timestamp with time zone,
	"last_error" text,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
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
	CONSTRAINT "nfse_invoices_amount_check" CHECK ("nfse_invoices"."amount" > 0),
	CONSTRAINT "nfse_invoices_month_check" CHECK ("nfse_invoices"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "nfse_invoices_cancel_reason_check" CHECK ("nfse_invoices"."cancel_reason_code" IS NULL OR "nfse_invoices"."cancel_reason_code" IN (1, 2, 9)),
	CONSTRAINT "nfse_invoices_environment_check" CHECK ("nfse_invoices"."environment" IS NULL OR "nfse_invoices"."environment" IN (1, 2)),
	CONSTRAINT "nfse_invoices_access_key_check" CHECK ("nfse_invoices"."status" NOT IN ('issued', 'cancel_requested', 'cancelled') OR "nfse_invoices"."access_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "nfse_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"provider_cnpj" varchar(14) NOT NULL,
	"template" jsonb,
	"dps_series" varchar(5) NOT NULL,
	"next_dps_number" bigint DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"service_seen_at" timestamp with time zone,
	"service_environment" smallint,
	"certificate_valid_until" timestamp with time zone,
	"service_error" text,
	CONSTRAINT "nfse_settings_provider_cnpj_check" CHECK ("nfse_settings"."provider_cnpj" ~ '^[0-9]{14}$'),
	CONSTRAINT "nfse_settings_dps_series_check" CHECK ("nfse_settings"."dps_series" ~ '^[0-9]{1,5}$'),
	CONSTRAINT "nfse_settings_next_dps_number_check" CHECK ("nfse_settings"."next_dps_number" >= 1)
);
--> statement-breakpoint
-- O indice unico (org_id, id) precisa existir antes da FK composta do historico.
CREATE UNIQUE INDEX "nfse_invoices_org_id_uidx" ON "nfse_invoices" USING btree ("org_id","id");--> statement-breakpoint
ALTER TABLE "nfse_invoice_events" ADD CONSTRAINT "nfse_invoice_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_invoice_events" ADD CONSTRAINT "nfse_invoice_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_invoice_events" ADD CONSTRAINT "nfse_invoice_events_org_invoice_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."nfse_invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD CONSTRAINT "nfse_invoices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD CONSTRAINT "nfse_invoices_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD CONSTRAINT "nfse_invoices_cancel_requested_by_user_id_fk" FOREIGN KEY ("cancel_requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD CONSTRAINT "nfse_invoices_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD CONSTRAINT "nfse_invoices_org_control_fk" FOREIGN KEY ("org_id","control_period_id") REFERENCES "public"."office_fee_control_periods"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_settings" ADD CONSTRAINT "nfse_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_settings" ADD CONSTRAINT "nfse_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nfse_invoice_events_org_invoice_idx" ON "nfse_invoice_events" USING btree ("org_id","invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_invoices_org_dps_uidx" ON "nfse_invoices" USING btree ("org_id","dps_series","dps_number");--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_invoices_active_monthly_uidx" ON "nfse_invoices" USING btree ("org_id","client_id","period_year","period_month") WHERE kind = 'monthly' AND status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_invoices_active_additional_uidx" ON "nfse_invoices" USING btree ("org_id","client_id","period_year") WHERE kind = 'additional_installment' AND status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "nfse_invoices_org_period_idx" ON "nfse_invoices" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "nfse_invoices_pending_idx" ON "nfse_invoices" USING btree ("org_id","next_attempt_at") WHERE status IN ('queued', 'cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_settings_provider_cnpj_uidx" ON "nfse_settings" USING btree ("provider_cnpj");
--> statement-breakpoint
-- Notas de honorário: isolamento por organização (decisão de 2026-10-10).
ALTER TABLE "nfse_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_settings"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_invoices"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_invoice_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_invoice_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation_select" ON "nfse_invoice_events"
  FOR SELECT USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation_insert" ON "nfse_invoice_events"
  FOR INSERT WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges
-- (docker/*/init/01-roles): GRANT sozinho nao restringe nada.
-- Configuracao nao se apaga; nota nao se apaga e so muda as colunas do
-- ciclo de vida; historico e so acrescimo. Cascata das FKs roda como dono.
GRANT SELECT, INSERT, UPDATE ON "nfse_settings" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_settings" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "nfse_invoices" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "nfse_invoices" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "environment", "access_key", "nfse_number", "issued_at", "last_error", "attempt_count", "next_attempt_at", "locked_at", "lock_token", "cancel_requested_by", "cancel_reason_code", "cancel_reason_text", "cancelled_at", "updated_at") ON "nfse_invoices" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "nfse_invoice_events" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "nfse_invoice_events" FROM guilda_app;--> statement-breakpoint
-- Batimento do servico fiscal: localiza a organizacao pelo CNPJ do
-- certificado (unico entre organizacoes) e devolve o org_id. E a unica
-- consulta que atravessa organizacoes; o resto roda em withOrgTx.
CREATE OR REPLACE FUNCTION public.nfse_register_service(
  p_cnpj text,
  p_environment smallint,
  p_certificate_valid_until timestamptz,
  p_error text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org text;
BEGIN
  IF p_cnpj IS NULL OR p_cnpj !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'CNPJ do certificado invalido';
  END IF;
  IF p_environment IS NULL OR p_environment NOT IN (1, 2) THEN
    RAISE EXCEPTION 'ambiente invalido';
  END IF;
  UPDATE public.nfse_settings
     SET service_seen_at = statement_timestamp(),
         service_environment = p_environment,
         certificate_valid_until = p_certificate_valid_until,
         service_error = left(NULLIF(p_error, ''), 500)
   WHERE provider_cnpj = p_cnpj
  RETURNING org_id INTO v_org;
  RETURN v_org;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.nfse_register_service(text, smallint, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.nfse_register_service(text, smallint, timestamptz, text) TO guilda_app;
