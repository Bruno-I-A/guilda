-- As chaves administrativas ativas já criadas com todos os poderes da
-- primeira versão recebem os novos domínios sem exigir rotação. Chaves de
-- membros e chaves administrativas deliberadamente restritas não mudam.
UPDATE "mcp_agent_keys" AS key
SET "scopes" = key."scopes" || '[
  "closings:read",
  "closings:write",
  "informatives:read",
  "informatives:write",
  "mural:read",
  "mural:write"
]'::jsonb
FROM "member" AS represented
WHERE represented."organization_id" = key."organization_id"
  AND represented."user_id" = key."user_id"
  AND represented."role" IN ('owner', 'admin')
  AND key."revoked_at" IS NULL
  AND key."scopes" @> '[
    "missions:read",
    "directory:read",
    "missions:create",
    "missions:write",
    "missions:assign",
    "missions:review",
    "missions:cancel"
  ]'::jsonb;
