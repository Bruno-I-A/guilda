CREATE TABLE "clan_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clan_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"is_leader" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Os índices únicos compostos precisam existir antes dos FKs tenant-aware.
CREATE UNIQUE INDEX "clans_org_id_uidx" ON "clans" USING btree ("org_id","id");--> statement-breakpoint
CREATE TABLE "task_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"from_assignee_id" text,
	"to_assignee_id" text,
	"from_clan_id" uuid,
	"to_clan_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "assignee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "clan_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_org_id_uidx" ON "tasks" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_events_org_id_uidx" ON "task_events" USING btree ("org_id","id");--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD COLUMN "task_event_id" uuid;--> statement-breakpoint
ALTER TABLE "clan_memberships" ADD CONSTRAINT "clan_memberships_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_memberships" ADD CONSTRAINT "clan_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_memberships" ADD CONSTRAINT "clan_memberships_org_clan_fk" FOREIGN KEY ("org_id","clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clans" ADD CONSTRAINT "clans_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_from_assignee_id_user_id_fk" FOREIGN KEY ("from_assignee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_to_assignee_id_user_id_fk" FOREIGN KEY ("to_assignee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_org_task_fk" FOREIGN KEY ("org_id","task_id") REFERENCES "public"."tasks"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_org_from_clan_fk" FOREIGN KEY ("org_id","from_clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transfers" ADD CONSTRAINT "task_transfers_org_to_clan_fk" FOREIGN KEY ("org_id","to_clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clan_memberships_org_clan_user_uidx" ON "clan_memberships" USING btree ("org_id","clan_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clan_memberships_org_user_primary_uidx" ON "clan_memberships" USING btree ("org_id","user_id") WHERE is_primary = true;--> statement-breakpoint
CREATE INDEX "clan_memberships_org_user_idx" ON "clan_memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "clan_memberships_org_clan_leader_idx" ON "clan_memberships" USING btree ("org_id","clan_id","is_leader");--> statement-breakpoint
CREATE UNIQUE INDEX "clans_org_slug_uidx" ON "clans" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "clans_org_active_idx" ON "clans" USING btree ("org_id","active");--> statement-breakpoint
CREATE INDEX "task_transfers_org_task_created_idx" ON "task_transfers" USING btree ("org_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_transfers_org_to_clan_created_idx" ON "task_transfers" USING btree ("org_id","to_clan_id","created_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_clan_fk" FOREIGN KEY ("org_id","clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_org_task_event_fk" FOREIGN KEY ("org_id","task_event_id") REFERENCES "public"."task_events"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_clan_status_idx" ON "tasks" USING btree ("org_id","clan_id","status");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_or_clan_check" CHECK ("tasks"."assignee_id" IS NOT NULL OR "tasks"."clan_id" IS NOT NULL);--> statement-breakpoint

-- Bootstrap das cinco áreas operacionais em todas as organizações existentes.
INSERT INTO "clans" ("org_id", "name", "slug")
SELECT
  organization."id",
  defaults."name",
  defaults."slug"
FROM "organization"
CROSS JOIN (
  VALUES
    ('Fiscal', 'fiscal'),
    ('Contabilidade', 'contabilidade'),
    ('RH', 'rh'),
    ('Societário', 'societario'),
    ('Financeiro', 'financeiro')
) AS defaults("name", "slug")
ON CONFLICT ("org_id", "slug") DO NOTHING;--> statement-breakpoint

-- Owners começam como líderes dos cinco clãs. Contabilidade é o
-- único clã principal inicial; os demais membros serão classificados depois.
INSERT INTO "clan_memberships" (
  "org_id",
  "clan_id",
  "user_id",
  "is_leader",
  "is_primary"
)
SELECT DISTINCT
  m."organization_id",
  c."id",
  m."user_id",
  true,
  c."slug" = 'contabilidade'
FROM "member" AS m
INNER JOIN "clans" AS c
  ON c."org_id" = m."organization_id"
WHERE 'owner' = ANY(string_to_array(replace(m."role", ' ', ''), ','))
ON CONFLICT ("org_id", "clan_id", "user_id") DO NOTHING;--> statement-breakpoint

-- Missões antigas herdam o clã principal do responsável quando houver um.
-- Linhas sem vínculo permanecem válidas por terem assignee_id preenchido.
UPDATE "tasks"
SET "clan_id" = primary_membership."clan_id"
FROM "clan_memberships" AS primary_membership
WHERE "tasks"."org_id" = primary_membership."org_id"
  AND "tasks"."assignee_id" = primary_membership."user_id"
  AND primary_membership."is_primary" = true
  AND "tasks"."clan_id" IS NULL;--> statement-breakpoint

-- Associa os lançamentos antigos ao evento mais próximo do mesmo ciclo.
-- O backfill é best-effort: linhas sem evento compatível continuam nulas e
-- preservadas; novos lançamentos sempre recebem task_event_id pela aplicação.
WITH ranked_matches AS (
  SELECT
    ledger."id" AS ledger_id,
    event."id" AS event_id,
    row_number() OVER (
      PARTITION BY ledger."id"
      ORDER BY
        abs(extract(epoch FROM (event."created_at" - ledger."created_at"))),
        event."created_at",
        event."id"
    ) AS match_rank
  FROM "xp_ledger" AS ledger
  INNER JOIN "task_events" AS event
    ON event."org_id" = ledger."org_id"
   AND event."task_id" = ledger."task_id"
  WHERE
    (ledger."reason" = 'task_completed' AND event."to_status" = 'completed')
    OR
    (
      ledger."reason" = 'reversal'
      AND event."from_status" = 'completed'
      AND event."to_status" = 'in_progress'
    )
)
UPDATE "xp_ledger" AS ledger
SET "task_event_id" = ranked_matches.event_id
FROM ranked_matches
WHERE ledger."id" = ranked_matches.ledger_id
  AND ranked_matches.match_rank = 1;--> statement-breakpoint

DROP INDEX "xp_ledger_task_completed_uidx";--> statement-breakpoint
DROP INDEX "xp_ledger_task_reversal_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_task_event_uidx"
  ON "xp_ledger" USING btree ("task_event_id")
  WHERE task_event_id IS NOT NULL
    AND reason IN ('task_completed', 'reversal');--> statement-breakpoint

-- Marca a deleção integral da organização para que os DELETEs de member
-- disparados pelo CASCADE não sejam confundidos com remoções individuais.
CREATE OR REPLACE FUNCTION public.mark_deleting_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.deleting_org_id', OLD."id", true);
  RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER organization_mark_deleting_before_delete
BEFORE DELETE ON "organization"
FOR EACH ROW
EXECUTE FUNCTION public.mark_deleting_organization();--> statement-breakpoint

-- Defesa atômica dos invariantes ao remover um member pelo Better Auth. O
-- trigger compartilha o mutex de clans com criação/claim/transfer, revalida
-- dentro da transação do DELETE e limpa os vínculos sem janela de corrida.
CREATE OR REPLACE FUNCTION public.guard_and_cleanup_removed_member_clans()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  orphaned_clans text;
BEGIN
  IF current_setting('app.deleting_org_id', true) = OLD."organization_id" THEN
    RETURN OLD;
  END IF;

  PERFORM set_config('app.org_id', OLD."organization_id", true);

  PERFORM locked."id"
  FROM (
    SELECT "id"
    FROM "clans"
    WHERE "org_id" = OLD."organization_id"
      AND "active" = true
    ORDER BY "id"
    FOR UPDATE
  ) AS locked;

  IF EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "org_id" = OLD."organization_id"
      AND "assignee_id" = OLD."user_id"
      AND "status" IN (
        'pending',
        'in_progress',
        'awaiting_approval',
        'rejected'
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transfira ou conclua as missões ativas desta pessoa antes de removê-la.';
  END IF;

  SELECT string_agg(c."name", ', ' ORDER BY c."name")
  INTO orphaned_clans
  FROM "clan_memberships" AS target
  INNER JOIN "clans" AS c
    ON c."org_id" = target."org_id"
   AND c."id" = target."clan_id"
  WHERE target."org_id" = OLD."organization_id"
    AND target."user_id" = OLD."user_id"
    AND target."is_leader" = true
    AND c."active" = true
    AND NOT EXISTS (
      SELECT 1
      FROM "clan_memberships" AS other
      INNER JOIN "member" AS active_member
        ON active_member."organization_id" = other."org_id"
       AND active_member."user_id" = other."user_id"
      WHERE other."org_id" = target."org_id"
        AND other."clan_id" = target."clan_id"
        AND other."user_id" <> OLD."user_id"
        AND other."is_leader" = true
    );

  IF orphaned_clans IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Defina outro líder antes de remover este membro dos clãs: ' || orphaned_clans || '.';
  END IF;

  DELETE FROM "clan_memberships"
  WHERE "org_id" = OLD."organization_id"
    AND "user_id" = OLD."user_id";

  RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER member_guard_clans_before_delete
BEFORE DELETE ON "member"
FOR EACH ROW
EXECUTE FUNCTION public.guard_and_cleanup_removed_member_clans();--> statement-breakpoint

REVOKE ALL ON FUNCTION public.mark_deleting_organization() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mark_deleting_organization() TO guilda_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_and_cleanup_removed_member_clans() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.guard_and_cleanup_removed_member_clans() TO guilda_app;--> statement-breakpoint

-- Defesa em profundidade: mesmo o owner das tabelas respeita o isolamento.
-- O bootstrap acima ocorre antes do FORCE porque a migration não define org.
ALTER TABLE "clans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "clans"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "clan_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clan_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "clan_memberships"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "task_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_transfers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "task_transfers"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "clans" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "clan_memberships" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "task_transfers" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "task_transfers" FROM guilda_app;
