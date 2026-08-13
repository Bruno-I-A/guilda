ALTER TABLE "accounting_closing_years" ADD COLUMN "closed_by_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "closing_year_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_closing_year_id_accounting_closing_years_id_fk" FOREIGN KEY ("closing_year_id") REFERENCES "public"."accounting_closing_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_closing_year_idx" ON "tasks" USING btree ("org_id","closing_year_id");