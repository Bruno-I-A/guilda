CREATE TYPE "public"."tax_regime" AS ENUM('simples', 'presumido', 'real');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"tax_regime" "tax_regime" NOT NULL,
	"cnpj" varchar(14),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_org_active_idx" ON "clients" USING btree ("org_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_cnpj_uidx" ON "clients" USING btree ("org_id","cnpj") WHERE cnpj IS NOT NULL;