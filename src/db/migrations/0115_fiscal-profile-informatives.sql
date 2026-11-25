ALTER TABLE "fiscal_client_profiles" ADD COLUMN "sped_applicability" "fiscal_applicability" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD COLUMN "gia_applicability" "fiscal_applicability" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD COLUMN "deis_applicability" "fiscal_applicability" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD COLUMN "pgdas_applicability" "fiscal_applicability" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD COLUMN "efd_contributions_applicability" "fiscal_applicability" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD COLUMN "mit_applicability" "fiscal_applicability" DEFAULT 'unknown' NOT NULL;
