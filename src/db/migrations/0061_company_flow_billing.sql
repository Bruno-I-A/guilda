ALTER TABLE "company_flows" ADD COLUMN "billing_amount" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "company_flows" ADD COLUMN "billing_description" text;
--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_billing_pair_check" CHECK (("billing_amount" IS NULL AND "billing_description" IS NULL) OR ("billing_amount" IS NOT NULL AND "billing_description" IS NOT NULL AND "billing_amount" > 0 AND length(btrim("billing_description")) > 0));
--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_billing_kind_check" CHECK ("kind" <> 'opening' OR ("billing_amount" IS NULL AND "billing_description" IS NULL));
