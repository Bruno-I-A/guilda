CREATE TYPE "public"."guild_notice_kind" AS ENUM('notice', 'new_client');--> statement-breakpoint
CREATE TYPE "public"."informative_source" AS ENUM('telegram', 'panel');--> statement-breakpoint

-- telegram_ai_drafts vira informatives: o nome passa a dizer o que a linha é
-- (o informativo recebido, com texto original, extração da IA e estado de
-- confirmação) e a tabela deixa de pertencer só ao Telegram. RENAME preserva
-- os dados e os índices; os nomes das constraints são renomeados junto para
-- continuarem batendo com o snapshot do drizzle-kit.
ALTER TABLE "telegram_ai_drafts" RENAME TO "informatives";--> statement-breakpoint
ALTER TABLE "informatives" RENAME CONSTRAINT "telegram_ai_drafts_org_id_organization_id_fk" TO "informatives_org_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "informatives" RENAME CONSTRAINT "telegram_ai_drafts_requested_by_user_id_fk" TO "informatives_requested_by_user_id_fk";--> statement-breakpoint
ALTER TABLE "informatives" RENAME CONSTRAINT "telegram_ai_drafts_connection_id_telegram_connections_id_fk" TO "informatives_connection_id_telegram_connections_id_fk";--> statement-breakpoint
ALTER INDEX "telegram_ai_drafts_org_user_status_idx" RENAME TO "informatives_org_user_status_idx";--> statement-breakpoint
ALTER INDEX "telegram_ai_drafts_expires_idx" RENAME TO "informatives_expires_idx";--> statement-breakpoint
-- Informativo colado no painel não tem conversa do Telegram por trás.
ALTER TABLE "informatives" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "informatives" ADD COLUMN "source" "informative_source" DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
-- Necessário para a FK composta (org_id, informative_id) das novas tabelas.
CREATE UNIQUE INDEX "informatives_org_id_uidx" ON "informatives" USING btree ("org_id","id");--> statement-breakpoint

CREATE TABLE "guild_notice_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"notice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"author_id" text NOT NULL,
	"kind" "guild_notice_kind" DEFAULT 'notice' NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"client_id" uuid,
	"informative_id" uuid,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- O índice único composto precisa existir antes da FK tenant-aware que o usa.
CREATE UNIQUE INDEX "guild_notices_org_id_uidx" ON "guild_notices" USING btree ("org_id","id");--> statement-breakpoint
CREATE TABLE "task_assignee_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text,
	"raw_name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "informative_id" uuid;--> statement-breakpoint
ALTER TABLE "guild_notice_reads" ADD CONSTRAINT "guild_notice_reads_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notice_reads" ADD CONSTRAINT "guild_notice_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notice_reads" ADD CONSTRAINT "guild_notice_reads_org_notice_fk" FOREIGN KEY ("org_id","notice_id") REFERENCES "public"."guild_notices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notices" ADD CONSTRAINT "guild_notices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notices" ADD CONSTRAINT "guild_notices_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notices" ADD CONSTRAINT "guild_notices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_notices" ADD CONSTRAINT "guild_notices_informative_id_informatives_id_fk" FOREIGN KEY ("informative_id") REFERENCES "public"."informatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignee_suggestions" ADD CONSTRAINT "task_assignee_suggestions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignee_suggestions" ADD CONSTRAINT "task_assignee_suggestions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignee_suggestions" ADD CONSTRAINT "task_assignee_suggestions_org_task_fk" FOREIGN KEY ("org_id","task_id") REFERENCES "public"."tasks"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_notice_reads_org_notice_user_uidx" ON "guild_notice_reads" USING btree ("org_id","notice_id","user_id");--> statement-breakpoint
CREATE INDEX "guild_notice_reads_org_user_idx" ON "guild_notice_reads" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "guild_notices_org_pinned_published_idx" ON "guild_notices" USING btree ("org_id","pinned","published_at" DESC NULLS LAST);--> statement-breakpoint
-- Um aviso de empresa nova por informativo: idempotência do mesmo tipo usada
-- no crédito de XP. Reconfirmar o informativo não gera um segundo aviso.
CREATE UNIQUE INDEX "guild_notices_new_client_uidx" ON "guild_notices" USING btree ("informative_id") WHERE kind = 'new_client';--> statement-breakpoint
CREATE INDEX "task_assignee_suggestions_org_task_idx" ON "task_assignee_suggestions" USING btree ("org_id","task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_informative_id_informatives_id_fk" FOREIGN KEY ("informative_id") REFERENCES "public"."informatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_informative_idx" ON "tasks" USING btree ("org_id","informative_id");--> statement-breakpoint

-- Row Level Security nas tabelas novas — mesma política das demais tabelas de
-- domínio (ver 0002_rls-domain.sql para o racional do role guilda_app).
-- FORCE porque, como em 0022, nem o owner das tabelas deve escapar do
-- isolamento por organização.
ALTER TABLE "task_assignee_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_assignee_suggestions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "task_assignee_suggestions"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "guild_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guild_notices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "guild_notices"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "guild_notice_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guild_notice_reads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "guild_notice_reads"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "task_assignee_suggestions" TO guilda_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "guild_notices" TO guilda_app;--> statement-breakpoint
-- Confirmação de leitura é FATO REGISTRADO: sem UPDATE e sem DELETE, como no
-- ledger de XP. Não existe "desconfirmar".
GRANT SELECT, INSERT ON "guild_notice_reads" TO guilda_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "guild_notice_reads" FROM guilda_app;
