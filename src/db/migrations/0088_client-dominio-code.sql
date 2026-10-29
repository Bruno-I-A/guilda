ALTER TABLE "clients" ADD COLUMN "dominio_code" varchar(10);--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_dominio_code_uidx" ON "clients" USING btree ("org_id","dominio_code") WHERE dominio_code IS NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_dominio_code_check" CHECK ("clients"."dominio_code" IS NULL OR "clients"."dominio_code" ~ '^[0-9]{1,10}$');