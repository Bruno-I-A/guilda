-- Row Level Security nas tabelas de compromisso recorrente por empresa.
-- Mesma política das demais tabelas de domínio (ver 0002_rls-domain.sql para
-- o racional do role guilda_app) e com FORCE, como as tabelas criadas a
-- partir da 0023 — sem FORCE o OWNER da tabela ignora a política.

ALTER TABLE "client_commitments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_commitments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_commitments"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "client_commitment_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_commitment_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_commitment_periods"
  USING ("org_id" = current_setting('app.org_id', true));
