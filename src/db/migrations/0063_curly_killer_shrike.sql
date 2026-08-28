CREATE TABLE "client_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"created_by" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'processing' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_import_batches" ADD CONSTRAINT "client_import_batches_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_import_batches" ADD CONSTRAINT "client_import_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_import_batches_org_created_idx" ON "client_import_batches" USING btree ("org_id","created_at");
--> statement-breakpoint
ALTER TABLE "client_import_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "client_import_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "client_import_batches_org_isolation" ON "client_import_batches"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "client_import_batches" TO guilda_app;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "trade_name" varchar(200);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "operational_email" varchar(200);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "operational_phone" varchar(20);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "revenue_email" varchar(200);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "revenue_phones" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" jsonb;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cadastral_situation" varchar(80);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cadastral_situation_date" date;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "company_size" varchar(120);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "legal_nature" varchar(200);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "share_capital" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "headquarters_type" varchar(40);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "qsa" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tax_regime_history" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cnpj_synced_at" timestamp with time zone;
--> statement-breakpoint

-- Exclusivamente para a virada autorizada da base de testes para a base real.
-- A função é tenant-safe e a chamada da aplicação ainda exige owner/admin e
-- a frase exata de confirmação. Tudo ocorre na mesma transação dos inserts.
CREATE OR REPLACE FUNCTION reset_org_operational_data_for_launch(p_org_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_org_id IS NULL OR p_org_id = '' OR
     p_org_id IS DISTINCT FROM current_setting('app.org_id', true) THEN
    RAISE EXCEPTION 'Organização inválida para a limpeza';
  END IF;

  DELETE FROM company_flow_events WHERE org_id = p_org_id;
  DELETE FROM company_flow_secrets WHERE org_id = p_org_id;
  DELETE FROM company_flows WHERE org_id = p_org_id;
  DELETE FROM guild_notice_reads WHERE org_id = p_org_id;
  DELETE FROM guild_notices WHERE org_id = p_org_id;
  DELETE FROM telegram_outbox WHERE org_id = p_org_id;
  DELETE FROM xp_ledger WHERE org_id = p_org_id;
  DELETE FROM task_assignee_suggestions WHERE org_id = p_org_id;
  DELETE FROM task_transfers WHERE org_id = p_org_id;
  DELETE FROM task_events WHERE org_id = p_org_id;
  DELETE FROM tasks WHERE org_id = p_org_id;
  DELETE FROM informatives WHERE org_id = p_org_id;
  DELETE FROM fiscal_control_events WHERE org_id = p_org_id;
  DELETE FROM fiscal_control_periods WHERE org_id = p_org_id;
  DELETE FROM office_fee_control_events WHERE org_id = p_org_id;
  DELETE FROM office_fee_control_periods WHERE org_id = p_org_id;
  DELETE FROM fiscal_client_profile_events WHERE org_id = p_org_id;
  DELETE FROM fiscal_client_aliases WHERE org_id = p_org_id;
  DELETE FROM fiscal_client_profiles WHERE org_id = p_org_id;
  DELETE FROM office_fee_profile_events WHERE org_id = p_org_id;
  DELETE FROM office_fee_profiles WHERE org_id = p_org_id;
  DELETE FROM fiscal_installment_issuances WHERE org_id = p_org_id;
  DELETE FROM fiscal_installments WHERE org_id = p_org_id;
  DELETE FROM fiscal_import_rows WHERE org_id = p_org_id;
  DELETE FROM fiscal_import_batches WHERE org_id = p_org_id;
  DELETE FROM fiscal_portfolio_events WHERE org_id = p_org_id;
  DELETE FROM fiscal_portfolios WHERE org_id = p_org_id;
  DELETE FROM client_commitment_periods WHERE org_id = p_org_id;
  DELETE FROM client_commitments WHERE org_id = p_org_id;
  DELETE FROM accounting_closings WHERE org_id = p_org_id;
  DELETE FROM accounting_closing_years WHERE org_id = p_org_id;
  DELETE FROM clan_campaigns WHERE org_id = p_org_id;
  DELETE FROM client_import_batches WHERE org_id = p_org_id;
  DELETE FROM clients WHERE org_id = p_org_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION reset_org_operational_data_for_launch(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION reset_org_operational_data_for_launch(text) TO guilda_app;
