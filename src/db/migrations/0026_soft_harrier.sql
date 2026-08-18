CREATE TYPE "public"."clan_campaign_status" AS ENUM('planned', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "clan_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clan_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"period_year" smallint NOT NULL,
	"period_month" smallint NOT NULL,
	"due_date" date,
	"status" "clan_campaign_status" DEFAULT 'planned' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clan_campaigns_period_month_check" CHECK ("clan_campaigns"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "clan_campaigns_period_year_check" CHECK ("clan_campaigns"."period_year" BETWEEN 2000 AND 2100)
);
--> statement-breakpoint
CREATE TABLE "fiscal_portfolio_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"actor_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clan_campaigns" ADD CONSTRAINT "clan_campaigns_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_campaigns" ADD CONSTRAINT "clan_campaigns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_campaigns" ADD CONSTRAINT "clan_campaigns_org_clan_fk" FOREIGN KEY ("org_id","clan_id") REFERENCES "public"."clans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" ADD CONSTRAINT "fiscal_portfolio_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" ADD CONSTRAINT "fiscal_portfolio_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" ADD CONSTRAINT "fiscal_portfolio_events_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" ADD CONSTRAINT "fiscal_portfolio_events_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolio_events" ADD CONSTRAINT "fiscal_portfolio_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolios" ADD CONSTRAINT "fiscal_portfolios_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolios" ADD CONSTRAINT "fiscal_portfolios_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolios" ADD CONSTRAINT "fiscal_portfolios_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_portfolios" ADD CONSTRAINT "fiscal_portfolios_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clan_campaigns_org_clan_period_name_uidx" ON "clan_campaigns" USING btree ("org_id","clan_id","period_year","period_month","name");--> statement-breakpoint
CREATE INDEX "clan_campaigns_org_clan_period_idx" ON "clan_campaigns" USING btree ("org_id","clan_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "fiscal_portfolio_events_org_client_idx" ON "fiscal_portfolio_events" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "fiscal_portfolio_events_org_created_idx" ON "fiscal_portfolio_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_portfolios_org_client_uidx" ON "fiscal_portfolios" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "fiscal_portfolios_org_user_idx" ON "fiscal_portfolios" USING btree ("org_id","user_id");