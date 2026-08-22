-- A presença de FISCAL no rótulo prevalece: Emissão de Notas só pertence a
-- Sucesso do Cliente quando aparece como setor autônomo no Informativo.
ALTER TABLE "clan_informative_routes" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

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
  ('FISCAL / EMISSÃO DE NOTAS / INFORMATIVOS', 'fiscal emissao de notas informativos'),
  ('FISCAL / EMISSÃO DE NOTAS', 'fiscal emissao de notas'),
  ('FISCAL / EMISSÃO DE NOTA', 'fiscal emissao de nota'),
  ('FISCAL / EMISSÃO DE NFE', 'fiscal emissao de nfe')
) AS route("sector", "normalized_sector")
WHERE clan."slug" = 'fiscal'
ON CONFLICT ("org_id", "normalized_sector") DO UPDATE SET
  "clan_id" = excluded."clan_id",
  "user_id" = NULL,
  "sector" = excluded."sector",
  "updated_at" = now();
--> statement-breakpoint

ALTER TABLE "clan_informative_routes" FORCE ROW LEVEL SECURITY;
