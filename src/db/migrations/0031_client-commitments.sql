CREATE TYPE "public"."commitment_cadence" AS ENUM('monthly', 'quarterly', 'semiannual', 'annual');--> statement-breakpoint
CREATE TABLE "client_commitment_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"commitment_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"period_index" smallint NOT NULL,
	"due_date" date NOT NULL,
	"notes" text,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clan_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"notes" text,
	"cadence" "commitment_cadence" NOT NULL,
	"difficulty" smallint DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source_informative_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "commitment_period_id" uuid;--> statement-breakpoint
ALTER TABLE "client_commitment_periods" ADD CONSTRAINT "client_commitment_periods_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitment_periods" ADD CONSTRAINT "client_commitment_periods_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitment_periods" ADD CONSTRAINT "client_commitment_periods_org_commitment_fk" FOREIGN KEY ("org_id","commitment_id") REFERENCES "public"."client_commitments"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_source_informative_id_informatives_id_fk" FOREIGN KEY ("source_informative_id") REFERENCES "public"."informatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_org_clan_fk" FOREIGN KEY ("org_id","clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_commitment_periods_uidx" ON "client_commitment_periods" USING btree ("org_id","commitment_id","period_year","period_index");--> statement-breakpoint
CREATE INDEX "client_commitment_periods_org_due_idx" ON "client_commitment_periods" USING btree ("org_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "client_commitments_org_id_uidx" ON "client_commitments" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "client_commitments_org_clan_idx" ON "client_commitments" USING btree ("org_id","clan_id","active");--> statement-breakpoint
CREATE INDEX "client_commitments_org_client_idx" ON "client_commitments" USING btree ("org_id","client_id");