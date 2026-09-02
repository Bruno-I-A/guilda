-- FORCE ROW LEVEL SECURITY nas 12 tabelas de dominio que ficaram so com
-- ENABLE. Fecha a divida aberta na 0002/0004/0007/0009/0011/0017: as 30
-- tabelas criadas a partir da 0022 ja forcam, estas nao.
--
-- Sem FORCE o DONO da tabela ignora a politica. Em operacao normal isso nao
-- abria furo (a aplicacao conecta com guilda_app, nao-owner), mas o proprio
-- scripts/start-production.mjs preve o deploy em que MIGRATION_DATABASE_URL
-- esta ausente e as migrations rodam com DATABASE_URL — se as duas apontarem
-- para o mesmo role, o isolamento continuaria valendo nas 30 tabelas com
-- FORCE e sumiria em tasks, xp_ledger, clients e accounting_closings.
--
-- ATENCAO para migrations futuras: com FORCE, um backfill que rode como owner
-- tambem passa a obedecer a politica. O precedente esta na 0041 — desligar com
-- NO FORCE, fazer o backfill e religar no mesmo arquivo.

ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "xp_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_closings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_closing_years" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mission_template_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_outbox" FORCE ROW LEVEL SECURITY;
