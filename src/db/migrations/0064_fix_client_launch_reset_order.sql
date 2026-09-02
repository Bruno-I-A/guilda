-- Corrige a ordem da limpeza da virada para a base real: compromissos podem
-- apontar para informativos e, por isso, precisam ser removidos primeiro.
CREATE OR REPLACE FUNCTION reset_org_operational_data_for_launch(p_org_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_org_id IS NULL OR p_org_id = '' OR
     p_org_id IS DISTINCT FROM current_setting('app.org_id', true) THEN
    RAISE EXCEPTION 'Organização inválida para a limpeza';
  END IF;

  DELETE FROM company_flow_events WHERE org_id = p_org_id;
  DELETE FROM company_flow_secrets WHERE org_id = p_org_id;
  DELETE FROM company_flows WHERE org_id = p_org_id;
  DELETE FROM guild_notice_reads WHERE org_id = p_org_id;
  DELETE FROM guild_notices WHERE org_id = p_org_id;
  DELETE FROM telegram_outbox WHERE org_id = p_org_id;
  DELETE FROM xp_ledger WHERE org_id = p_org_id;
  DELETE FROM task_assignee_suggestions WHERE org_id = p_org_id;
  DELETE FROM task_transfers WHERE org_id = p_org_id;
  DELETE FROM task_events WHERE org_id = p_org_id;
  DELETE FROM tasks WHERE org_id = p_org_id;
  DELETE FROM client_commitment_periods WHERE org_id = p_org_id;
  DELETE FROM client_commitments WHERE org_id = p_org_id;
  DELETE FROM informatives WHERE org_id = p_org_id;
  DELETE FROM fiscal_control_events WHERE org_id = p_org_id;
  DELETE FROM fiscal_control_periods WHERE org_id = p_org_id;
  DELETE FROM office_fee_control_events WHERE org_id = p_org_id;
  DELETE FROM office_fee_control_periods WHERE org_id = p_org_id;
  DELETE FROM fiscal_client_profile_events WHERE org_id = p_org_id;
  DELETE FROM fiscal_client_aliases WHERE org_id = p_org_id;
  DELETE FROM fiscal_client_profiles WHERE org_id = p_org_id;
  DELETE FROM office_fee_profile_events WHERE org_id = p_org_id;
  DELETE FROM office_fee_profiles WHERE org_id = p_org_id;
  DELETE FROM fiscal_installment_issuances WHERE org_id = p_org_id;
  DELETE FROM fiscal_installments WHERE org_id = p_org_id;
  DELETE FROM fiscal_import_rows WHERE org_id = p_org_id;
  DELETE FROM fiscal_import_batches WHERE org_id = p_org_id;
  DELETE FROM fiscal_portfolio_events WHERE org_id = p_org_id;
  DELETE FROM fiscal_portfolios WHERE org_id = p_org_id;
  DELETE FROM accounting_closings WHERE org_id = p_org_id;
  DELETE FROM accounting_closing_years WHERE org_id = p_org_id;
  DELETE FROM clan_campaigns WHERE org_id = p_org_id;
  DELETE FROM client_import_batches WHERE org_id = p_org_id;
  DELETE FROM clients WHERE org_id = p_org_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION reset_org_operational_data_for_launch(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION reset_org_operational_data_for_launch(text) TO guilda_app;
