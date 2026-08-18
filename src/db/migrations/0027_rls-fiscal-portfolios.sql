-- Row Level Security nas tabelas da carteira fiscal e das campanhas de clã.
-- Mesma política das demais tabelas de domínio (ver 0002_rls-domain.sql para
-- o racional do role guilda_app) e com FORCE, como as tabelas criadas a
-- partir da 0023 — sem FORCE o OWNER da tabela ignora a política.

ALTER TABLE "fiscal_portfolios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_portfolios" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "fiscal_portfolios"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "fiscal_portfolio_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "fiscal_portfolio_events"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "clan_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clan_campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "clan_campaigns"
  USING ("org_id" = current_setting('app.org_id', true));
