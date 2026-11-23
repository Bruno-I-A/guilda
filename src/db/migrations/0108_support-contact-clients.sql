-- Numeros e empresas (2026-11-23): um numero pode ser de varias empresas e a
-- conversa guarda a sua. Escrita a mao, como a 0103 a 0107.
CREATE TABLE "support_contact_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"linked_by" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_contact_clients" ADD CONSTRAINT "support_contact_clients_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_contact_clients" ADD CONSTRAINT "support_contact_clients_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_contact_clients" ADD CONSTRAINT "support_contact_clients_org_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."support_contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_contact_clients" ADD CONSTRAINT "support_contact_clients_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_contact_clients_contact_client_uidx" ON "support_contact_clients" USING btree ("org_id","contact_id","client_id");--> statement-breakpoint
CREATE INDEX "support_contact_clients_org_client_idx" ON "support_contact_clients" USING btree ("org_id","client_id");--> statement-breakpoint
ALTER TABLE "support_conversations" ADD COLUMN "client_id" uuid;--> statement-breakpoint
-- Excluir a empresa tira a empresa da conversa sem zerar o org_id da FK composta.
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE SET NULL ("client_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_conversations_org_client_idx" ON "support_conversations" USING btree ("org_id","client_id");--> statement-breakpoint
-- Os vinculos feitos na caixa de entrada viram a primeira empresa de cada numero e de cada conversa.
INSERT INTO "support_contact_clients" ("org_id", "contact_id", "client_id", "linked_by", "linked_at")
  SELECT "org_id", "id", "client_id", "linked_by", "linked_at" FROM "support_contacts" WHERE "client_id" IS NOT NULL;--> statement-breakpoint
UPDATE "support_conversations" AS c SET "client_id" = sc."client_id"
  FROM "support_contacts" AS sc
  WHERE sc."org_id" = c."org_id" AND sc."id" = c."contact_id" AND sc."client_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "support_contact_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_contact_clients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "support_contact_clients"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
-- Vinculo se cria e se desfaz; nao se edita.
GRANT SELECT, INSERT, DELETE ON "support_contact_clients" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE ON "support_contact_clients" FROM guilda_app;
