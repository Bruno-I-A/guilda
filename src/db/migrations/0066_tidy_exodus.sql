CREATE TYPE "public"."mei_declaration_status" AS ENUM('pending', 'in_progress', 'submitted');--> statement-breakpoint
CREATE TABLE "mei_annual_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"status" "mei_declaration_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" date,
	"notes" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mei_annual_declarations_year_check" CHECK ("mei_annual_declarations"."year" BETWEEN 2000 AND 2100),
	CONSTRAINT "mei_annual_declarations_submission_check" CHECK (("mei_annual_declarations"."status" = 'submitted' AND "mei_annual_declarations"."submitted_at" IS NOT NULL) OR ("mei_annual_declarations"."status" <> 'submitted' AND "mei_annual_declarations"."submitted_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "mei_annual_declarations" ADD CONSTRAINT "mei_annual_declarations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mei_annual_declarations" ADD CONSTRAINT "mei_annual_declarations_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mei_annual_declarations" ADD CONSTRAINT "mei_annual_declarations_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mei_annual_declarations_org_client_year_uidx" ON "mei_annual_declarations" USING btree ("org_id","client_id","year");--> statement-breakpoint
CREATE INDEX "mei_annual_declarations_org_year_status_idx" ON "mei_annual_declarations" USING btree ("org_id","year","status");--> statement-breakpoint
ALTER TABLE "mei_annual_declarations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mei_annual_declarations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mei_annual_declarations_org_isolation" ON "mei_annual_declarations"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mei_annual_declarations" TO guilda_app;
