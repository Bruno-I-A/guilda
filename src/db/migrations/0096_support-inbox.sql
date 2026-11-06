CREATE TABLE "support_conversation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_conversation_notes_text_check" CHECK (length(btrim("support_conversation_notes"."text")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "support_conversations" ALTER COLUMN "status" SET DEFAULT 'needs_human';--> statement-breakpoint
ALTER TABLE "support_conversation_notes" ADD CONSTRAINT "support_conversation_notes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversation_notes" ADD CONSTRAINT "support_conversation_notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversation_notes" ADD CONSTRAINT "support_conversation_notes_org_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "public"."support_conversations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_conversation_notes_org_conversation_time_idx" ON "support_conversation_notes" USING btree ("org_id","conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "support_conversation_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_conversation_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation_select" ON "support_conversation_notes"
  FOR SELECT USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation_insert" ON "support_conversation_notes"
  FOR INSERT WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- Nota nao se edita nem se apaga: o default privilege do guilda_app daria tudo.
GRANT SELECT, INSERT ON "support_conversation_notes" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_conversation_notes" FROM guilda_app;--> statement-breakpoint
-- Ainda nao ha IA: quem ficou em "IA atendendo" nao seria visto por ninguem.
UPDATE "support_conversations" SET "status" = 'needs_human' WHERE "status" = 'ai_active';
