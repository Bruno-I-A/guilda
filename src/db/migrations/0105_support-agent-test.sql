-- Teste do agente (2026-11-19): interruptor por organizacao e marca da rodada.
-- Escrita a mao como a 0103 e a 0104, que nao geraram snapshot.
CREATE TABLE "support_agent_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"test_enabled" boolean DEFAULT false NOT NULL,
	"test_keyword" varchar(40),
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_agent_settings_keyword_check" CHECK ("test_keyword" IS NULL OR "test_keyword" ~ '^[a-z0-9]{3,40}$'),
	CONSTRAINT "support_agent_settings_enabled_check" CHECK (NOT "test_enabled" OR "test_keyword" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "support_agent_settings" ADD CONSTRAINT "support_agent_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_agent_settings" ADD CONSTRAINT "support_agent_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD COLUMN "ai_test_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_agent_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_agent_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_agent_settings"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- Default privileges dao tudo ao guilda_app (GRANT sozinho nao restringe):
-- a configuracao se ajusta, nao se apaga; a cascata da organizacao roda como dono.
GRANT SELECT, INSERT, UPDATE ON "support_agent_settings" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "support_agent_settings" FROM guilda_app;
