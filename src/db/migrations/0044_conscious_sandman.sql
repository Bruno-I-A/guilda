ALTER TYPE "public"."fiscal_control_event_type" ADD VALUE 'profile_synced' BEFORE 'campaign_linked';
--> statement-breakpoint
-- A Ficha Fiscal pode ser corrigida antes de qualquer atividade do mês.
-- Depois que o controle sai de "não iniciado", o snapshot continua sendo o
-- retrato histórico daquela competência. Responsável e regime nunca mudam.
CREATE OR REPLACE FUNCTION public.guard_fiscal_control_period_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.period_year IS DISTINCT FROM OLD.period_year
    OR NEW.period_month IS DISTINCT FROM OLD.period_month
    OR NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id
    OR NEW.tax_regime_snapshot IS DISTINCT FROM OLD.tax_regime_snapshot
  THEN
    RAISE EXCEPTION 'Os dados permanentes de uma competência fiscal são imutáveis'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.profile_version IS DISTINCT FROM OLD.profile_version
    OR NEW.profile_snapshot IS DISTINCT FROM OLD.profile_snapshot
  ) AND OLD.status <> 'not_started' THEN
    RAISE EXCEPTION 'A Ficha Fiscal só pode ser sincronizada antes do início da competência'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
