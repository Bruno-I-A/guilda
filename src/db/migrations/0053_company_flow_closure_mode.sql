CREATE TYPE "public"."company_flow_closure_mode" AS ENUM('company_closure', 'accountant_change');--> statement-breakpoint
ALTER TABLE "company_flows" ADD COLUMN "closure_mode" "company_flow_closure_mode" DEFAULT 'company_closure' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_flows" ADD COLUMN "closure_responsibility_until" date;
