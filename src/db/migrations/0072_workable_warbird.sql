CREATE TYPE "public"."closing_observation_scope" AS ENUM('year', 'defis', 'closing');--> statement-breakpoint
CREATE TABLE "closing_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"scope" "closing_observation_scope" DEFAULT 'year' NOT NULL,
	"closing_id" uuid,
	"body" text NOT NULL,
	"author_id" text,
	"task_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "closing_observations" ADD CONSTRAINT "closing_observations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_observations" ADD CONSTRAINT "closing_observations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_observations" ADD CONSTRAINT "closing_observations_closing_id_accounting_closings_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."accounting_closings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_observations" ADD CONSTRAINT "closing_observations_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_observations" ADD CONSTRAINT "closing_observations_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closing_observations_org_client_year_idx" ON "closing_observations" USING btree ("org_id","client_id","year");--> statement-breakpoint
CREATE INDEX "closing_observations_org_closing_idx" ON "closing_observations" USING btree ("org_id","closing_id");--> statement-breakpoint

-- A aplicacao conecta como guilda_app (nao-superuser); sem o GRANT a tabela
-- nasce inacessivel para ela.
GRANT SELECT, INSERT, UPDATE, DELETE ON "closing_observations" TO guilda_app;--> statement-breakpoint

-- Isolamento por organizacao no banco, alem do filtro da aplicacao.
ALTER TABLE "closing_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closing_observations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "closing_observations"
  USING ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- O texto livre que ja existe vira a primeira observacao de cada lugar. Sem
-- autor: as colunas antigas nunca registraram quem escreveu. As colunas
-- continuam no schema (nada e apagado aqui), mas a aplicacao para de le-las.
INSERT INTO "closing_observations" ("org_id", "client_id", "year", "scope", "body", "created_at", "updated_at")
SELECT "org_id", "client_id", "year", 'year', btrim("notes"), "updated_at", "updated_at"
FROM "accounting_closing_years"
WHERE "notes" IS NOT NULL AND btrim("notes") <> '';--> statement-breakpoint

INSERT INTO "closing_observations" ("org_id", "client_id", "year", "scope", "body", "created_at", "updated_at")
SELECT "org_id", "client_id", "year", 'defis', btrim("defis_notes"), "updated_at", "updated_at"
FROM "accounting_closing_years"
WHERE "defis_notes" IS NOT NULL AND btrim("defis_notes") <> '';--> statement-breakpoint

-- O periodo pertence ao ano do seu vencimento: e assim que a aba os agrupa
-- (due_date entre 01-01 e 12-31 do ano escolhido).
INSERT INTO "closing_observations" ("org_id", "client_id", "year", "scope", "closing_id", "body", "created_at", "updated_at")
SELECT "org_id", "client_id", EXTRACT(YEAR FROM "due_date")::smallint, 'closing', "id", btrim("notes"), "updated_at", "updated_at"
FROM "accounting_closings"
WHERE "notes" IS NOT NULL AND btrim("notes") <> '';
