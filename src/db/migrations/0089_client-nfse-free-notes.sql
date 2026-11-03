ALTER TABLE "client_nfse_items" ALTER COLUMN "model_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_dfe_cursors" ADD COLUMN "history_nsu" bigint;--> statement-breakpoint
ALTER TABLE "client_nfse_issuers" ADD COLUMN "uses_standard_notes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_nfse_items" ADD COLUMN "request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "client_nfse_items_org_request_uidx" ON "client_nfse_items" USING btree ("org_id","request_id") WHERE request_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "client_nfse_items" ADD CONSTRAINT "client_nfse_items_origin_check" CHECK ("client_nfse_items"."model_id" IS NOT NULL OR "client_nfse_items"."request_id" IS NOT NULL);--> statement-breakpoint
-- Quem já tem nota padrão continua com as notas fixas na tela; empresa nova
-- nasce na emissão avulsa e o Fiscal liga as fixas nos dados fiscais.
UPDATE "client_nfse_issuers" SET "uses_standard_notes" = true
 WHERE EXISTS (SELECT 1 FROM "client_nfse_models" m WHERE m."org_id" = "client_nfse_issuers"."org_id" AND m."issuer_id" = "client_nfse_issuers"."id");
