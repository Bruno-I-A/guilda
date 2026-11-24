-- Avisos e missoes pelo WhatsApp; sai o Telegram (2026-11-24). Escrita a mao, como a 0103 a 0111.
-- As tabelas do Telegram ficam no banco sem uso: apagar e migracao destrutiva e fica para depois.

-- 1. Numero confirmado por codigo. Sem confirmacao, nada de aviso nem de comando.
ALTER TABLE "member_whatsapp_connections" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_whatsapp_connections" ADD COLUMN "verification_code_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "member_whatsapp_connections" ADD COLUMN "verification_expires_at" timestamp with time zone;--> statement-breakpoint

-- 2. Preferencias dos avisos, copiadas do Telegram. Quem nao tinha comeca com fechamentos desligado.
CREATE TABLE "member_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"task_notifications" boolean DEFAULT true NOT NULL,
	"approval_notifications" boolean DEFAULT true NOT NULL,
	"deadline_reminders" boolean DEFAULT true NOT NULL,
	"xp_notifications" boolean DEFAULT true NOT NULL,
	"closing_notifications" boolean DEFAULT false NOT NULL,
	"campaign_notifications" boolean DEFAULT true NOT NULL,
	"mural_notifications" boolean DEFAULT true NOT NULL,
	"daily_summary" boolean DEFAULT false NOT NULL,
	"daily_summary_time" time DEFAULT '08:00:00' NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "member_notification_preferences" ADD CONSTRAINT "member_notification_preferences_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notification_preferences" ADD CONSTRAINT "member_notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_notification_preferences_org_user_uidx" ON "member_notification_preferences" USING btree ("org_id","user_id");--> statement-breakpoint
INSERT INTO "member_notification_preferences" (
	"org_id", "user_id", "task_notifications", "approval_notifications", "deadline_reminders",
	"xp_notifications", "closing_notifications", "campaign_notifications", "mural_notifications",
	"daily_summary", "daily_summary_time", "timezone", "quiet_hours_start", "quiet_hours_end",
	"created_at", "updated_at"
)
SELECT
	"org_id", "user_id", "task_notifications", "approval_notifications", "deadline_reminders",
	"xp_notifications", "closing_notifications", "campaign_notifications", "mural_notifications",
	"daily_summary", "daily_summary_time", "timezone", "quiet_hours_start", "quiet_hours_end",
	"created_at", "updated_at"
FROM "telegram_preferences"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 3. Modelos Utility por chave (antes era um so). O do novo cliente vem da tabela antiga.
CREATE TABLE "member_whatsapp_templates" (
	"org_id" text NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" varchar(512) NOT NULL,
	"language" varchar(20) DEFAULT 'pt_BR' NOT NULL,
	"status" varchar(40) DEFAULT 'not_created' NOT NULL,
	"category" varchar(40),
	"template_id" varchar(64),
	"rejected_reason" text,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_whatsapp_templates_pk" PRIMARY KEY ("org_id","key")
);--> statement-breakpoint
ALTER TABLE "member_whatsapp_templates" ADD CONSTRAINT "member_whatsapp_templates_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "member_whatsapp_templates" ("org_id", "key", "name", "language", "status", "template_id", "rejected_reason", "updated_at")
SELECT "org_id", 'novo_cliente', "template_name", "template_language", "template_status", "template_id", "rejected_reason", "updated_at"
FROM "member_whatsapp_notification_config"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 4. Mensagens dos integrantes: fila propria, fora do Atendimento. Unica pelo wamid,
-- porque a Meta reenvia o mesmo webhook e a previa nao pode sair em dobro.
CREATE TABLE "member_whatsapp_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"message_type" varchar(40) NOT NULL,
	"text" text,
	"button_id" varchar(255),
	"received_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_whatsapp_commands_kind_check" CHECK ("kind" IN ('text', 'button', 'other')),
	CONSTRAINT "member_whatsapp_commands_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed'))
);--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD CONSTRAINT "member_whatsapp_commands_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD CONSTRAINT "member_whatsapp_commands_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD CONSTRAINT "member_whatsapp_commands_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."member_whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_whatsapp_commands_org_external_uidx" ON "member_whatsapp_commands" USING btree ("org_id","external_id");--> statement-breakpoint
CREATE INDEX "member_whatsapp_commands_pending_idx" ON "member_whatsapp_commands" USING btree ("status","created_at","locked_at");--> statement-breakpoint

-- 5. A fila de avisos aceita aviso sem Fluxo e sem conversa (os avisos de missao).
ALTER TABLE "member_whatsapp_outbox" DROP CONSTRAINT "member_whatsapp_outbox_origin_check";--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ADD CONSTRAINT "member_whatsapp_outbox_origin_check" CHECK (num_nonnulls("company_flow_id", "support_conversation_id") <= 1);--> statement-breakpoint

-- 6. Informativo pedido pelo WhatsApp: so a mesma conexao confirma a previa.
ALTER TYPE "public"."informative_source" ADD VALUE IF NOT EXISTS 'whatsapp';--> statement-breakpoint
ALTER TABLE "informatives" ADD COLUMN "whatsapp_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "informatives" ADD CONSTRAINT "informatives_whatsapp_connection_id_fk" FOREIGN KEY ("whatsapp_connection_id") REFERENCES "public"."member_whatsapp_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- RLS e privilegios das tabelas novas.
ALTER TABLE "member_notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "member_notification_preferences"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "member_whatsapp_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_whatsapp_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "member_whatsapp_templates"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "member_whatsapp_commands"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "member_notification_preferences", "member_whatsapp_templates" TO guilda_app;--> statement-breakpoint
-- Comando nao se apaga: so a marcacao de lido muda.
GRANT SELECT, INSERT, UPDATE ON "member_whatsapp_commands" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "member_whatsapp_commands" FROM guilda_app;--> statement-breakpoint

-- Reserva dos comandos de todas as organizacoes (o worker nao sabe a org antes).
CREATE OR REPLACE FUNCTION public.claim_member_whatsapp_commands(p_limit integer)
RETURNS TABLE(command_id uuid, org_id text, claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'p_limit deve estar entre 1 e 100'; END IF;
  RETURN QUERY WITH candidates AS (
    SELECT c.id FROM public.member_whatsapp_commands c
    WHERE c.attempt_count < 3 AND (c.status = 'pending' OR (c.status = 'processing' AND c.locked_at < statement_timestamp() - interval '5 minutes'))
    ORDER BY c.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.member_whatsapp_commands c SET status = 'processing', locked_at = statement_timestamp(), lock_token = gen_random_uuid(), attempt_count = c.attempt_count + 1, last_error = NULL
    FROM candidates k WHERE c.id = k.id RETURNING c.id, c.org_id, c.lock_token
  ) SELECT k.id, k.org_id, k.lock_token FROM claimed k;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_member_whatsapp_commands(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_member_whatsapp_commands(integer) TO guilda_app;--> statement-breakpoint

-- O horario de silencio adia o aviso sem gastar tentativa.
CREATE OR REPLACE FUNCTION public.defer_member_whatsapp_outbox(p_outbox_id uuid, p_claim_token uuid, p_minutes integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE affected integer;
BEGIN
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 1440 THEN RAISE EXCEPTION 'p_minutes deve estar entre 1 e 1440'; END IF;
  UPDATE public.member_whatsapp_outbox o SET status = 'pending'::public.member_whatsapp_outbox_status,
    scheduled_for = statement_timestamp() + make_interval(mins => p_minutes),
    attempt_count = GREATEST(o.attempt_count - 1, 0), locked_at = NULL, lock_token = NULL, last_error = NULL
  WHERE o.id = p_outbox_id AND o.status = 'processing' AND o.lock_token = p_claim_token;
  GET DIAGNOSTICS affected = ROW_COUNT; RETURN affected = 1;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.defer_member_whatsapp_outbox(uuid, uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.defer_member_whatsapp_outbox(uuid, uuid, integer) TO guilda_app;
