-- xp_ledger_org_task_event_fk era uma FK COMPOSTA (org_id, task_event_id).
-- ON DELETE SET NULL numa FK composta zera TODAS as colunas da FK — inclusive
-- org_id, que é NOT NULL em xp_ledger. Isso quebrava a exclusão em cascata de
-- empresa-cliente (achado em teste manual: "null value in column org_id...
-- violates not-null constraint"). Troca para uma FK simples só em
-- task_event_id, no mesmo padrão já usado por task_id e closing_year_id
-- nesta mesma tabela — nenhuma das duas tem checagem de org na FK, então
-- esta não deveria ter sido diferente.
ALTER TABLE "xp_ledger" DROP CONSTRAINT "xp_ledger_org_task_event_fk";
--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_task_event_id_task_events_id_fk" FOREIGN KEY ("task_event_id") REFERENCES "public"."task_events"("id") ON DELETE set null ON UPDATE no action;
