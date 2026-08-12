CREATE TYPE "public"."telegram_ai_draft_status" AS ENUM('pending', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "telegram_ai_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_text" text NOT NULL,
	"model" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "telegram_ai_draft_status" DEFAULT 'pending' NOT NULL,
	"created_task_ids" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "telegram_ai_drafts" ADD CONSTRAINT "telegram_ai_drafts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_ai_drafts" ADD CONSTRAINT "telegram_ai_drafts_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_ai_drafts" ADD CONSTRAINT "telegram_ai_drafts_connection_id_telegram_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."telegram_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_ai_drafts_org_user_status_idx" ON "telegram_ai_drafts" USING btree ("org_id","requested_by","status");--> statement-breakpoint
CREATE INDEX "telegram_ai_drafts_expires_idx" ON "telegram_ai_drafts" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_client_idx" ON "tasks" USING btree ("org_id","client_id");--> statement-breakpoint

-- Os informativos contêm dados operacionais de clientes e devem permanecer
-- isolados pela organização, inclusive enquanto ainda são apenas rascunhos.
ALTER TABLE "telegram_ai_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "telegram_ai_drafts"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_ai_drafts" TO guilda_app;
