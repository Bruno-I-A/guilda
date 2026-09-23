CREATE TABLE "guild_notice_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"notice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_notice_work" ADD CONSTRAINT "guild_notice_work_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notice_work" ADD CONSTRAINT "guild_notice_work_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notice_work" ADD CONSTRAINT "guild_notice_work_org_notice_fk" FOREIGN KEY ("org_id","notice_id") REFERENCES "public"."guild_notices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_notice_work_org_notice_user_uidx" ON "guild_notice_work" USING btree ("org_id","notice_id","user_id");--> statement-breakpoint
CREATE INDEX "guild_notice_work_org_user_idx" ON "guild_notice_work" USING btree ("org_id","user_id");--> statement-breakpoint
ALTER TABLE "guild_notice_work" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guild_notice_work" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "guild_notice_work"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "guild_notice_work" TO guilda_app;
