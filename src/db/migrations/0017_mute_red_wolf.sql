CREATE TYPE "public"."telegram_outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "telegram_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"username" varchar(64),
	"first_name" varchar(255),
	"last_name" varchar(255),
	"language_code" varchar(16),
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid,
	"event_type" varchar(80) NOT NULL,
	"dedupe_key" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "telegram_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"task_notifications" boolean DEFAULT true NOT NULL,
	"approval_notifications" boolean DEFAULT true NOT NULL,
	"deadline_reminders" boolean DEFAULT true NOT NULL,
	"xp_notifications" boolean DEFAULT true NOT NULL,
	"closing_notifications" boolean DEFAULT true NOT NULL,
	"campaign_notifications" boolean DEFAULT true NOT NULL,
	"daily_summary" boolean DEFAULT false NOT NULL,
	"daily_summary_time" time DEFAULT '08:00:00' NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_connection_id_telegram_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telegram_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_preferences" ADD CONSTRAINT "telegram_preferences_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_preferences" ADD CONSTRAINT "telegram_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_connections_org_user_active_uidx" ON "telegram_connections" USING btree ("org_id","user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_connections_telegram_user_active_uidx" ON "telegram_connections" USING btree ("telegram_user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "telegram_connections_org_idx" ON "telegram_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_tokens_hash_uidx" ON "telegram_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_org_user_idx" ON "telegram_link_tokens" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_expires_idx" ON "telegram_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_outbox_org_dedupe_uidx" ON "telegram_outbox" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "telegram_outbox_pending_idx" ON "telegram_outbox" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "telegram_outbox_org_user_idx" ON "telegram_outbox" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_preferences_org_user_uidx" ON "telegram_preferences" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "telegram_preferences_summary_idx" ON "telegram_preferences" USING btree ("org_id","daily_summary","daily_summary_time");--> statement-breakpoint
CREATE INDEX "telegram_updates_pending_idx" ON "telegram_updates" USING btree ("processed_at","locked_at");--> statement-breakpoint

-- Vínculos, tokens, preferências e mensagens pertencem a uma organização e
-- seguem a mesma defesa em profundidade das outras tabelas de domínio.
ALTER TABLE "telegram_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "telegram_connections"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "telegram_link_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "telegram_link_tokens"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "telegram_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "telegram_preferences"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "telegram_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "telegram_outbox"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- O webhook ainda não conhece o tenant ao receber /start. Esta função só
-- revela a chave de roteamento de um token válido; o consumo e toda escrita
-- subsequente continuam acontecendo dentro de withOrgTx/RLS.
CREATE OR REPLACE FUNCTION public.resolve_telegram_link_token(p_token_hash text)
RETURNS TABLE(token_id uuid, org_id text, user_id text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.org_id, t.user_id
  FROM public.telegram_link_tokens AS t
  WHERE t.token_hash = p_token_hash
    AND t.consumed_at IS NULL
    AND t.expires_at > statement_timestamp()
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_telegram_link_token(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.resolve_telegram_link_token(text) TO guilda_app;--> statement-breakpoint

-- A mesma exceção estreita resolve a organização antes de comandos normais.
-- Nenhum dado operacional ou preferência é exposto pela função.
CREATE OR REPLACE FUNCTION public.lookup_telegram_connection(p_telegram_user_id bigint)
RETURNS TABLE(connection_id uuid, org_id text, user_id text, chat_id bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT c.id, c.org_id, c.user_id, c.chat_id
  FROM public.telegram_connections AS c
  WHERE c.telegram_user_id = p_telegram_user_id
    AND c.revoked_at IS NULL
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lookup_telegram_connection(bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lookup_telegram_connection(bigint) TO guilda_app;--> statement-breakpoint

-- update_id é infraestrutura global e não contém payload/dados do tenant.
-- A aplicação pode deduplicar e finalizar updates, mas não apagá-los.
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_connections" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_link_tokens" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_preferences" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_outbox" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "telegram_updates" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "telegram_updates" FROM guilda_app;
