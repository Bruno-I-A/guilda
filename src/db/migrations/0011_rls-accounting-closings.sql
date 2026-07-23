-- Row Level Security do controle anual de fechamentos.
ALTER TABLE "accounting_closings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "accounting_closings"
  USING ("org_id" = current_setting('app.org_id', true));
