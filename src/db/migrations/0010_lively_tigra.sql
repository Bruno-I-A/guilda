CREATE TYPE "public"."closing_cadence" AS ENUM('quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."closing_period" AS ENUM('q1', 'q2', 'q3', 'q4', 'annual');--> statement-breakpoint
ALTER TYPE "public"."tax_regime" ADD VALUE 'association' BEFORE 'real';--> statement-breakpoint
CREATE TABLE "accounting_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"period" "closing_period" NOT NULL,
	"completed_by" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "closing_cadence" "closing_cadence" DEFAULT 'quarterly' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD CONSTRAINT "accounting_closings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD CONSTRAINT "accounting_closings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD CONSTRAINT "accounting_closings_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_closings_org_year_idx" ON "accounting_closings" USING btree ("org_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_closings_org_client_year_period_uidx" ON "accounting_closings" USING btree ("org_id","client_id","year","period");