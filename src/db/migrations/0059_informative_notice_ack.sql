UPDATE "guild_notices"
SET
  "requires_ack" = true,
  "updated_at" = now()
WHERE
  "informative_id" IS NOT NULL
  AND "requires_ack" = false;
