ALTER TABLE "accounting_closings" ADD COLUMN "cash_balance" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "period_result" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "accounting_closings" ADD COLUMN "shareholder_loan" numeric(15, 2);