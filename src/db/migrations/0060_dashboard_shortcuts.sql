CREATE TABLE "dashboard_shortcuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"target" varchar(180) NOT NULL,
	"label" varchar(80) NOT NULL,
	"sort_order" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_shortcuts_label_check" CHECK (length(btrim("label")) > 0),
	CONSTRAINT "dashboard_shortcuts_sort_order_check" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dashboard_shortcuts" ADD CONSTRAINT "dashboard_shortcuts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dashboard_shortcuts" ADD CONSTRAINT "dashboard_shortcuts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_shortcuts_org_user_target_uidx" ON "dashboard_shortcuts" USING btree ("org_id","user_id","target");
--> statement-breakpoint
CREATE INDEX "dashboard_shortcuts_org_user_order_idx" ON "dashboard_shortcuts" USING btree ("org_id","user_id","sort_order");
--> statement-breakpoint
ALTER TABLE "dashboard_shortcuts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dashboard_shortcuts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "org_isolation" ON "dashboard_shortcuts"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "dashboard_shortcuts" TO guilda_app;
