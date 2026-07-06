-- Row Level Security nas tabelas de template de campanha — mesma política
-- das demais tabelas de domínio (ver 0002_rls-domain.sql para o racional).

ALTER TABLE "mission_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "mission_templates"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "mission_template_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "mission_template_items"
  USING ("org_id" = current_setting('app.org_id', true));
