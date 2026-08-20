-- Reaplica a versão definitiva do guard para bancos que receberam uma versão
-- inicial do 0038. O vínculo com campanha é metadado operacional e pode ser
-- preenchido depois; os snapshots de ficha, responsável e regime não mudam.
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
$$;
