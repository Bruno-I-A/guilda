ALTER TABLE "company_flows" ADD COLUMN "rh_verification_task_id" uuid;
--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_org_rh_verification_task_fk" FOREIGN KEY ("org_id", "rh_verification_task_id") REFERENCES "public"."tasks"("org_id", "id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "company_flows_org_rh_verification_task_uidx" ON "company_flows" USING btree ("org_id", "rh_verification_task_id") WHERE "company_flows"."rh_verification_task_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_rh_verification_kind_check" CHECK ("kind" = 'closure' OR "rh_verification_task_id" IS NULL);
