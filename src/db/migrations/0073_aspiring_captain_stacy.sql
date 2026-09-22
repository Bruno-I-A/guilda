ALTER TABLE "fiscal_client_profiles" ADD COLUMN "delivery_applicability" "fiscal_applicability" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
-- O canal já preenchido prova que existe envio; sem canal, a necessidade
-- permanece desconhecida até a equipe revisar a ficha.
UPDATE "fiscal_client_profiles"
SET "delivery_applicability" = 'required'
WHERE "delivery_channel" IS NOT NULL AND btrim("delivery_channel") <> '';
