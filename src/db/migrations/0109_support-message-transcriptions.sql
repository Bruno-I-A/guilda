-- Audio no Atendimento (2026-11-23): transcricao de cada audio recebido.
-- Escrita a mao, como a 0103 a 0108.
CREATE TABLE "support_message_transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"text" text,
	"model" varchar(80),
	"error" varchar(1000),
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_message_transcriptions_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed', 'unavailable'))
);
--> statement-breakpoint
ALTER TABLE "support_message_transcriptions" ADD CONSTRAINT "support_message_transcriptions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_message_transcriptions" ADD CONSTRAINT "support_message_transcriptions_org_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "public"."support_messages"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_message_transcriptions_message_uidx" ON "support_message_transcriptions" USING btree ("org_id","message_id");--> statement-breakpoint
CREATE INDEX "support_message_transcriptions_status_idx" ON "support_message_transcriptions" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "support_message_transcriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_message_transcriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_message_transcriptions"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- A transcricao muda de estado, mas nao se apaga pelo app.
GRANT SELECT, INSERT, UPDATE ON "support_message_transcriptions" TO guilda_app;--> statement-breakpoint
REVOKE DELETE ON "support_message_transcriptions" FROM guilda_app;
