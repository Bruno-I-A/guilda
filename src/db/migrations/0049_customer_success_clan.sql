-- O migrador pode ser o próprio owner não-superuser. Como este backfill é
-- global, suspendemos FORCE RLS somente dentro da transação da migration e
-- restauramos a proteção ao final (mesmo padrão da migration 0041).
ALTER TABLE "clans" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clan_memberships" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clan_informative_routes" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- O sexto clã nasce para todas as organizações existentes. O owner recebe a
-- liderança inicial e pode reorganizar integrantes/funções pela Configuração.
INSERT INTO "clans" ("org_id", "name", "slug", "description", "active")
SELECT
  organization."id",
  'Sucesso do Cliente',
  'sucesso-do-cliente',
  'Emissão de notas, arquivo, certificado digital e automações do cliente.',
  true
FROM "organization"
ON CONFLICT ("org_id", "slug") DO UPDATE SET
  "name" = excluded."name",
  "description" = COALESCE("clans"."description", excluded."description"),
  "active" = true,
  "updated_at" = now();
--> statement-breakpoint

INSERT INTO "clan_memberships" (
  "org_id",
  "clan_id",
  "user_id",
  "is_leader",
  "is_primary",
  "function_title"
)
SELECT
  clan."org_id",
  clan."id",
  member."user_id",
  true,
  false,
  'Liderança'
FROM "clans" clan
INNER JOIN "member" member ON member."organization_id" = clan."org_id"
WHERE clan."slug" = 'sucesso-do-cliente'
  AND 'owner' = ANY(regexp_split_to_array(member."role", '\s*,\s*'))
ON CONFLICT ("org_id", "clan_id", "user_id") DO UPDATE SET
  "is_leader" = true,
  "function_title" = COALESCE("clan_memberships"."function_title", excluded."function_title"),
  "updated_at" = now();
--> statement-breakpoint

-- Além dos quatro nomes principais, cobre a nomenclatura dos Informativos
-- históricos. Em caso de regra anterior, a solicitação atual transfere o
-- destino para a fila de Sucesso do Cliente e remove a atribuição individual.
INSERT INTO "clan_informative_routes" (
  "org_id",
  "clan_id",
  "user_id",
  "sector",
  "normalized_sector"
)
SELECT
  clan."org_id",
  clan."id",
  NULL,
  route."sector",
  route."normalized_sector"
FROM "clans" clan
CROSS JOIN (VALUES
  ('Sucesso do Cliente', 'sucesso do cliente'),
  ('FISCAL / EMISSÃO DE NOTAS / INFORMATIVOS', 'fiscal emissao de notas informativos'),
  ('FISCAL / EMISSÃO DE NOTAS', 'fiscal emissao de notas'),
  ('FISCAL / EMISSÃO DE NOTA', 'fiscal emissao de nota'),
  ('FISCAL / EMISSÃO DE NFE', 'fiscal emissao de nfe'),
  ('Emissão de notas', 'emissao de notas'),
  ('Emissão de nota', 'emissao de nota'),
  ('Emissão de NFe', 'emissao de nfe'),
  ('Nota fiscal', 'nota fiscal'),
  ('Notas fiscais', 'notas fiscais'),
  ('Notas', 'notas'),
  ('Arquivo', 'arquivo'),
  ('Arquivos', 'arquivos'),
  ('Certificado digital', 'certificado digital'),
  ('Certificados digitais', 'certificados digitais'),
  ('Automação', 'automacao'),
  ('Automações', 'automacoes')
) AS route("sector", "normalized_sector")
WHERE clan."slug" = 'sucesso-do-cliente'
ON CONFLICT ("org_id", "normalized_sector") DO UPDATE SET
  "clan_id" = excluded."clan_id",
  "user_id" = NULL,
  "sector" = excluded."sector",
  "updated_at" = now();
--> statement-breakpoint

ALTER TABLE "clans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clan_memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clan_informative_routes" FORCE ROW LEVEL SECURITY;
