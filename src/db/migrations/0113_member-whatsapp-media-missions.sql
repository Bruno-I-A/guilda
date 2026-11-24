-- Todo integrante cria missao pelo WhatsApp, por texto, audio, foto ou PDF (2026-11-24).
-- Escrita a mao, como a 0103 a 0112. A 0112 ja foi aplicada na homologacao: tudo aqui so acrescenta.

-- 1. Mensagem com arquivo: o id da midia na Meta, o tipo e a legenda.
ALTER TABLE "member_whatsapp_commands" DROP CONSTRAINT "member_whatsapp_commands_kind_check";--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD CONSTRAINT "member_whatsapp_commands_kind_check" CHECK ("kind" IN ('text', 'button', 'media', 'other'));--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD COLUMN "media_id" varchar(64);--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD COLUMN "media_mime" varchar(120);--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD COLUMN "media_caption" text;--> statement-breakpoint
ALTER TABLE "member_whatsapp_commands" ADD COLUMN "media_filename" varchar(255);--> statement-breakpoint

-- 2. Previa da missao avulsa pedida por mensagem (quem nao lidera cla). Lider, admin e
-- dono seguem pelo Informativo. Nada nasce antes do botao; so o mesmo numero confirma.
CREATE TABLE "member_mission_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_text" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_task_ids" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_mission_drafts_status_check" CHECK ("status" IN ('pending', 'confirmed', 'cancelled'))
);--> statement-breakpoint
ALTER TABLE "member_mission_drafts" ADD CONSTRAINT "member_mission_drafts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_mission_drafts" ADD CONSTRAINT "member_mission_drafts_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_mission_drafts" ADD CONSTRAINT "member_mission_drafts_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."member_whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_mission_drafts_org_user_status_idx" ON "member_mission_drafts" USING btree ("org_id","requested_by","status");--> statement-breakpoint
ALTER TABLE "member_mission_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_mission_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "member_mission_drafts"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- A previa nao se apaga: so a decisao muda.
GRANT SELECT, INSERT, UPDATE ON "member_mission_drafts" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "member_mission_drafts" FROM guilda_app;
