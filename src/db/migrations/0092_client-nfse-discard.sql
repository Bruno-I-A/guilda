ALTER TABLE "client_nfse_invoices" DROP CONSTRAINT "client_nfse_invoices_access_key_check";--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD COLUMN "discarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_nfse_invoices" ADD CONSTRAINT "client_nfse_invoices_access_key_check" CHECK ("client_nfse_invoices"."status" NOT IN ('issued', 'cancel_requested', 'cancelled') OR "client_nfse_invoices"."access_key" IS NOT NULL OR ("client_nfse_invoices"."status" = 'cancelled' AND "client_nfse_invoices"."discarded_at" IS NOT NULL));--> statement-breakpoint
-- A descartada grava a marca; a coluna precisa da permissão, como as outras do desfecho.
GRANT UPDATE ("discarded_at") ON "client_nfse_invoices" TO guilda_app;
