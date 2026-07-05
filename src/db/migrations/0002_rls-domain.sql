-- Row Level Security nas tabelas de domínio (defesa em profundidade).
-- A aplicação seta `SELECT set_config('app.org_id', $1, true)` no início de
-- cada transação (ver src/db/org-tx.ts) usando um role NÃO-superuser e
-- NÃO-owner (guilda_app) — RLS não se aplica a superuser nem ao owner
-- sem FORCE, por isso o role dedicado é obrigatório.
--
-- A política vale para ALL (SELECT/INSERT/UPDATE/DELETE); com USING sem
-- WITH CHECK explícito, o Postgres aplica a MESMA expressão a linhas novas,
-- então INSERT fora da org ativa também é bloqueado.

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "tasks"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "task_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "task_events"
  USING ("org_id" = current_setting('app.org_id', true));
