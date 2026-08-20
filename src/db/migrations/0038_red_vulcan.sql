CREATE TYPE "public"."fiscal_alias_source" AS ENUM('client_name', 'manual', 'import_reconciliation');--> statement-breakpoint
CREATE TYPE "public"."fiscal_applicability" AS ENUM('required', 'not_required', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."fiscal_control_event_type" AS ENUM('created', 'step_updated', 'status_updated', 'note_updated', 'completed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."fiscal_control_stage" AS ENUM('movements', 'incoming', 'outgoing', 'guide', 'nfs', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."fiscal_control_status" AS ENUM('not_started', 'in_progress', 'blocked', 'completed');--> statement-breakpoint
CREATE TYPE "public"."fiscal_import_batch_status" AS ENUM('pending', 'reconciling', 'ready', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fiscal_import_resolution_method" AS ENUM('exact_alias', 'exact_name', 'fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."fiscal_import_row_status" AS ENUM('pending', 'suggested', 'matched', 'ignored', 'imported', 'error');--> statement-breakpoint
CREATE TYPE "public"."fiscal_profile_event_type" AS ENUM('created', 'updated', 'backfilled', 'imported');--> statement-breakpoint
CREATE TYPE "public"."fiscal_step_status" AS ENUM('not_applicable', 'pending', 'completed', 'blocked');--> statement-breakpoint
CREATE TABLE "fiscal_client_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"alias_name" varchar(240) NOT NULL,
	"normalized_name" varchar(240) NOT NULL,
	"source" "fiscal_alias_source" DEFAULT 'manual' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_client_aliases_normalized_name_check" CHECK (length(btrim("fiscal_client_aliases"."normalized_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_client_profile_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"event_type" "fiscal_profile_event_type" NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_client_profile_events_version_check" CHECK ("fiscal_client_profile_events"."version" >= 1),
	CONSTRAINT "fiscal_client_profile_events_snapshot_version_check" CHECK (("fiscal_client_profile_events"."snapshot" ->> 'version')::integer = "fiscal_client_profile_events"."version")
);
--> statement-breakpoint
CREATE TABLE "fiscal_client_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"movements_applicability" "fiscal_applicability" DEFAULT 'not_applicable' NOT NULL,
	"incoming_applicability" "fiscal_applicability" DEFAULT 'not_applicable' NOT NULL,
	"outgoing_applicability" "fiscal_applicability" DEFAULT 'not_applicable' NOT NULL,
	"guide_applicability" "fiscal_applicability" DEFAULT 'not_applicable' NOT NULL,
	"nfs_applicability" "fiscal_applicability" DEFAULT 'not_applicable' NOT NULL,
	"delivery_channel" varchar(120),
	"factor_r_applicability" "fiscal_applicability" DEFAULT 'not_applicable' NOT NULL,
	"revenue_reference" numeric(15, 2),
	"permanent_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_client_profiles_version_check" CHECK ("fiscal_client_profiles"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fiscal_control_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"control_period_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"event_type" "fiscal_control_event_type" NOT NULL,
	"stage" "fiscal_control_stage",
	"previous_value" jsonb,
	"new_value" jsonb,
	"note" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_control_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"responsible_user_id" text,
	"tax_regime_snapshot" "tax_regime" NOT NULL,
	"campaign_id" uuid,
	"movements_status" "fiscal_step_status" NOT NULL,
	"incoming_status" "fiscal_step_status" NOT NULL,
	"outgoing_status" "fiscal_step_status" NOT NULL,
	"guide_status" "fiscal_step_status" NOT NULL,
	"nfs_status" "fiscal_step_status" NOT NULL,
	"delivery_status" "fiscal_step_status" NOT NULL,
	"status" "fiscal_control_status" DEFAULT 'not_started' NOT NULL,
	"monthly_notes" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_control_periods_month_check" CHECK ("fiscal_control_periods"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "fiscal_control_periods_year_check" CHECK ("fiscal_control_periods"."period_year" BETWEEN 2000 AND 2100),
	CONSTRAINT "fiscal_control_periods_profile_version_check" CHECK ("fiscal_control_periods"."profile_version" >= 1),
	CONSTRAINT "fiscal_control_periods_snapshot_version_check" CHECK (("fiscal_control_periods"."profile_snapshot" ->> 'version')::integer = "fiscal_control_periods"."profile_version"),
	CONSTRAINT "fiscal_control_periods_completion_check" CHECK (("fiscal_control_periods"."status" = 'completed' AND "fiscal_control_periods"."completed_at" IS NOT NULL AND "fiscal_control_periods"."completed_by" IS NOT NULL) OR ("fiscal_control_periods"."status" <> 'completed' AND "fiscal_control_periods"."completed_at" IS NULL AND "fiscal_control_periods"."completed_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "fiscal_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"status" "fiscal_import_batch_status" DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"matched_rows" integer DEFAULT 0 NOT NULL,
	"pending_rows" integer DEFAULT 0 NOT NULL,
	"ignored_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"created_by" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_import_batches_counts_check" CHECK ("fiscal_import_batches"."total_rows" >= 0 AND "fiscal_import_batches"."matched_rows" >= 0 AND "fiscal_import_batches"."pending_rows" >= 0 AND "fiscal_import_batches"."ignored_rows" >= 0 AND "fiscal_import_batches"."error_rows" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"source_name" varchar(240) NOT NULL,
	"normalized_source_name" varchar(240) NOT NULL,
	"raw_data" jsonb NOT NULL,
	"status" "fiscal_import_row_status" DEFAULT 'pending' NOT NULL,
	"suggested_client_id" uuid,
	"resolved_client_id" uuid,
	"resolved_alias_id" uuid,
	"match_confidence" numeric(5, 4),
	"resolution_method" "fiscal_import_resolution_method",
	"resolved_by" text,
	"resolution_note" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_import_rows_row_number_check" CHECK ("fiscal_import_rows"."row_number" >= 1),
	CONSTRAINT "fiscal_import_rows_confidence_check" CHECK ("fiscal_import_rows"."match_confidence" IS NULL OR ("fiscal_import_rows"."match_confidence" >= 0 AND "fiscal_import_rows"."match_confidence" <= 1)),
	CONSTRAINT "fiscal_import_rows_resolved_check" CHECK ("fiscal_import_rows"."status" NOT IN ('matched', 'imported') OR "fiscal_import_rows"."resolved_client_id" IS NOT NULL)
);
--> statement-breakpoint
-- FKs compostas criadas abaixo precisam das chaves candidatas antes do
-- ALTER TABLE. O drizzle-kit normalmente emite todos os índices no final.
CREATE UNIQUE INDEX "clients_org_id_uidx" ON "clients" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_client_profiles_org_id_uidx" ON "fiscal_client_profiles" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_import_batches_org_id_uidx" ON "fiscal_import_batches" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_control_periods_org_id_uidx" ON "fiscal_control_periods" USING btree ("org_id","id");--> statement-breakpoint
ALTER TABLE "fiscal_client_aliases" ADD CONSTRAINT "fiscal_client_aliases_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_aliases" ADD CONSTRAINT "fiscal_client_aliases_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_aliases" ADD CONSTRAINT "fiscal_client_aliases_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profile_events" ADD CONSTRAINT "fiscal_client_profile_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profile_events" ADD CONSTRAINT "fiscal_client_profile_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profile_events" ADD CONSTRAINT "fiscal_client_profile_events_org_profile_fk" FOREIGN KEY ("org_id","profile_id") REFERENCES "public"."fiscal_client_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profile_events" ADD CONSTRAINT "fiscal_client_profile_events_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD CONSTRAINT "fiscal_client_profiles_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD CONSTRAINT "fiscal_client_profiles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD CONSTRAINT "fiscal_client_profiles_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ADD CONSTRAINT "fiscal_client_profiles_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_events" ADD CONSTRAINT "fiscal_control_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_events" ADD CONSTRAINT "fiscal_control_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_events" ADD CONSTRAINT "fiscal_control_events_org_period_fk" FOREIGN KEY ("org_id","control_period_id") REFERENCES "public"."fiscal_control_periods"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_events" ADD CONSTRAINT "fiscal_control_events_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_responsible_user_id_user_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_campaign_id_clan_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."clan_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_control_periods" ADD CONSTRAINT "fiscal_control_periods_org_profile_fk" FOREIGN KEY ("org_id","profile_id") REFERENCES "public"."fiscal_client_profiles"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_batches" ADD CONSTRAINT "fiscal_import_batches_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_batches" ADD CONSTRAINT "fiscal_import_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_rows" ADD CONSTRAINT "fiscal_import_rows_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_rows" ADD CONSTRAINT "fiscal_import_rows_suggested_client_id_clients_id_fk" FOREIGN KEY ("suggested_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_rows" ADD CONSTRAINT "fiscal_import_rows_resolved_client_id_clients_id_fk" FOREIGN KEY ("resolved_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_rows" ADD CONSTRAINT "fiscal_import_rows_resolved_alias_id_fiscal_client_aliases_id_fk" FOREIGN KEY ("resolved_alias_id") REFERENCES "public"."fiscal_client_aliases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_rows" ADD CONSTRAINT "fiscal_import_rows_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_import_rows" ADD CONSTRAINT "fiscal_import_rows_org_batch_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."fiscal_import_batches"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_client_aliases_org_normalized_name_uidx" ON "fiscal_client_aliases" USING btree ("org_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_client_aliases_org_id_uidx" ON "fiscal_client_aliases" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "fiscal_client_aliases_org_client_idx" ON "fiscal_client_aliases" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_client_profile_events_org_profile_version_uidx" ON "fiscal_client_profile_events" USING btree ("org_id","profile_id","version");--> statement-breakpoint
CREATE INDEX "fiscal_client_profile_events_org_client_idx" ON "fiscal_client_profile_events" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_client_profiles_org_client_uidx" ON "fiscal_client_profiles" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "fiscal_control_events_org_period_created_idx" ON "fiscal_control_events" USING btree ("org_id","control_period_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_control_periods_org_client_period_uidx" ON "fiscal_control_periods" USING btree ("org_id","client_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "fiscal_control_periods_org_period_status_idx" ON "fiscal_control_periods" USING btree ("org_id","period_year","period_month","status");--> statement-breakpoint
CREATE INDEX "fiscal_control_periods_org_responsible_idx" ON "fiscal_control_periods" USING btree ("org_id","responsible_user_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "fiscal_import_batches_org_created_idx" ON "fiscal_import_batches" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_import_rows_org_batch_row_uidx" ON "fiscal_import_rows" USING btree ("org_id","batch_id","row_number");--> statement-breakpoint
CREATE INDEX "fiscal_import_rows_org_status_idx" ON "fiscal_import_rows" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "clan_campaigns_org_id_uidx" ON "clan_campaigns" USING btree ("org_id","id");--> statement-breakpoint
-- `clients_org_id_uidx` foi criado antes das FKs compostas.

-- A Ficha Fiscal pertence à empresa, não à carteira. O backfill cria uma
-- ficha para todo cliente (inclusive inativo) sem sobrescrever nota já
-- existente. A ordem das fontes recupera a informação que o fluxo antigo
-- tornava invisível após a atribuição: pendência -> carteira -> último evento.
WITH latest_portfolio_event AS (
  SELECT DISTINCT ON (e.org_id, e.client_id)
    e.org_id,
    e.client_id,
    NULLIF(btrim(e.note), '') AS note
  FROM fiscal_portfolio_events e
  WHERE NULLIF(btrim(e.note), '') IS NOT NULL
  ORDER BY e.org_id, e.client_id, e.created_at DESC, e.id DESC
)
INSERT INTO fiscal_client_profiles (org_id, client_id, permanent_notes)
SELECT
  c.org_id,
  c.id,
  COALESCE(
    NULLIF(btrim(c.pending_fiscal_note), ''),
    NULLIF(btrim(fp.notes), ''),
    lpe.note
  )
FROM clients c
LEFT JOIN fiscal_portfolios fp
  ON fp.org_id = c.org_id AND fp.client_id = c.id
LEFT JOIN latest_portfolio_event lpe
  ON lpe.org_id = c.org_id AND lpe.client_id = c.id
ON CONFLICT (org_id, client_id) DO UPDATE
SET permanent_notes = COALESCE(
  NULLIF(btrim(fiscal_client_profiles.permanent_notes), ''),
  EXCLUDED.permanent_notes
);--> statement-breakpoint

-- Registra o estado inicial recuperado. O valor monetário vira texto no JSON
-- para casar com o tipo `numeric` retornado pelo Drizzle sem perda de precisão.
INSERT INTO fiscal_client_profile_events (
  org_id,
  profile_id,
  client_id,
  event_type,
  version,
  snapshot,
  changed_fields
)
SELECT
  p.org_id,
  p.id,
  p.client_id,
  'backfilled',
  p.version,
  jsonb_build_object(
    'version', p.version,
    'movementsApplicability', p.movements_applicability,
    'incomingApplicability', p.incoming_applicability,
    'outgoingApplicability', p.outgoing_applicability,
    'guideApplicability', p.guide_applicability,
    'nfsApplicability', p.nfs_applicability,
    'deliveryChannel', p.delivery_channel,
    'factorRApplicability', p.factor_r_applicability,
    'revenueReference', p.revenue_reference::text,
    'permanentNotes', p.permanent_notes
  ),
  CASE
    WHEN p.permanent_notes IS NULL THEN '[]'::jsonb
    ELSE '["permanentNotes"]'::jsonb
  END
FROM fiscal_client_profiles p
ON CONFLICT (org_id, profile_id, version) DO NOTHING;--> statement-breakpoint

-- O nome oficial já é um alias útil. Só nomes normalizados unívocos entram
-- automaticamente; colisões ficam para a conciliação humana, sem escolha
-- arbitrária de empresa.
WITH normalized_clients AS (
  SELECT
    c.org_id,
    c.id AS client_id,
    c.name AS alias_name,
    btrim(regexp_replace(
      translate(
        lower(c.name),
        'áàâãäåéèêëíìîïóòôõöúùûüçñ',
        'aaaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )) AS normalized_name
  FROM clients c
), unique_names AS (
  SELECT org_id, normalized_name
  FROM normalized_clients
  WHERE normalized_name <> ''
  GROUP BY org_id, normalized_name
  HAVING count(*) = 1
)
INSERT INTO fiscal_client_aliases (
  org_id,
  client_id,
  alias_name,
  normalized_name,
  source
)
SELECT
  nc.org_id,
  nc.client_id,
  nc.alias_name,
  nc.normalized_name,
  'client_name'
FROM normalized_clients nc
INNER JOIN unique_names un
  ON un.org_id = nc.org_id AND un.normalized_name = nc.normalized_name
ON CONFLICT (org_id, normalized_name) DO NOTHING;--> statement-breakpoint

-- Defesa em profundidade: uma competência guarda o retrato com que nasceu.
-- As actions podem atualizar apenas andamento, notas e auditoria operacional.
CREATE FUNCTION public.guard_fiscal_control_period_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.period_year IS DISTINCT FROM OLD.period_year
    OR NEW.period_month IS DISTINCT FROM OLD.period_month
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.profile_version IS DISTINCT FROM OLD.profile_version
    OR NEW.profile_snapshot IS DISTINCT FROM OLD.profile_snapshot
    OR NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id
    OR NEW.tax_regime_snapshot IS DISTINCT FROM OLD.tax_regime_snapshot
  THEN
    RAISE EXCEPTION 'O snapshot de uma competência fiscal é imutável'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER fiscal_control_period_snapshot_immutable
BEFORE UPDATE ON fiscal_control_periods
FOR EACH ROW
EXECUTE FUNCTION public.guard_fiscal_control_period_snapshot();--> statement-breakpoint

REVOKE ALL ON FUNCTION public.guard_fiscal_control_period_snapshot() FROM PUBLIC;--> statement-breakpoint

-- RLS tenant-aware em todas as tabelas novas. Históricos aceitam somente
-- leitura e inclusão: não existe policy de UPDATE/DELETE para esses eventos.
ALTER TABLE fiscal_client_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_client_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON fiscal_client_profiles
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE fiscal_client_profile_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_client_profile_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation_select ON fiscal_client_profile_events
  FOR SELECT USING (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY org_isolation_insert ON fiscal_client_profile_events
  FOR INSERT WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE fiscal_client_aliases ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_client_aliases FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON fiscal_client_aliases
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE fiscal_import_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_import_batches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON fiscal_import_batches
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE fiscal_import_rows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_import_rows FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON fiscal_import_rows
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE fiscal_control_periods ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_control_periods FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON fiscal_control_periods
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE fiscal_control_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_control_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation_select ON fiscal_control_events
  FOR SELECT USING (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY org_isolation_insert ON fiscal_control_events
  FOR INSERT WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_client_profiles TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON fiscal_client_profile_events TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON fiscal_client_profile_events FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_client_aliases TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_import_batches TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_import_rows TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_control_periods TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON fiscal_control_events TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON fiscal_control_events FROM guilda_app;
