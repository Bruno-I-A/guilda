CREATE TABLE "mission_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"difficulty" smallint DEFAULT 2 NOT NULL,
	"order_index" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"tax_regime" "tax_regime" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_template_items" ADD CONSTRAINT "mission_template_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_template_items" ADD CONSTRAINT "mission_template_items_template_id_mission_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."mission_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_templates" ADD CONSTRAINT "mission_templates_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_template_items_org_template_idx" ON "mission_template_items" USING btree ("org_id","template_id");--> statement-breakpoint
CREATE INDEX "mission_templates_org_idx" ON "mission_templates" USING btree ("org_id");