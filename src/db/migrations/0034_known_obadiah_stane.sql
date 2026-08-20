ALTER TABLE "xp_ledger" DROP CONSTRAINT "xp_ledger_org_task_event_fk";
--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_org_task_event_fk" FOREIGN KEY ("org_id","task_event_id") REFERENCES "public"."task_events"("org_id","id") ON DELETE set null ON UPDATE no action;