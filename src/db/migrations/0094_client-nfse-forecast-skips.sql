CREATE TABLE "client_nfse_forecast_skips" (
	"org_id" text NOT NULL,
	"issuer_id" uuid NOT NULL,
	"source_access_key" varchar(50) NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_nfse_forecast_skips_org_id_issuer_id_source_access_key_period_year_period_month_pk" PRIMARY KEY("org_id","issuer_id","source_access_key","period_year","period_month"),
	CONSTRAINT "client_nfse_forecast_skips_month_check" CHECK ("client_nfse_forecast_skips"."period_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "client_nfse_forecast_skips" ADD CONSTRAINT "client_nfse_forecast_skips_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_forecast_skips" ADD CONSTRAINT "client_nfse_forecast_skips_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_nfse_forecast_skips" ADD CONSTRAINT "client_nfse_forecast_skips_org_issuer_fk" FOREIGN KEY ("org_id","issuer_id") REFERENCES "public"."client_nfse_issuers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_nfse_forecast_skips_org_period_idx" ON "client_nfse_forecast_skips" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
ALTER TABLE "client_nfse_forecast_skips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_nfse_forecast_skips" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_nfse_forecast_skips"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));
