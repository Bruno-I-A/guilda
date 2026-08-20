ALTER TABLE "accounting_closing_years" DROP CONSTRAINT "accounting_closing_years_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "accounting_closings" DROP CONSTRAINT "accounting_closings_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "client_commitments" DROP CONSTRAINT "client_commitments_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" DROP CONSTRAINT "fiscal_portfolio_events_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "fiscal_portfolios" DROP CONSTRAINT "fiscal_portfolios_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "guild_notices" DROP CONSTRAINT "guild_notices_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "task_events" DROP CONSTRAINT "task_events_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "task_transfers" DROP CONSTRAINT "task_transfers_org_task_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "xp_ledger" DROP CONSTRAINT "xp_ledger_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "xp_ledger" DROP CONSTRAINT "xp_ledger_closing_year_id_accounting_closing_years_id_fk";
--> statement-breakpoint
ALTER TABLE "accounting_closing_years" ADD CONSTRAINT "accounting_closing_years_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD CONSTRAINT "accounting_closings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" ADD CONSTRAINT "fiscal_portfolio_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolios" ADD CONSTRAINT "fiscal_portfolios_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notices" ADD CONSTRAINT "guild_notices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_org_task_fk" FOREIGN KEY ("org_id","task_id") REFERENCES "public"."tasks"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_closing_year_id_accounting_closing_years_id_fk" FOREIGN KEY ("closing_year_id") REFERENCES "public"."accounting_closing_years"("id") ON DELETE set null ON UPDATE no action;