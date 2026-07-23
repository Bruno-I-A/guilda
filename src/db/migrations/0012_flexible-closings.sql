CREATE TYPE "public"."closing_status" AS ENUM('pending', 'blocked', 'completed');--> statement-breakpoint

ALTER TABLE "accounting_closings" ADD COLUMN "title" varchar(160);--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "status" "closing_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Converte eventuais marcações do modelo antigo em fechamentos livres já
-- concluídos, preservando responsável e data.
UPDATE "accounting_closings"
SET
  "title" = CASE "period"
    WHEN 'q1' THEN 'Fechamento do 1º trimestre'
    WHEN 'q2' THEN 'Fechamento do 2º trimestre'
    WHEN 'q3' THEN 'Fechamento do 3º trimestre'
    WHEN 'q4' THEN 'Fechamento do 4º trimestre'
    ELSE 'Fechamento anual'
  END,
  "due_date" = CASE "period"
    WHEN 'q1' THEN make_date("year", 3, 31)
    WHEN 'q2' THEN make_date("year", 6, 30)
    WHEN 'q3' THEN make_date("year", 9, 30)
    ELSE make_date("year", 12, 31)
  END,
  "status" = 'completed',
  "created_by" = "completed_by",
  "created_at" = "completed_at",
  "updated_at" = "completed_at";--> statement-breakpoint

ALTER TABLE "accounting_closings" ALTER COLUMN "title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_closings" ALTER COLUMN "due_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_closings" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_closings" ALTER COLUMN "completed_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_closings" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint

DROP INDEX "accounting_closings_org_year_idx";--> statement-breakpoint
DROP INDEX "accounting_closings_org_client_year_period_uidx";--> statement-breakpoint
ALTER TABLE "accounting_closings" DROP COLUMN "year";--> statement-breakpoint
ALTER TABLE "accounting_closings" DROP COLUMN "period";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "closing_cadence";--> statement-breakpoint

ALTER TABLE "accounting_closings"
  ADD CONSTRAINT "accounting_closings_created_by_user_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_closings_org_due_date_idx"
  ON "accounting_closings" USING btree ("org_id", "due_date");--> statement-breakpoint
CREATE INDEX "accounting_closings_org_client_idx"
  ON "accounting_closings" USING btree ("org_id", "client_id");--> statement-breakpoint

DROP TYPE "public"."closing_cadence";--> statement-breakpoint
DROP TYPE "public"."closing_period";
