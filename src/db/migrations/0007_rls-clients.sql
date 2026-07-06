-- Row Level Security em clients — mesma política das demais tabelas de
-- domínio (ver 0002_rls-domain.sql para o racional do role guilda_app).

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "clients"
  USING ("org_id" = current_setting('app.org_id', true));
