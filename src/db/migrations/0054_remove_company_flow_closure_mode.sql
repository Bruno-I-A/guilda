ALTER TABLE "company_flows" DROP COLUMN "closure_mode";--> statement-breakpoint
ALTER TABLE "company_flows" DROP COLUMN "closure_responsibility_until";--> statement-breakpoint
DROP TYPE "public"."company_flow_closure_mode";
