-- Encaminhamento por assunto dentro do cla (2026-11-20): o que cada pessoa
-- atende e, com user_id nulo, os assuntos que seguem a Carteira do cla.
-- Escrita a mao, como a 0103 a 0106.
CREATE TABLE "support_routing_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clan_id" uuid NOT NULL,
	"user_id" text,
	"topics" varchar(500) NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_routing_topics_topics_check" CHECK (length(btrim("topics")) > 0)
);
--> statement-breakpoint
ALTER TABLE "support_routing_topics" ADD CONSTRAINT "support_routing_topics_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_routing_topics" ADD CONSTRAINT "support_routing_topics_org_clan_fk" FOREIGN KEY ("org_id","clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Quem sai do cla leva a regra junto: regra sem vinculo mandaria conversa a quem nao atende mais.
ALTER TABLE "support_routing_topics" ADD CONSTRAINT "support_routing_topics_membership_fk" FOREIGN KEY ("org_id","clan_id","user_id") REFERENCES "public"."clan_memberships"("org_id","clan_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_routing_topics" ADD CONSTRAINT "support_routing_topics_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_routing_topics_person_uidx" ON "support_routing_topics" USING btree ("org_id","clan_id","user_id") WHERE "support_routing_topics"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "support_routing_topics_portfolio_uidx" ON "support_routing_topics" USING btree ("org_id","clan_id") WHERE "support_routing_topics"."user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "support_routing_topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_routing_topics" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_routing_topics"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- Regra e configuracao: texto vazio apaga, entao o guilda_app pode apagar.
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_routing_topics" TO guilda_app;
