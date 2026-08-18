ALTER TABLE "clients" ADD COLUMN "cnae_code" varchar(10);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cnae_description" varchar(200);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "secondary_cnaes" jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "opened_at" date;