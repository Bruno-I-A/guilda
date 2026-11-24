-- Agente para todos e expediente do escritorio (2026-11-23). Escrita a mao, como a 0103 a 0109.
-- O modo substitui o interruptor do teste; test_enabled fica no banco sem uso,
-- para o app antigo nao quebrar durante a troca (mesmo cuidado de support_contacts.client_id).
CREATE TYPE "public"."support_agent_mode" AS ENUM('off', 'test', 'live');--> statement-breakpoint
ALTER TABLE "support_agent_settings" ADD COLUMN "agent_mode" "support_agent_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
UPDATE "support_agent_settings" SET "agent_mode" = 'test' WHERE "test_enabled";--> statement-breakpoint
ALTER TABLE "support_agent_settings" DROP CONSTRAINT "support_agent_settings_enabled_check";--> statement-breakpoint
ALTER TABLE "support_agent_settings" ADD CONSTRAINT "support_agent_settings_mode_keyword_check" CHECK ("agent_mode" <> 'test' OR "test_keyword" IS NOT NULL);--> statement-breakpoint
CREATE TABLE "support_business_hours" (
	"org_id" text PRIMARY KEY NOT NULL,
	"week" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_business_hours" ADD CONSTRAINT "support_business_hours_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_business_hours" ADD CONSTRAINT "support_business_hours_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "support_special_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"day" date NOT NULL,
	"name" varchar(80) NOT NULL,
	"periods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_special_days" ADD CONSTRAINT "support_special_days_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_special_days" ADD CONSTRAINT "support_special_days_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_special_days_org_day_uidx" ON "support_special_days" USING btree ("org_id","day");--> statement-breakpoint
ALTER TABLE "support_business_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_business_hours" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_business_hours"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "support_special_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_special_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_special_days"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- Configuracao editavel: o admin muda a semana, cadastra e remove dia especial.
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_business_hours" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_special_days" TO guilda_app;
