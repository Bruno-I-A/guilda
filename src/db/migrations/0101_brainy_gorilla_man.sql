CREATE TABLE "support_knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"title" varchar(180) NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sector" varchar(32) NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"created_by_user_id" text,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_knowledge_entries_status_check" CHECK ("support_knowledge_entries"."status" IN ('draft', 'approved', 'archived')),
	CONSTRAINT "support_knowledge_entries_version_check" CHECK ("support_knowledge_entries"."version" >= 1),
	CONSTRAINT "support_knowledge_entries_validity_check" CHECK ("support_knowledge_entries"."valid_until" IS NULL OR "support_knowledge_entries"."valid_from" IS NULL OR "support_knowledge_entries"."valid_until" > "support_knowledge_entries"."valid_from"),
	CONSTRAINT "support_knowledge_entries_approval_check" CHECK (("support_knowledge_entries"."status" = 'approved' AND "support_knowledge_entries"."approved_at" IS NOT NULL AND "support_knowledge_entries"."approved_by_user_id" IS NOT NULL) OR ("support_knowledge_entries"."status" <> 'approved'))
);
--> statement-breakpoint
ALTER TABLE "support_knowledge_entries" ADD CONSTRAINT "support_knowledge_entries_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_knowledge_entries" ADD CONSTRAINT "support_knowledge_entries_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_knowledge_entries" ADD CONSTRAINT "support_knowledge_entries_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_knowledge_entries_org_id_uidx" ON "support_knowledge_entries" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "support_knowledge_entries_org_status_idx" ON "support_knowledge_entries" USING btree ("org_id","status","valid_from","valid_until");--> statement-breakpoint
ALTER TABLE "support_knowledge_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_knowledge_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_knowledge_entries" FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
REVOKE ALL ON "support_knowledge_entries" FROM guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "support_knowledge_entries" TO guilda_app;--> statement-breakpoint
GRANT UPDATE (
  "title", "question", "answer", "sector", "keywords", "status", "version",
  "valid_from", "valid_until", "approved_by_user_id", "approved_at", "updated_at"
) ON "support_knowledge_entries" TO guilda_app;
