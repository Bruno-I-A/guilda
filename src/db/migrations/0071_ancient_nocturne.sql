DROP INDEX "xp_ledger_closing_year_closed_uidx";--> statement-breakpoint
CREATE INDEX "xp_ledger_closing_year_idx" ON "xp_ledger" USING btree ("org_id","closing_year_id");