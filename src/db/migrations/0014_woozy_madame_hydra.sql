CREATE TABLE "accounting_closing_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"notes" text,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"defis_notes" text,
	"defis_completed_at" timestamp with time zone,
	"defis_completed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_closing_years" ADD CONSTRAINT "accounting_closing_years_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_closing_years" ADD CONSTRAINT "accounting_closing_years_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_closing_years" ADD CONSTRAINT "accounting_closing_years_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_closing_years" ADD CONSTRAINT "accounting_closing_years_defis_completed_by_user_id_fk" FOREIGN KEY ("defis_completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_closing_years_org_client_year_uidx" ON "accounting_closing_years" USING btree ("org_id","client_id","year");--> statement-breakpoint
CREATE INDEX "accounting_closing_years_org_year_idx" ON "accounting_closing_years" USING btree ("org_id","year");--> statement-breakpoint
ALTER TABLE "accounting_closing_years" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "accounting_closing_years"
  USING ("org_id" = current_setting('app.org_id', true));
