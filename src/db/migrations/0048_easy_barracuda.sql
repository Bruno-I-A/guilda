CREATE TABLE "clan_informative_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clan_id" uuid NOT NULL,
	"user_id" text,
	"sector" varchar(120) NOT NULL,
	"normalized_sector" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clan_memberships" ADD COLUMN "function_title" varchar(100);--> statement-breakpoint
ALTER TABLE "clans" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "clan_informative_routes" ADD CONSTRAINT "clan_informative_routes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_informative_routes" ADD CONSTRAINT "clan_informative_routes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_informative_routes" ADD CONSTRAINT "clan_informative_routes_org_clan_fk" FOREIGN KEY ("org_id","clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_informative_routes" ADD CONSTRAINT "clan_informative_routes_membership_fk" FOREIGN KEY ("org_id","clan_id","user_id") REFERENCES "public"."clan_memberships"("org_id","clan_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clan_informative_routes_org_sector_uidx" ON "clan_informative_routes" USING btree ("org_id","normalized_sector");--> statement-breakpoint
CREATE INDEX "clan_informative_routes_org_clan_idx" ON "clan_informative_routes" USING btree ("org_id","clan_id");--> statement-breakpoint
CREATE INDEX "clan_informative_routes_org_user_idx" ON "clan_informative_routes" USING btree ("org_id","user_id");--> statement-breakpoint

-- Preserva o comportamento atual transformando o antigo mapa do código em
-- configuração editável. Organizações novas recebem o mesmo conjunto no
-- bootstrap; depois disso cada admin pode alterar tudo pela interface.
INSERT INTO "clan_informative_routes" ("org_id", "clan_id", "sector", "normalized_sector")
SELECT c."org_id", c."id", defaults."sector", defaults."sector"
FROM "clans" c
JOIN (VALUES
  ('fiscal', 'fiscal'), ('fiscal', 'fiscais'),
  ('fiscal', 'emissao de notas'), ('fiscal', 'emissao de nota'),
  ('fiscal', 'emissao de nfe'), ('fiscal', 'nota fiscal'),
  ('fiscal', 'notas fiscais'), ('fiscal', 'notas'),
  ('fiscal', 'informativo'), ('fiscal', 'informativos'),
  ('fiscal', 'impostos'), ('fiscal', 'tributario'),
  ('fiscal', 'obrigacoes acessorias'),
  ('contabilidade', 'contabil'), ('contabilidade', 'contabeis'),
  ('contabilidade', 'contabilidade'), ('contabilidade', 'contabilizacao'),
  ('contabilidade', 'escrituracao'), ('contabilidade', 'balanco'),
  ('contabilidade', 'balancete'),
  ('rh', 'rh'), ('rh', 'recursos humanos'), ('rh', 'pro labore'),
  ('rh', 'prolabore'), ('rh', 'folha'), ('rh', 'folha de pagamento'),
  ('rh', 'departamento pessoal'), ('rh', 'dp'), ('rh', 'trabalhista'),
  ('rh', 'admissao'), ('rh', 'rescisao'), ('rh', 'ferias'),
  ('societario', 'societario'), ('societario', 'legalizacao'),
  ('societario', 'abertura'), ('societario', 'alteracao'),
  ('societario', 'baixa'), ('societario', 'contrato social'),
  ('societario', 'junta'),
  ('financeiro', 'financeiro'), ('financeiro', 'cobranca'),
  ('financeiro', 'cobrancas'), ('financeiro', 'honorario'),
  ('financeiro', 'honorarios'), ('financeiro', 'contas a receber'),
  ('financeiro', 'contas a pagar')
) AS defaults("slug", "sector") ON defaults."slug" = c."slug"
ON CONFLICT ("org_id", "normalized_sector") DO NOTHING;--> statement-breakpoint

ALTER TABLE "clan_informative_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clan_informative_routes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "clan_informative_routes"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "clan_informative_routes" TO guilda_app;
