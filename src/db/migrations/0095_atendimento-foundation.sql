CREATE TYPE "public"."support_channel_status" AS ENUM('pending', 'active', 'paused', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."support_conversation_event_type" AS ENUM('opened', 'status_changed', 'assigned', 'unassigned', 'ai_paused', 'ai_resumed', 'resolved', 'reopened', 'contact_linked');--> statement-breakpoint
CREATE TYPE "public"."support_conversation_status" AS ENUM('ai_active', 'needs_human', 'human_active', 'waiting_customer', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."support_message_actor" AS ENUM('customer', 'ai', 'attendant', 'system');--> statement-breakpoint
CREATE TYPE "public"."support_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."support_message_event_type" AS ENUM('received', 'queued', 'accepted', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."support_message_source" AS ENUM('cloud_api', 'business_app', 'guilda_ai', 'guilda_attendant', 'history_sync', 'system');--> statement-breakpoint
CREATE TYPE "public"."support_message_type" AS ENUM('text', 'image', 'audio', 'document', 'video', 'sticker', 'location', 'contacts', 'interactive', 'reaction', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."support_outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."support_queue_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "support_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid,
	"whatsapp_id" varchar(32) NOT NULL,
	"phone_e164" varchar(20),
	"display_name" varchar(255),
	"linked_by" text,
	"linked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_contacts_whatsapp_id_check" CHECK ("support_contacts"."whatsapp_id" ~ '^[0-9]{1,32}$'),
	CONSTRAINT "support_contacts_phone_e164_check" CHECK ("support_contacts"."phone_e164" IS NULL OR "support_contacts"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "support_contacts_link_pair_check" CHECK (("support_contacts"."client_id" IS NULL AND "support_contacts"."linked_by" IS NULL AND "support_contacts"."linked_at" IS NULL) OR ("support_contacts"."client_id" IS NOT NULL AND "support_contacts"."linked_by" IS NOT NULL AND "support_contacts"."linked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "support_conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"event_type" "support_conversation_event_type" NOT NULL,
	"actor_user_id" text,
	"source" "support_message_source" DEFAULT 'system' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" "support_conversation_status" DEFAULT 'ai_active' NOT NULL,
	"assigned_clan_id" uuid,
	"assigned_user_id" text,
	"summary" text,
	"ai_paused_at" timestamp with time zone,
	"ai_pause_reason" varchar(120),
	"last_message_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_conversations_resolved_check" CHECK (("support_conversations"."status" = 'resolved' AND "support_conversations"."resolved_at" IS NOT NULL) OR ("support_conversations"."status" <> 'resolved' AND "support_conversations"."resolved_at" IS NULL)),
	CONSTRAINT "support_conversations_ai_pause_pair_check" CHECK (("support_conversations"."ai_paused_at" IS NULL AND "support_conversations"."ai_pause_reason" IS NULL) OR ("support_conversations"."ai_paused_at" IS NOT NULL AND "support_conversations"."ai_pause_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "support_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"webhook_field" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "support_queue_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_inbound_events_fingerprint_check" CHECK ("support_inbound_events"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "support_message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"event_type" "support_message_event_type" NOT NULL,
	"provider_event_key" varchar(64),
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"external_message_id" varchar(255),
	"direction" "support_message_direction" NOT NULL,
	"actor" "support_message_actor" NOT NULL,
	"source" "support_message_source" NOT NULL,
	"message_type" "support_message_type" NOT NULL,
	"text" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reply_to_external_message_id" varchar(255),
	"sent_by_user_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "support_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_whatsapp_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" "support_channel_status" DEFAULT 'pending' NOT NULL,
	"waba_id" varchar(32),
	"phone_number_id" varchar(32),
	"display_phone_number" varchar(32),
	"verified_name" varchar(255),
	"coexistence_enabled" boolean DEFAULT true NOT NULL,
	"access_token_ciphertext" text,
	"access_token_iv" varchar(32),
	"access_token_auth_tag" varchar(32),
	"access_token_key_version" smallint,
	"onboarded_at" timestamp with time zone,
	"last_webhook_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_whatsapp_channels_waba_id_check" CHECK ("support_whatsapp_channels"."waba_id" IS NULL OR "support_whatsapp_channels"."waba_id" ~ '^[0-9]{1,32}$'),
	CONSTRAINT "support_whatsapp_channels_phone_number_id_check" CHECK ("support_whatsapp_channels"."phone_number_id" IS NULL OR "support_whatsapp_channels"."phone_number_id" ~ '^[0-9]{1,32}$'),
	CONSTRAINT "support_whatsapp_channels_token_envelope_check" CHECK (("support_whatsapp_channels"."access_token_ciphertext" IS NULL AND "support_whatsapp_channels"."access_token_iv" IS NULL AND "support_whatsapp_channels"."access_token_auth_tag" IS NULL AND "support_whatsapp_channels"."access_token_key_version" IS NULL) OR ("support_whatsapp_channels"."access_token_ciphertext" IS NOT NULL AND "support_whatsapp_channels"."access_token_iv" IS NOT NULL AND "support_whatsapp_channels"."access_token_auth_tag" IS NOT NULL AND "support_whatsapp_channels"."access_token_key_version" IS NOT NULL))
);
--> statement-breakpoint
-- As FKs compostas abaixo dependem destes índices. O drizzle-kit gera os
-- índices depois dos ALTER TABLE, ordem que o Postgres rejeita em uma
-- migration que cria pais e filhos de uma vez.
CREATE UNIQUE INDEX "support_whatsapp_channels_org_id_uidx" ON "support_whatsapp_channels" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_contacts_org_id_uidx" ON "support_contacts" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_conversations_org_id_uidx" ON "support_conversations" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_org_id_uidx" ON "support_messages" USING btree ("org_id","id");--> statement-breakpoint
ALTER TABLE "support_contacts" ADD CONSTRAINT "support_contacts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_contacts" ADD CONSTRAINT "support_contacts_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_contacts" ADD CONSTRAINT "support_contacts_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversation_events" ADD CONSTRAINT "support_conversation_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversation_events" ADD CONSTRAINT "support_conversation_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversation_events" ADD CONSTRAINT "support_conversation_events_org_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."support_conversations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_org_channel_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."support_whatsapp_channels"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_org_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."support_contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_org_clan_fk" FOREIGN KEY ("org_id","assigned_clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbound_events" ADD CONSTRAINT "support_inbound_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbound_events" ADD CONSTRAINT "support_inbound_events_org_channel_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."support_whatsapp_channels"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_message_events" ADD CONSTRAINT "support_message_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_message_events" ADD CONSTRAINT "support_message_events_org_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "public"."support_messages"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sent_by_user_id_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_org_channel_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."support_whatsapp_channels"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_org_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."support_conversations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_outbox" ADD CONSTRAINT "support_outbox_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_outbox" ADD CONSTRAINT "support_outbox_org_channel_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."support_whatsapp_channels"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_outbox" ADD CONSTRAINT "support_outbox_org_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "public"."support_messages"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_whatsapp_channels" ADD CONSTRAINT "support_whatsapp_channels_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_whatsapp_channels" ADD CONSTRAINT "support_whatsapp_channels_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_contacts_org_whatsapp_uidx" ON "support_contacts" USING btree ("org_id","whatsapp_id");--> statement-breakpoint
CREATE INDEX "support_contacts_org_client_idx" ON "support_contacts" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "support_conversation_events_org_conversation_time_idx" ON "support_conversation_events" USING btree ("org_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_conversations_open_contact_uidx" ON "support_conversations" USING btree ("org_id","channel_id","contact_id") WHERE "support_conversations"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "support_conversations_org_queue_idx" ON "support_conversations" USING btree ("org_id","status","assigned_clan_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_inbound_events_fingerprint_uidx" ON "support_inbound_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "support_inbound_events_pending_idx" ON "support_inbound_events" USING btree ("status","scheduled_for","locked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_message_events_provider_uidx" ON "support_message_events" USING btree ("org_id","provider_event_key") WHERE "support_message_events"."provider_event_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_message_events_org_message_time_idx" ON "support_message_events" USING btree ("org_id","message_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_external_uidx" ON "support_messages" USING btree ("org_id","channel_id","external_message_id") WHERE "support_messages"."external_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_messages_org_conversation_time_idx" ON "support_messages" USING btree ("org_id","conversation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_outbox_org_message_uidx" ON "support_outbox" USING btree ("org_id","message_id");--> statement-breakpoint
CREATE INDEX "support_outbox_pending_idx" ON "support_outbox" USING btree ("status","scheduled_for","locked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_whatsapp_channels_phone_number_id_uidx" ON "support_whatsapp_channels" USING btree ("phone_number_id") WHERE "support_whatsapp_channels"."phone_number_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_whatsapp_channels_org_status_idx" ON "support_whatsapp_channels" USING btree ("org_id","status");--> statement-breakpoint

-- Todo dado de atendimento pertence a uma organização. FORCE também
-- protege quando a tabela for consultada por seu dono durante manutenções.
ALTER TABLE "support_whatsapp_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_whatsapp_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_whatsapp_channels" FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "support_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_contacts" FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "support_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_conversations" FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "support_inbound_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_inbound_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_inbound_events" FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "support_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_outbox" FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- Mensagens e eventos são trilha de auditoria append-only. Correções e
-- estados posteriores entram como novos eventos, nunca reescrevem a história.
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation_select" ON "support_messages"
  FOR SELECT USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation_insert" ON "support_messages"
  FOR INSERT WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "support_message_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_message_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation_select" ON "support_message_events"
  FOR SELECT USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation_insert" ON "support_message_events"
  FOR INSERT WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "support_conversation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_conversation_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation_select" ON "support_conversation_events"
  FOR SELECT USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation_insert" ON "support_conversation_events"
  FOR INSERT WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- O webhook ainda não conhece o tenant. Esta é a única exceção: dado o
-- identificador público do número, revela apenas a chave de roteamento. Nem
-- credenciais nem dados de conversa saem da tabela protegida.
CREATE OR REPLACE FUNCTION public.lookup_support_whatsapp_channel(p_phone_number_id text)
RETURNS TABLE(channel_id uuid, org_id text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT c.id, c.org_id
  FROM public.support_whatsapp_channels AS c
  WHERE c.phone_number_id = p_phone_number_id
    AND c.status = 'active'
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lookup_support_whatsapp_channel(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lookup_support_whatsapp_channel(text) TO guilda_app;--> statement-breakpoint

-- Claims globais retornam somente IDs de roteamento. O worker reabre cada item
-- com withOrgTx antes de ler o payload protegido por RLS.
CREATE OR REPLACE FUNCTION public.claim_support_inbound_events(p_limit integer)
RETURNS TABLE(event_id uuid, org_id text, channel_id uuid, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit deve estar entre 1 e 100';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM public.support_inbound_events AS e
    WHERE e.attempt_count < 5
      AND (
        (e.status = 'pending' AND e.scheduled_for <= statement_timestamp())
        OR (e.status = 'processing' AND e.locked_at < statement_timestamp() - interval '5 minutes')
      )
    ORDER BY e.scheduled_for, e.received_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.support_inbound_events AS e
    SET status = 'processing',
        locked_at = statement_timestamp(),
        lock_token = gen_random_uuid(),
        attempt_count = e.attempt_count + 1,
        last_error = NULL
    FROM candidates AS c
    WHERE e.id = c.id
    RETURNING e.id, e.org_id, e.channel_id, e.lock_token
  )
  SELECT c.id, c.org_id, c.channel_id, c.lock_token FROM claimed AS c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_support_inbound_events(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_support_inbound_events(integer) TO guilda_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.finish_support_inbound_event(
  p_event_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.support_inbound_events AS e
  SET status = CASE
        WHEN p_success THEN 'processed'::public.support_queue_status
        WHEN e.attempt_count >= 5 THEN 'failed'::public.support_queue_status
        ELSE 'pending'::public.support_queue_status
      END,
      processed_at = CASE WHEN p_success THEN statement_timestamp() ELSE NULL END,
      scheduled_for = CASE
        WHEN p_success OR e.attempt_count >= 5 THEN e.scheduled_for
        ELSE statement_timestamp() + make_interval(
          secs => LEAST(3600, 30 * power(2, GREATEST(e.attempt_count - 1, 0)))::integer
        )
      END,
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE left(COALESCE(NULLIF(p_error, ''), 'Falha desconhecida'), 2000)
      END,
      locked_at = NULL,
      lock_token = NULL
  WHERE e.id = p_event_id
    AND e.status = 'processing'
    AND e.lock_token = p_claim_token;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finish_support_inbound_event(uuid, uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_support_inbound_event(uuid, uuid, boolean, text) TO guilda_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.claim_support_outbox(p_limit integer)
RETURNS TABLE(outbox_id uuid, org_id text, channel_id uuid, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit deve estar entre 1 e 100';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM public.support_outbox AS o
    WHERE o.attempt_count < 5
      AND (
        (o.status = 'pending' AND o.scheduled_for <= statement_timestamp())
        OR (o.status = 'processing' AND o.locked_at < statement_timestamp() - interval '5 minutes')
      )
    ORDER BY o.scheduled_for, o.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.support_outbox AS o
    SET status = 'processing',
        locked_at = statement_timestamp(),
        lock_token = gen_random_uuid(),
        attempt_count = o.attempt_count + 1,
        last_error = NULL
    FROM candidates AS c
    WHERE o.id = c.id
    RETURNING o.id, o.org_id, o.channel_id, o.lock_token
  )
  SELECT c.id, c.org_id, c.channel_id, c.lock_token FROM claimed AS c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_support_outbox(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_support_outbox(integer) TO guilda_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.finish_support_outbox(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.support_outbox AS o
  SET status = CASE
        WHEN p_success THEN 'sent'::public.support_outbox_status
        WHEN o.attempt_count >= 5 THEN 'failed'::public.support_outbox_status
        ELSE 'pending'::public.support_outbox_status
      END,
      sent_at = CASE WHEN p_success THEN statement_timestamp() ELSE NULL END,
      scheduled_for = CASE
        WHEN p_success OR o.attempt_count >= 5 THEN o.scheduled_for
        ELSE statement_timestamp() + make_interval(
          secs => LEAST(3600, 30 * power(2, GREATEST(o.attempt_count - 1, 0)))::integer
        )
      END,
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE left(COALESCE(NULLIF(p_error, ''), 'Falha desconhecida'), 2000)
      END,
      locked_at = NULL,
      lock_token = NULL
  WHERE o.id = p_outbox_id
    AND o.status = 'processing'
    AND o.lock_token = p_claim_token;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finish_support_outbox(uuid, uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_support_outbox(uuid, uuid, boolean, text) TO guilda_app;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "support_whatsapp_channels" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_contacts" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_conversations" TO guilda_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "support_messages" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_messages" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "support_message_events" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_message_events" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "support_conversation_events" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_conversation_events" FROM guilda_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "support_inbound_events" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_inbound_events" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "attempt_count", "scheduled_for", "locked_at", "lock_token", "processed_at", "last_error")
  ON "support_inbound_events" TO guilda_app;--> statement-breakpoint

GRANT SELECT, INSERT ON "support_outbox" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_outbox" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "attempt_count", "scheduled_for", "locked_at", "lock_token", "sent_at", "last_error")
  ON "support_outbox" TO guilda_app;
