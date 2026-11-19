CREATE TYPE "public"."nfse_credential_mode" AS ENUM('certificate', 'proxy');--> statement-breakpoint
CREATE TYPE "public"."nfse_proxy_status" AS ENUM('untested', 'confirmed', 'invalid', 'no_emission', 'technical_failure');--> statement-breakpoint
CREATE TABLE "nfse_client_credentials" (
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"mode" "nfse_credential_mode",
	"read_mode" "nfse_credential_mode",
	"proxy_status" "nfse_proxy_status" DEFAULT 'untested' NOT NULL,
	"proxy_checked_at" timestamp with time zone,
	"proxy_code" varchar(30),
	"proxy_message" varchar(300),
	"proxy_test_requested_at" timestamp with time zone,
	"proxy_same_sequence" boolean,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_client_credentials_org_id_client_id_pk" PRIMARY KEY("org_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "nfse_credential_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"default_mode" "nfse_credential_mode" DEFAULT 'certificate' NOT NULL,
	"proxy_test_requested_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nfse_client_credentials" ADD CONSTRAINT "nfse_client_credentials_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_client_credentials" ADD CONSTRAINT "nfse_client_credentials_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_client_credentials" ADD CONSTRAINT "nfse_client_credentials_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_credential_settings" ADD CONSTRAINT "nfse_credential_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_credential_settings" ADD CONSTRAINT "nfse_credential_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Procuracao (2026-11-18): padrao do escritorio e credencial de cada empresa.
-- Isolamento por organizacao como as demais tabelas de dominio.
ALTER TABLE "nfse_credential_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_credential_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_credential_settings"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_client_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_client_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_client_credentials"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges
-- (docker/*/init/01-roles): GRANT sozinho nao restringe nada.
-- Configuracao e credencial se ajustam, nao se apagam; a cascata da empresa
-- roda como dono.
GRANT SELECT, INSERT, UPDATE ON "nfse_credential_settings" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_credential_settings" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "nfse_client_credentials" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_client_credentials" FROM guilda_app;
