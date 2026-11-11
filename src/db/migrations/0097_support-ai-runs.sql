CREATE TABLE "support_ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trigger_message_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"model" varchar(80) NOT NULL,
	"prompt_version" varchar(40) NOT NULL,
	"result" jsonb,
	"fallback_reason" varchar(40),
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "support_ai_runs_status_check" CHECK ("support_ai_runs"."status" IN ('running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "support_ai_runs" ADD CONSTRAINT "support_ai_runs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ai_runs" ADD CONSTRAINT "support_ai_runs_org_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."support_conversations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ai_runs" ADD CONSTRAINT "support_ai_runs_org_message_fk" FOREIGN KEY ("org_id","trigger_message_id") REFERENCES "public"."support_messages"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_ai_runs_org_trigger_uidx" ON "support_ai_runs" USING btree ("org_id","trigger_message_id");--> statement-breakpoint
CREATE INDEX "support_ai_runs_org_conversation_time_idx" ON "support_ai_runs" USING btree ("org_id","conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "support_ai_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_ai_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_ai_runs" FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- A leitura nao se apaga e so muda o desfecho: o default privilege do guilda_app daria tudo.
GRANT SELECT, INSERT ON "support_ai_runs" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_ai_runs" FROM guilda_app;--> statement-breakpoint
GRANT UPDATE ("status", "result", "fallback_reason", "model", "input_tokens", "output_tokens", "latency_ms", "finished_at") ON "support_ai_runs" TO guilda_app;
