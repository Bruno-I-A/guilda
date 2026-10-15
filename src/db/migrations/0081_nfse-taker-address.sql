ALTER TABLE "nfse_invoices" ADD COLUMN "taker_address" jsonb;--> statement-breakpoint
-- "Tentar de novo" relê o endereço do cadastro: o guilda_app precisa
-- atualizar esta coluna (o UPDATE em nfse_invoices é só por coluna, 0080).
GRANT UPDATE ("taker_address") ON "nfse_invoices" TO guilda_app;
