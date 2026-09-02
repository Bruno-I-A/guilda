CREATE TYPE "public"."clan_duty" AS ENUM('company_flow', 'informative');--> statement-breakpoint
CREATE TABLE "clan_member_duties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clan_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"duty" "clan_duty" NOT NULL,
	"assigned_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clan_member_duties" ADD CONSTRAINT "clan_member_duties_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_member_duties" ADD CONSTRAINT "clan_member_duties_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_member_duties" ADD CONSTRAINT "clan_member_duties_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_member_duties" ADD CONSTRAINT "clan_member_duties_org_clan_fk" FOREIGN KEY ("org_id","clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_member_duties" ADD CONSTRAINT "clan_member_duties_membership_fk" FOREIGN KEY ("org_id","clan_id","user_id") REFERENCES "public"."clan_memberships"("org_id","clan_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clan_member_duties_org_clan_duty_uidx" ON "clan_member_duties" USING btree ("org_id","clan_id","duty");--> statement-breakpoint
CREATE INDEX "clan_member_duties_org_user_idx" ON "clan_member_duties" USING btree ("org_id","user_id");--> statement-breakpoint

-- Defesa em profundidade: a aplicação filtra por org_id E o Postgres garante.
-- FORCE alcança o dono quando ele não é superuser; a proteção de primeira linha
-- continua sendo a app conectar como guilda_app (role não-superuser).
ALTER TABLE "clan_member_duties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clan_member_duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "clan_member_duties"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "clan_member_duties" TO guilda_app;
