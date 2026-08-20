ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "movements_applicability" SET DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "incoming_applicability" SET DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "outgoing_applicability" SET DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "guide_applicability" SET DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "nfs_applicability" SET DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "fiscal_client_profiles" ALTER COLUMN "factor_r_applicability" SET DEFAULT 'unknown';--> statement-breakpoint

-- Perfis criados pelo backfill de 0038 ainda não receberam uma decisão
-- humana sobre as etapas. "unknown" impede que ausência de informação seja
-- confundida com "não se aplica" e mantém a ficha visivelmente incompleta.
-- O migrador também pode rodar como owner não-superuser. FORCE RLS se aplica
-- ao owner, por isso suspendemos apenas durante este backfill global e
-- restauramos a defesa ainda na mesma transação.
ALTER TABLE fiscal_client_profiles NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_client_profile_events NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE fiscal_client_profiles
SET
  movements_applicability = 'unknown',
  incoming_applicability = 'unknown',
  outgoing_applicability = 'unknown',
  guide_applicability = 'unknown',
  nfs_applicability = 'unknown',
  factor_r_applicability = 'unknown',
  version = version + 1,
  updated_at = now()
WHERE created_by IS NULL
  AND updated_by IS NULL
  AND version = 1;--> statement-breakpoint

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
  '["movementsApplicability","incomingApplicability","outgoingApplicability","guideApplicability","nfsApplicability","factorRApplicability"]'::jsonb
FROM fiscal_client_profiles p
WHERE p.created_by IS NULL
  AND p.updated_by IS NULL
  AND p.version = 2
ON CONFLICT (org_id, profile_id, version) DO NOTHING;--> statement-breakpoint

ALTER TABLE fiscal_client_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_client_profile_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- O histórico antigo da carteira passa a seguir a mesma regra dos novos
-- eventos fiscais: somente INSERT e SELECT para o role da aplicação.
DROP POLICY IF EXISTS org_isolation ON fiscal_portfolio_events;--> statement-breakpoint
CREATE POLICY org_isolation_select ON fiscal_portfolio_events
  FOR SELECT USING (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY org_isolation_insert ON fiscal_portfolio_events
  FOR INSERT WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
REVOKE UPDATE, DELETE ON fiscal_portfolio_events FROM guilda_app;--> statement-breakpoint

-- Remover um membro da organização não pode deixar empresas atribuídas
-- a uma pessoa que já não integra o Fiscal. O trigger compartilha o mutex de
-- clãs com as actions de carteira.
CREATE OR REPLACE FUNCTION public.guard_and_cleanup_removed_member_clans()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  orphaned_clans text;
BEGIN
  IF current_setting('app.deleting_org_id', true) = OLD."organization_id" THEN
    RETURN OLD;
  END IF;

  PERFORM set_config('app.org_id', OLD."organization_id", true);

  PERFORM locked."id"
  FROM (
    SELECT "id"
    FROM "clans"
    WHERE "org_id" = OLD."organization_id"
      AND "active" = true
    ORDER BY "id"
    FOR UPDATE
  ) AS locked;

  IF EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "org_id" = OLD."organization_id"
      AND "assignee_id" = OLD."user_id"
      AND "status" IN ('pending', 'in_progress', 'awaiting_approval', 'rejected')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transfira ou conclua as missões ativas desta pessoa antes de removê-la.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "fiscal_portfolios"
    WHERE "org_id" = OLD."organization_id"
      AND "user_id" = OLD."user_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transfira as empresas da carteira fiscal desta pessoa antes de removê-la.';
  END IF;

  SELECT string_agg(c."name", ', ' ORDER BY c."name")
  INTO orphaned_clans
  FROM "clan_memberships" AS target
  INNER JOIN "clans" AS c
    ON c."org_id" = target."org_id"
   AND c."id" = target."clan_id"
  WHERE target."org_id" = OLD."organization_id"
    AND target."user_id" = OLD."user_id"
    AND target."is_leader" = true
    AND c."active" = true
    AND NOT EXISTS (
      SELECT 1
      FROM "clan_memberships" AS other
      INNER JOIN "member" AS active_member
        ON active_member."organization_id" = other."org_id"
       AND active_member."user_id" = other."user_id"
      WHERE other."org_id" = target."org_id"
        AND other."clan_id" = target."clan_id"
        AND other."user_id" <> OLD."user_id"
        AND other."is_leader" = true
    );

  IF orphaned_clans IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Defina outro líder antes de remover este membro dos clãs: ' || orphaned_clans || '.';
  END IF;

  DELETE FROM "clan_memberships"
  WHERE "org_id" = OLD."organization_id"
    AND "user_id" = OLD."user_id";

  RETURN OLD;
END;
$$;
