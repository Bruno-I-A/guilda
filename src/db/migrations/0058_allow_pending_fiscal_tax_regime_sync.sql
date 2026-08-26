-- Uma Alteração Societária pode mudar o regime tributário da empresa. O novo
-- regime deve alcançar somente competências que ainda não começaram; períodos
-- em andamento ou concluídos continuam preservando o retrato histórico.
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
  THEN
    RAISE EXCEPTION 'Os dados permanentes de uma competência fiscal são imutáveis'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.profile_version IS DISTINCT FROM OLD.profile_version
    OR NEW.profile_snapshot IS DISTINCT FROM OLD.profile_snapshot
    OR NEW.tax_regime_snapshot IS DISTINCT FROM OLD.tax_regime_snapshot
  ) AND OLD.status <> 'not_started' THEN
    RAISE EXCEPTION 'A Ficha Fiscal e o regime tributário só podem ser sincronizados antes do início da competência'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
