CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"task_id" uuid,
	"amount" integer NOT NULL,
	"reason" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xp_ledger_org_user_idx" ON "xp_ledger" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_task_completed_uidx" ON "xp_ledger" USING btree ("task_id") WHERE reason = 'task_completed';--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_task_reversal_uidx" ON "xp_ledger" USING btree ("task_id") WHERE reason = 'reversal';