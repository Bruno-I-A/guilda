ALTER TABLE "fiscal_installments" ADD COLUMN "paid_installments" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "fiscal_installments" ADD COLUMN "total_installments" integer;
--> statement-breakpoint
UPDATE "fiscal_installments"
SET
  "paid_installments" = LEAST(
    ((regexp_match("installment_number", '([0-9]+)\s*/\s*([0-9]+)'))[1])::integer,
    ((regexp_match("installment_number", '([0-9]+)\s*/\s*([0-9]+)'))[2])::integer
  ),
  "total_installments" = ((regexp_match("installment_number", '([0-9]+)\s*/\s*([0-9]+)'))[2])::integer
WHERE "installment_number" ~ '([0-9]+)\s*/\s*([0-9]+)'
  AND ((regexp_match("installment_number", '([0-9]+)\s*/\s*([0-9]+)'))[2])::integer > 0;
--> statement-breakpoint
ALTER TABLE "fiscal_installments" ADD CONSTRAINT "fiscal_installments_progress_check" CHECK ("paid_installments" >= 0 AND ("total_installments" IS NULL OR ("total_installments" >= 1 AND "paid_installments" <= "total_installments")));
--> statement-breakpoint
CREATE TABLE "fiscal_installment_issuances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"installment_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"generated_by" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_installment_issuances_period_check" CHECK ("period_year" BETWEEN 2000 AND 2100 AND "period_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "fiscal_installment_issuances" ADD CONSTRAINT "fiscal_installment_issuances_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_installment_issuances" ADD CONSTRAINT "fiscal_installment_issuances_generated_by_user_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_installment_issuances" ADD CONSTRAINT "fiscal_installment_issuances_org_installment_fk" FOREIGN KEY ("org_id","installment_id") REFERENCES "public"."fiscal_installments"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_installment_issuances_org_period_uidx" ON "fiscal_installment_issuances" USING btree ("org_id","installment_id","period_year","period_month");
--> statement-breakpoint
CREATE INDEX "fiscal_installment_issuances_org_period_idx" ON "fiscal_installment_issuances" USING btree ("org_id","period_year","period_month");
--> statement-breakpoint
ALTER TABLE "fiscal_installment_issuances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fiscal_installment_issuances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "org_isolation" ON "fiscal_installment_issuances"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fiscal_installment_issuances" TO guilda_app;
