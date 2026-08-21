CREATE TYPE "public"."company_flow_event_type" AS ENUM('created', 'claimed', 'assigned', 'returned_to_owner', 'informative_prepared', 'informative_cancelled', 'informative_confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."company_flow_kind" AS ENUM('opening', 'amendment', 'closure');--> statement-breakpoint
CREATE TYPE "public"."company_flow_source" AS ENUM('written', 'whatsapp', 'phone', 'other');--> statement-breakpoint
CREATE TYPE "public"."company_flow_status" AS ENUM('sent_to_corporate', 'in_progress', 'awaiting_owner', 'informative_drafting', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "company_flow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"flow_id" uuid NOT NULL,
	"event_type" "company_flow_event_type" NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"note" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_flow_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"flow_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" varchar(32) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"societario_clan_id" uuid NOT NULL,
	"kind" "company_flow_kind" NOT NULL,
	"status" "company_flow_status" DEFAULT 'sent_to_corporate' NOT NULL,
	"source" "company_flow_source" DEFAULT 'written' NOT NULL,
	"existing_client_id" uuid,
	"requested_legal_name" varchar(200),
	"requested_activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_responsible" varchar(160),
	"qsa" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_name" varchar(160),
	"contact_phone" varchar(40),
	"contact_email" varchar(200),
	"request_details" text,
	"assigned_to" text,
	"result_cnpj" varchar(14),
	"approved_legal_name" varchar(200),
	"approved_activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"processing_notes" text,
	"informative_id" uuid,
	"created_by" text NOT NULL,
	"returned_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_flows_kind_client_check" CHECK (("company_flows"."kind" = 'opening' AND "company_flows"."existing_client_id" IS NULL) OR ("company_flows"."kind" <> 'opening' AND "company_flows"."existing_client_id" IS NOT NULL)),
	CONSTRAINT "company_flows_result_cnpj_check" CHECK ("company_flows"."result_cnpj" IS NULL OR "company_flows"."result_cnpj" ~ '^\d{14}$')
);
--> statement-breakpoint
-- As chaves compostas abaixo referenciam (org_id, id); o índice único precisa
-- existir antes das constraints de chave estrangeira no PostgreSQL.
CREATE UNIQUE INDEX "company_flows_org_id_uidx" ON "company_flows" USING btree ("org_id","id");--> statement-breakpoint
ALTER TABLE "company_flow_events" ADD CONSTRAINT "company_flow_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flow_events" ADD CONSTRAINT "company_flow_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flow_events" ADD CONSTRAINT "company_flow_events_org_flow_fk" FOREIGN KEY ("org_id","flow_id") REFERENCES "public"."company_flows"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flow_secrets" ADD CONSTRAINT "company_flow_secrets_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flow_secrets" ADD CONSTRAINT "company_flow_secrets_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flow_secrets" ADD CONSTRAINT "company_flow_secrets_org_flow_fk" FOREIGN KEY ("org_id","flow_id") REFERENCES "public"."company_flows"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_org_societario_clan_fk" FOREIGN KEY ("org_id","societario_clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_org_client_fk" FOREIGN KEY ("org_id","existing_client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_flows" ADD CONSTRAINT "company_flows_org_informative_fk" FOREIGN KEY ("org_id","informative_id") REFERENCES "public"."informatives"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_flow_events_org_flow_created_idx" ON "company_flow_events" USING btree ("org_id","flow_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_flow_secrets_org_flow_uidx" ON "company_flow_secrets" USING btree ("org_id","flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_flow_secrets_org_id_uidx" ON "company_flow_secrets" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "company_flows_org_clan_status_idx" ON "company_flows" USING btree ("org_id","societario_clan_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "company_flows_org_assigned_status_idx" ON "company_flows" USING btree ("org_id","assigned_to","status");--> statement-breakpoint
CREATE INDEX "company_flows_org_creator_idx" ON "company_flows" USING btree ("org_id","created_by","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_flows_org_informative_uidx" ON "company_flows" USING btree ("org_id","informative_id") WHERE "company_flows"."informative_id" IS NOT NULL;
--> statement-breakpoint
-- O Fluxo, inclusive o cofre, sempre fica restrito à organização corrente.
-- Eventos são trilha de auditoria append-only: a aplicação não pode apagar
-- nem alterar o registro de que o Societário devolveu uma solicitação.
ALTER TABLE company_flows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE company_flows FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON company_flows
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE company_flow_secrets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE company_flow_secrets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON company_flow_secrets
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE company_flow_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE company_flow_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation_select ON company_flow_events
  FOR SELECT USING (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY org_isolation_insert ON company_flow_events
  FOR INSERT WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON company_flows TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON company_flow_secrets TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON company_flow_events TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON company_flow_events FROM guilda_app;
