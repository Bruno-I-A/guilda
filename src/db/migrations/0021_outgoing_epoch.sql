ALTER TABLE "accounting_closings" ADD COLUMN "completed_by_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "closing_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_closing_id_accounting_closings_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."accounting_closings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_closing_idx" ON "tasks" USING btree ("org_id","closing_id");