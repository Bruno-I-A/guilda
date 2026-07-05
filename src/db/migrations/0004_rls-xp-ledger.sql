-- RLS + imutabilidade do ledger de XP.

ALTER TABLE "xp_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "xp_ledger"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- Ledger IMUTÁVEL também no nível do banco: o role da aplicação só pode
-- ler e inserir. Estornos são novos lançamentos negativos ('reversal'),
-- nunca UPDATE/DELETE do crédito original.
REVOKE UPDATE, DELETE ON "xp_ledger" FROM guilda_app;
