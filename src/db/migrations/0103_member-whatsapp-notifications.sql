CREATE TYPE "public"."member_whatsapp_outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed');--> statement-breakpoint

CREATE TABLE "member_whatsapp_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "phone_e164" varchar(16) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "opted_in_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_inbound_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "member_whatsapp_connections_phone_check" CHECK ("member_whatsapp_connections"."phone_e164" ~ '^\\+[1-9][0-9]{7,14}$')
);--> statement-breakpoint
CREATE TABLE "member_whatsapp_notification_config" (
  "org_id" text PRIMARY KEY NOT NULL,
  "template_name" varchar(512) NOT NULL,
  "template_language" varchar(20) DEFAULT 'pt_BR' NOT NULL,
  "template_status" varchar(40) DEFAULT 'not_created' NOT NULL,
  "template_id" varchar(64),
  "rejected_reason" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "member_whatsapp_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "company_flow_id" uuid NOT NULL,
  "dedupe_key" varchar(255) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "member_whatsapp_outbox_status" DEFAULT 'pending' NOT NULL,
  "scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "lock_token" uuid,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "member_whatsapp_connections" ADD CONSTRAINT "member_whatsapp_connections_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "member_whatsapp_connections" ADD CONSTRAINT "member_whatsapp_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "member_whatsapp_notification_config" ADD CONSTRAINT "member_whatsapp_notification_config_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ADD CONSTRAINT "member_whatsapp_outbox_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ADD CONSTRAINT "member_whatsapp_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ADD CONSTRAINT "member_whatsapp_outbox_company_flow_id_company_flows_id_fk" FOREIGN KEY ("company_flow_id") REFERENCES "public"."company_flows"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "member_whatsapp_connections_org_user_uidx" ON "member_whatsapp_connections" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_whatsapp_connections_org_phone_uidx" ON "member_whatsapp_connections" USING btree ("org_id","phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "member_whatsapp_outbox_org_dedupe_uidx" ON "member_whatsapp_outbox" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "member_whatsapp_outbox_pending_idx" ON "member_whatsapp_outbox" USING btree ("status","scheduled_for","locked_at");--> statement-breakpoint
CREATE INDEX "member_whatsapp_outbox_org_user_idx" ON "member_whatsapp_outbox" USING btree ("org_id","user_id");--> statement-breakpoint

ALTER TABLE "member_whatsapp_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_whatsapp_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_whatsapp_notification_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_whatsapp_notification_config" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "member_whatsapp_connections" FOR ALL USING ("org_id" = current_setting('app.org_id', true)) WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "member_whatsapp_notification_config" FOR ALL USING ("org_id" = current_setting('app.org_id', true)) WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "member_whatsapp_outbox" FOR ALL USING ("org_id" = current_setting('app.org_id', true)) WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "member_whatsapp_connections", "member_whatsapp_notification_config" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "member_whatsapp_outbox" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "member_whatsapp_outbox" FROM guilda_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.claim_member_whatsapp_outbox(p_limit integer)
RETURNS TABLE(outbox_id uuid, org_id text, claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'p_limit deve estar entre 1 e 100'; END IF;
  RETURN QUERY WITH candidates AS (
    SELECT o.id FROM public.member_whatsapp_outbox o
    WHERE o.attempt_count < 5 AND ((o.status = 'pending' AND o.scheduled_for <= statement_timestamp()) OR (o.status = 'processing' AND o.locked_at < statement_timestamp() - interval '5 minutes'))
    ORDER BY o.scheduled_for, o.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.member_whatsapp_outbox o SET status = 'processing', locked_at = statement_timestamp(), lock_token = gen_random_uuid(), attempt_count = o.attempt_count + 1, last_error = NULL
    FROM candidates c WHERE o.id = c.id RETURNING o.id, o.org_id, o.lock_token
  ) SELECT c.id, c.org_id, c.lock_token FROM claimed c;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_member_whatsapp_outbox(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_member_whatsapp_outbox(integer) TO guilda_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.finish_member_whatsapp_outbox(p_outbox_id uuid, p_claim_token uuid, p_success boolean, p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.member_whatsapp_outbox o SET status = CASE WHEN p_success THEN 'sent'::public.member_whatsapp_outbox_status WHEN o.attempt_count >= 5 THEN 'failed'::public.member_whatsapp_outbox_status ELSE 'pending'::public.member_whatsapp_outbox_status END,
    sent_at = CASE WHEN p_success THEN statement_timestamp() ELSE NULL END,
    scheduled_for = CASE WHEN p_success OR o.attempt_count >= 5 THEN o.scheduled_for ELSE statement_timestamp() + make_interval(secs => LEAST(3600, 30 * power(2, GREATEST(o.attempt_count - 1, 0)))::integer) END,
    last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(NULLIF(p_error, ''), 'Falha desconhecida'), 2000) END, locked_at = NULL, lock_token = NULL
  WHERE o.id = p_outbox_id AND o.status = 'processing' AND o.lock_token = p_claim_token;
  GET DIAGNOSTICS affected = ROW_COUNT; RETURN affected = 1;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finish_member_whatsapp_outbox(uuid, uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_member_whatsapp_outbox(uuid, uuid, boolean, text) TO guilda_app;
