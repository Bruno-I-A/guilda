-- PostgreSQL não permite usar um valor adicionado a enum antes do COMMIT.
-- O migrador executa todas as migrations pendentes em uma transação, então
-- recriamos o tipo já completo para manter instalações novas e upgrades seguros.
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "movements_applicability" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "incoming_applicability" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "outgoing_applicability" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "guide_applicability" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "nfs_applicability" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "factor_r_applicability" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."fiscal_applicability" RENAME TO "fiscal_applicability_old";--> statement-breakpoint
CREATE TYPE "public"."fiscal_applicability" AS ENUM('unknown', 'required', 'not_required', 'not_applicable');--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "movements_applicability" TYPE "public"."fiscal_applicability" USING "movements_applicability"::text::"public"."fiscal_applicability";--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "incoming_applicability" TYPE "public"."fiscal_applicability" USING "incoming_applicability"::text::"public"."fiscal_applicability";--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "outgoing_applicability" TYPE "public"."fiscal_applicability" USING "outgoing_applicability"::text::"public"."fiscal_applicability";--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "guide_applicability" TYPE "public"."fiscal_applicability" USING "guide_applicability"::text::"public"."fiscal_applicability";--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "nfs_applicability" TYPE "public"."fiscal_applicability" USING "nfs_applicability"::text::"public"."fiscal_applicability";--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "factor_r_applicability" TYPE "public"."fiscal_applicability" USING "factor_r_applicability"::text::"public"."fiscal_applicability";--> statement-breakpoint
DROP TYPE "public"."fiscal_applicability_old";
