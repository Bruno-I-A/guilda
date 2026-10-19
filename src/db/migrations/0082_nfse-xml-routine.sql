CREATE TYPE "public"."nfse_certificate_status" AS ENUM('pending', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."nfse_xml_routine_frequency" AS ENUM('daily', 'monthly');--> statement-breakpoint
CREATE TABLE "nfse_client_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"envelope" jsonb NOT NULL,
	"status" "nfse_certificate_status" DEFAULT 'pending' NOT NULL,
	"status_message" text,
	"certificate_cnpj" varchar(14),
	"valid_until" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_client_certificates_valid_check" CHECK ("nfse_client_certificates"."status" <> 'valid' OR ("nfse_client_certificates"."valid_until" IS NOT NULL AND "nfse_client_certificates"."certificate_cnpj" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "nfse_dfe_cursors" (
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"last_nsu" bigint DEFAULT 0 NOT NULL,
	"initial_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_dfe_cursors_org_id_client_id_pk" PRIMARY KEY("org_id","client_id"),
	CONSTRAINT "nfse_dfe_cursors_nsu_check" CHECK ("nfse_dfe_cursors"."last_nsu" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nfse_issued_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"access_key" varchar(50) NOT NULL,
	"nsu" bigint NOT NULL,
	"nfse_number" varchar(20),
	"issued_at" timestamp with time zone NOT NULL,
	"competence" date,
	"xml_gz" "bytea" NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_nsu" bigint,
	"cancel_xml_gz" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_issued_notes_key_check" CHECK ("nfse_issued_notes"."access_key" ~ '^[0-9]{50}$')
);
--> statement-breakpoint
CREATE TABLE "nfse_xml_routines" (
	"org_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"frequency" "nfse_xml_routine_frequency" DEFAULT 'daily' NOT NULL,
	"day_of_month" smallint,
	"run_time" varchar(5) DEFAULT '06:00' NOT NULL,
	"keep_since" date,
	"run_requested_at" timestamp with time zone,
	"last_run_started_at" timestamp with time zone,
	"last_run_finished_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_xml_routines_day_check" CHECK (("nfse_xml_routines"."frequency" = 'daily' AND "nfse_xml_routines"."day_of_month" IS NULL) OR ("nfse_xml_routines"."frequency" = 'monthly' AND "nfse_xml_routines"."day_of_month" BETWEEN 1 AND 28)),
	CONSTRAINT "nfse_xml_routines_time_check" CHECK ("nfse_xml_routines"."run_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "nfse_settings" ADD COLUMN "vault_key_id" varchar(16);--> statement-breakpoint
ALTER TABLE "nfse_settings" ADD COLUMN "vault_public_key" text;--> statement-breakpoint
ALTER TABLE "nfse_client_certificates" ADD CONSTRAINT "nfse_client_certificates_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_client_certificates" ADD CONSTRAINT "nfse_client_certificates_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_client_certificates" ADD CONSTRAINT "nfse_client_certificates_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_dfe_cursors" ADD CONSTRAINT "nfse_dfe_cursors_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_dfe_cursors" ADD CONSTRAINT "nfse_dfe_cursors_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_issued_notes" ADD CONSTRAINT "nfse_issued_notes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_issued_notes" ADD CONSTRAINT "nfse_issued_notes_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_xml_routines" ADD CONSTRAINT "nfse_xml_routines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_xml_routines" ADD CONSTRAINT "nfse_xml_routines_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_client_certificates_org_client_uidx" ON "nfse_client_certificates" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_issued_notes_org_key_uidx" ON "nfse_issued_notes" USING btree ("org_id","access_key");--> statement-breakpoint
CREATE INDEX "nfse_issued_notes_org_client_issued_idx" ON "nfse_issued_notes" USING btree ("org_id","client_id","issued_at");
--> statement-breakpoint
-- XML das NFS-e prestadas (decisao de 2026-10-19): isolamento por organizacao.
ALTER TABLE "nfse_client_certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_client_certificates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_client_certificates"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_xml_routines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_xml_routines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_xml_routines"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_dfe_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_dfe_cursors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_dfe_cursors"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "nfse_issued_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nfse_issued_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "nfse_issued_notes"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- O guilda_app ganha tudo em tabela nova pelos default privileges
-- (docker/*/init/01-roles): GRANT sozinho nao restringe nada.
-- Certificado se troca e se remove. Configuracao e cursor nao se apagam.
-- Nota guardada nao se apaga e so recebe o cancelamento. Cascata das FKs roda
-- como dono.
GRANT SELECT, INSERT, UPDATE, DELETE ON "nfse_client_certificates" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "nfse_xml_routines" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_xml_routines" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "nfse_dfe_cursors" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "nfse_dfe_cursors" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "nfse_issued_notes" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "nfse_issued_notes" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("cancelled_at", "cancel_nsu", "cancel_xml_gz") ON "nfse_issued_notes" TO guilda_app;
