CREATE TABLE "office_fee_takers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"document" varchar(14) NOT NULL,
	"address" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_fee_takers_document_check" CHECK ("office_fee_takers"."document" ~ '^([0-9]{11}|[0-9]{14})$'),
	CONSTRAINT "office_fee_takers_name_check" CHECK (length(btrim("office_fee_takers"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "nfse_invoices" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD COLUMN "taker_id" uuid;--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ADD COLUMN "taker_id" uuid;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD COLUMN "taker_id" uuid;--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ADD COLUMN "taker_id" uuid;--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ADD COLUMN "taker_id" uuid;--> statement-breakpoint
ALTER TABLE "office_fee_takers" ADD CONSTRAINT "office_fee_takers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_takers" ADD CONSTRAINT "office_fee_takers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_takers" ADD CONSTRAINT "office_fee_takers_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_takers_org_id_uidx" ON "office_fee_takers" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_takers_org_document_uidx" ON "office_fee_takers" USING btree ("org_id","document");--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD CONSTRAINT "nfse_invoices_org_taker_fk" FOREIGN KEY ("org_id","taker_id") REFERENCES "public"."office_fee_takers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ADD CONSTRAINT "office_fee_control_events_org_taker_fk" FOREIGN KEY ("org_id","taker_id") REFERENCES "public"."office_fee_takers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_org_taker_fk" FOREIGN KEY ("org_id","taker_id") REFERENCES "public"."office_fee_takers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ADD CONSTRAINT "office_fee_profile_events_org_taker_fk" FOREIGN KEY ("org_id","taker_id") REFERENCES "public"."office_fee_takers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ADD CONSTRAINT "office_fee_profiles_org_taker_fk" FOREIGN KEY ("org_id","taker_id") REFERENCES "public"."office_fee_takers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_invoices_taker_active_monthly_uidx" ON "nfse_invoices" USING btree ("org_id","taker_id","period_year","period_month") WHERE kind = 'monthly' AND status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_invoices_taker_active_additional_uidx" ON "nfse_invoices" USING btree ("org_id","taker_id","period_year") WHERE kind = 'additional_installment' AND status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_control_periods_org_taker_period_uidx" ON "office_fee_control_periods" USING btree ("org_id","taker_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_profiles_org_taker_uidx" ON "office_fee_profiles" USING btree ("org_id","taker_id");--> statement-breakpoint
ALTER TABLE "nfse_invoices" ADD CONSTRAINT "nfse_invoices_payer_check" CHECK (num_nonnulls("nfse_invoices"."client_id", "nfse_invoices"."taker_id") = 1);--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ADD CONSTRAINT "office_fee_control_events_payer_check" CHECK (num_nonnulls("office_fee_control_events"."client_id", "office_fee_control_events"."taker_id") = 1);--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_payer_check" CHECK (num_nonnulls("office_fee_control_periods"."client_id", "office_fee_control_periods"."taker_id") = 1);--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ADD CONSTRAINT "office_fee_profile_events_payer_check" CHECK (num_nonnulls("office_fee_profile_events"."client_id", "office_fee_profile_events"."taker_id") = 1);--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ADD CONSTRAINT "office_fee_profiles_payer_check" CHECK (num_nonnulls("office_fee_profiles"."client_id", "office_fee_profiles"."taker_id") = 1);--> statement-breakpoint
ALTER TABLE "office_fee_takers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "office_fee_takers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "office_fee_takers"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges
-- (docker/*/init/01-roles): GRANT sozinho nao restringe nada. Tomador avulso
-- se desativa, nao se apaga: a cascata levaria as notas emitidas junto.
GRANT SELECT, INSERT, UPDATE ON "office_fee_takers" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "office_fee_takers" FROM guilda_app;
