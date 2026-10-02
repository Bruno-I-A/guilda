-- O teto diario de desafios pagos saiu (decisao do Bruno, 02/10/2026). Desafio
-- que terminou sem XP so por causa do teto recebe o premio agora, pelo mesmo
-- criterio do sync: a base sempre, o bonus se foi no prazo, e so enquanto o
-- periodo continua fechado por quem rolou. Primeiro o ledger (que ainda
-- enxerga "capped"), depois o premio congelado, e so entao as colunas saem.
-- Desafio com teto nunca teve lancamento (premio 0), dai o NOT EXISTS.
INSERT INTO "xp_ledger" ("org_id", "user_id", "closing_challenge_id", "amount", "reason")
SELECT c."org_id", c."user_id", c."id",
       c."base_xp" + CASE WHEN c."in_time" THEN c."bonus_xp" ELSE 0 END,
       'closing_challenge'
  FROM "closing_challenges" c
  JOIN "accounting_closings" p
    ON p."id" = c."closing_id"
   AND p."status" = 'completed'
   AND p."completed_by" = c."user_id"
 WHERE c."status" = 'completed'
   AND c."capped"
   AND c."base_xp" + CASE WHEN c."in_time" THEN c."bonus_xp" ELSE 0 END > 0
   AND NOT EXISTS (
     SELECT 1 FROM "xp_ledger" l WHERE l."closing_challenge_id" = c."id"
   );--> statement-breakpoint
UPDATE "closing_challenges"
   SET "awarded_xp" = "base_xp" + CASE WHEN "in_time" THEN "bonus_xp" ELSE 0 END
 WHERE "status" = 'completed' AND "capped";--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" DROP CONSTRAINT "closing_challenge_settings_limits";--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" DROP COLUMN "daily_paid_cap";--> statement-breakpoint
ALTER TABLE "closing_challenges" DROP COLUMN "capped";--> statement-breakpoint
ALTER TABLE "closing_challenge_settings" ADD CONSTRAINT "closing_challenge_settings_limits" CHECK ("closing_challenge_settings"."time_limit_minutes" between 5 and 240 and "closing_challenge_settings"."base_xp" between 0 and 100 and "closing_challenge_settings"."bonus_xp" between 0 and 100);
