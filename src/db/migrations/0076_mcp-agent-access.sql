CREATE TABLE "mcp_agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_last_four" varchar(4) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_agent_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "mcp_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"agent_key_id" uuid NOT NULL,
	"acting_user_id" text NOT NULL,
	"tool" varchar(80) NOT NULL,
	"resource_type" varchar(40),
	"resource_id" text,
	"success" boolean NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"agent_key_id" uuid NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"tool" varchar(80) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_agent_keys" ADD CONSTRAINT "mcp_agent_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_agent_keys" ADD CONSTRAINT "mcp_agent_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_agent_keys" ADD CONSTRAINT "mcp_agent_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ADD CONSTRAINT "mcp_audit_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ADD CONSTRAINT "mcp_audit_events_agent_key_id_mcp_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."mcp_agent_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ADD CONSTRAINT "mcp_audit_events_acting_user_id_user_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_command_receipts" ADD CONSTRAINT "mcp_command_receipts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_command_receipts" ADD CONSTRAINT "mcp_command_receipts_agent_key_id_mcp_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."mcp_agent_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_agent_keys_org_user_idx" ON "mcp_agent_keys" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "mcp_agent_keys_active_idx" ON "mcp_agent_keys" USING btree ("organization_id","revoked_at");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_org_created_idx" ON "mcp_audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_audit_events_org_agent_idx" ON "mcp_audit_events" USING btree ("org_id","agent_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_command_receipts_agent_idempotency_uidx" ON "mcp_command_receipts" USING btree ("agent_key_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "mcp_command_receipts_org_created_idx" ON "mcp_command_receipts" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "mcp_agent_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_agent_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "mcp_agent_keys"
  FOR ALL
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "mcp_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "mcp_audit_events"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "mcp_command_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_command_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "mcp_command_receipts"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT ON "mcp_agent_keys" TO guilda_app;--> statement-breakpoint
GRANT UPDATE ("last_used_at", "revoked_at") ON "mcp_agent_keys" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "mcp_audit_events" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "mcp_command_receipts" TO guilda_app;
