CREATE TYPE "public"."closing_challenge_status" AS ENUM('active', 'completed', 'abandoned', 'blocked', 'taken');--> statement-breakpoint
CREATE TABLE "closing_challenge_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"time_limit_minutes" smallint NOT NULL,
	"base_xp" smallint NOT NULL,
	"bonus_xp" smallint NOT NULL,
	"daily_paid_cap" smallint NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closing_challenge_settings_limits" CHECK ("closing_challenge_settings"."time_limit_minutes" between 5 and 240 and "closing_challenge_settings"."base_xp" between 0 and 100 and "closing_challenge_settings"."bonus_xp" between 0 and 100 and "closing_challenge_settings"."daily_paid_cap" between 0 and 50)
);
--> statement-breakpoint
CREATE TABLE "closing_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"time_limit_minutes" smallint NOT NULL,
	"base_xp" smallint NOT NULL,
	"bonus_xp" smallint NOT NULL,
	"status" "closing_challenge_status" DEFAULT 'active' NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"closing_id" uuid,
	"in_time" boolean,
	"awarded_xp" smallint,
	"capped" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD COLUMN "closing_challenge_id" uuid;--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" ADD CONSTRAINT "closing_challenge_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" ADD CONSTRAINT "closing_challenge_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_challenges" ADD CONSTRAINT "closing_challenges_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_challenges" ADD CONSTRAINT "closing_challenges_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_challenges" ADD CONSTRAINT "closing_challenges_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_challenges" ADD CONSTRAINT "closing_challenges_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_challenges" ADD CONSTRAINT "closing_challenges_closing_id_accounting_closings_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."accounting_closings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "closing_challenges_active_user_uidx" ON "closing_challenges" USING btree ("org_id","user_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "closing_challenges_active_client_uidx" ON "closing_challenges" USING btree ("org_id","client_id","year") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "closing_challenges_org_client_idx" ON "closing_challenges" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "closing_challenges_org_ended_idx" ON "closing_challenges" USING btree ("org_id","ended_at");--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_closing_challenge_id_closing_challenges_id_fk" FOREIGN KEY ("closing_challenge_id") REFERENCES "public"."closing_challenges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xp_ledger_closing_challenge_idx" ON "xp_ledger" USING btree ("org_id","closing_challenge_id");--> statement-breakpoint
ALTER TABLE "closing_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closing_challenges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "closing_challenges"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "closing_challenge_settings"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha SELECT/INSERT/UPDATE/DELETE em toda tabela nova pelos
-- default privileges (docker/*/init/01-roles): GRANT sozinho nao restringe
-- nada. Desafio nao se apaga, termina: sai o DELETE, e o UPDATE fica so nas
-- colunas do desfecho. Cascata e SET NULL das FKs rodam como dono da tabela.
GRANT SELECT, INSERT ON "closing_challenges" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "closing_challenges" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "ended_at", "ended_by", "closing_id", "in_time", "awarded_xp", "capped") ON "closing_challenges" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "closing_challenge_settings" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "closing_challenge_settings" FROM guilda_app;
