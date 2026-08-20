CREATE TYPE "public"."fiscal_import_kind" AS ENUM('fiscal_profile', 'office_fee');--> statement-breakpoint
CREATE TYPE "public"."office_fee_billing_method" AS ENUM('asaas', 'recibo', 'pix', 'other');--> statement-breakpoint
CREATE TYPE "public"."office_fee_control_event_type" AS ENUM('created', 'step_updated', 'status_updated', 'note_updated', 'completed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."office_fee_control_stage" AS ENUM('invoice', 'additional_installment', 'collection');--> statement-breakpoint
CREATE TYPE "public"."office_fee_profile_event_type" AS ENUM('created', 'updated', 'imported');--> statement-breakpoint
ALTER TYPE "public"."fiscal_import_resolution_method" ADD VALUE 'exact_cnpj' BEFORE 'fuzzy';--> statement-breakpoint
CREATE TABLE "office_fee_control_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"control_period_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"event_type" "office_fee_control_event_type" NOT NULL,
	"stage" "office_fee_control_stage",
	"previous_value" jsonb,
	"new_value" jsonb,
	"note" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_fee_control_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"client_name_snapshot" varchar(200) NOT NULL,
	"client_cnpj_snapshot" varchar(14),
	"profile_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"responsible_user_id" text,
	"invoice_status" "fiscal_step_status" NOT NULL,
	"additional_installment_status" "fiscal_step_status" NOT NULL,
	"collection_status" "fiscal_step_status" NOT NULL,
	"status" "fiscal_control_status" DEFAULT 'not_started' NOT NULL,
	"monthly_notes" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_fee_control_periods_month_check" CHECK ("office_fee_control_periods"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "office_fee_control_periods_year_check" CHECK ("office_fee_control_periods"."period_year" BETWEEN 2000 AND 2100),
	CONSTRAINT "office_fee_control_periods_profile_version_check" CHECK ("office_fee_control_periods"."profile_version" >= 1),
	CONSTRAINT "office_fee_control_periods_snapshot_version_check" CHECK (("office_fee_control_periods"."profile_snapshot" ->> 'version')::integer = "office_fee_control_periods"."profile_version"),
	CONSTRAINT "office_fee_control_periods_completion_check" CHECK (("office_fee_control_periods"."status" = 'completed' AND "office_fee_control_periods"."completed_at" IS NOT NULL AND "office_fee_control_periods"."completed_by" IS NOT NULL) OR ("office_fee_control_periods"."status" <> 'completed' AND "office_fee_control_periods"."completed_at" IS NULL AND "office_fee_control_periods"."completed_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "office_fee_profile_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"event_type" "office_fee_profile_event_type" NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_fee_profile_events_version_check" CHECK ("office_fee_profile_events"."version" >= 1),
	CONSTRAINT "office_fee_profile_events_snapshot_version_check" CHECK (("office_fee_profile_events"."snapshot" ->> 'version')::integer = "office_fee_profile_events"."version")
);
--> statement-breakpoint
CREATE TABLE "office_fee_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"billing_method" "office_fee_billing_method" NOT NULL,
	"charges_additional_installment" boolean DEFAULT false NOT NULL,
	"monthly_fee" numeric(15, 2) NOT NULL,
	"permanent_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_fee_profiles_version_check" CHECK ("office_fee_profiles"."version" >= 1),
	CONSTRAINT "office_fee_profiles_monthly_fee_check" CHECK ("office_fee_profiles"."monthly_fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_import_batches" ADD COLUMN "kind" "fiscal_import_kind" DEFAULT 'fiscal_profile' NOT NULL;--> statement-breakpoint
-- As FKs compostas precisam de chaves candidatas já existentes. O
-- drizzle-kit emite os índices no fim; aqui antecipamos somente os dois
-- índices de identidade usados pelas referências compostas abaixo.
CREATE UNIQUE INDEX "office_fee_control_periods_org_id_uidx" ON "office_fee_control_periods" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_profiles_org_id_uidx" ON "office_fee_profiles" USING btree ("org_id","id");--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ADD CONSTRAINT "office_fee_control_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ADD CONSTRAINT "office_fee_control_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ADD CONSTRAINT "office_fee_control_events_org_period_fk" FOREIGN KEY ("org_id","control_period_id") REFERENCES "public"."office_fee_control_periods"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_events" ADD CONSTRAINT "office_fee_control_events_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_responsible_user_id_user_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_control_periods" ADD CONSTRAINT "office_fee_control_periods_org_profile_fk" FOREIGN KEY ("org_id","profile_id") REFERENCES "public"."office_fee_profiles"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ADD CONSTRAINT "office_fee_profile_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ADD CONSTRAINT "office_fee_profile_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ADD CONSTRAINT "office_fee_profile_events_org_profile_fk" FOREIGN KEY ("org_id","profile_id") REFERENCES "public"."office_fee_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profile_events" ADD CONSTRAINT "office_fee_profile_events_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ADD CONSTRAINT "office_fee_profiles_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ADD CONSTRAINT "office_fee_profiles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ADD CONSTRAINT "office_fee_profiles_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_fee_profiles" ADD CONSTRAINT "office_fee_profiles_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_fee_control_events_org_period_created_idx" ON "office_fee_control_events" USING btree ("org_id","control_period_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_control_periods_org_client_period_uidx" ON "office_fee_control_periods" USING btree ("org_id","client_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "office_fee_control_periods_org_period_status_idx" ON "office_fee_control_periods" USING btree ("org_id","period_year","period_month","status");--> statement-breakpoint
CREATE INDEX "office_fee_control_periods_org_responsible_idx" ON "office_fee_control_periods" USING btree ("org_id","responsible_user_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_profile_events_org_profile_version_uidx" ON "office_fee_profile_events" USING btree ("org_id","profile_id","version");--> statement-breakpoint
CREATE INDEX "office_fee_profile_events_org_client_idx" ON "office_fee_profile_events" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_fee_profiles_org_client_uidx" ON "office_fee_profiles" USING btree ("org_id","client_id");--> statement-breakpoint
-- A competência é o retrato histórico do contrato de honorários no mês em
-- que foi aberto. Andamento e observações seguem editáveis, mas empresa,
-- período, responsável e condições não podem ser reescritos depois.
CREATE FUNCTION public.guard_office_fee_control_period_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.period_year IS DISTINCT FROM OLD.period_year
    OR NEW.period_month IS DISTINCT FROM OLD.period_month
    OR NEW.client_name_snapshot IS DISTINCT FROM OLD.client_name_snapshot
    OR NEW.client_cnpj_snapshot IS DISTINCT FROM OLD.client_cnpj_snapshot
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.profile_version IS DISTINCT FROM OLD.profile_version
    OR NEW.profile_snapshot IS DISTINCT FROM OLD.profile_snapshot
    OR NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id
  THEN
    RAISE EXCEPTION 'O snapshot de uma competência de honorários é imutável'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER office_fee_control_period_snapshot_immutable
BEFORE UPDATE ON office_fee_control_periods
FOR EACH ROW
EXECUTE FUNCTION public.guard_office_fee_control_period_snapshot();--> statement-breakpoint

REVOKE ALL ON FUNCTION public.guard_office_fee_control_period_snapshot() FROM PUBLIC;--> statement-breakpoint

-- As fichas e o controle mensal obedecem ao mesmo isolamento por organização
-- das demais áreas fiscais. Eventos são append-only por policy e privilégio.
ALTER TABLE office_fee_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE office_fee_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON office_fee_profiles
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE office_fee_profile_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE office_fee_profile_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation_select ON office_fee_profile_events
  FOR SELECT USING (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY org_isolation_insert ON office_fee_profile_events
  FOR INSERT WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE office_fee_control_periods ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE office_fee_control_periods FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON office_fee_control_periods
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE office_fee_control_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE office_fee_control_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation_select ON office_fee_control_events
  FOR SELECT USING (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY org_isolation_insert ON office_fee_control_events
  FOR INSERT WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON office_fee_profiles TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON office_fee_profile_events TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON office_fee_profile_events FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON office_fee_control_periods TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON office_fee_control_events TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON office_fee_control_events FROM guilda_app;
