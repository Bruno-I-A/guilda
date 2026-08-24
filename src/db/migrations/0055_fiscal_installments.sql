CREATE TABLE "fiscal_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"installment_type" varchar(240) NOT NULL,
	"notes" text,
	"delivery_method" varchar(240),
	"installment_number" varchar(120),
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_installments_type_check" CHECK (length(btrim("installment_type")) > 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_installments" ADD CONSTRAINT "fiscal_installments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_installments" ADD CONSTRAINT "fiscal_installments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_installments" ADD CONSTRAINT "fiscal_installments_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_installments" ADD CONSTRAINT "fiscal_installments_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_installments_org_id_uidx" ON "fiscal_installments" USING btree ("org_id","id");
--> statement-breakpoint
CREATE INDEX "fiscal_installments_org_client_idx" ON "fiscal_installments" USING btree ("org_id","client_id");
--> statement-breakpoint
CREATE INDEX "fiscal_installments_org_updated_idx" ON "fiscal_installments" USING btree ("org_id","updated_at");
--> statement-breakpoint
ALTER TABLE "fiscal_installments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fiscal_installments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "org_isolation" ON "fiscal_installments"
  FOR ALL
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fiscal_installments" TO guilda_app;
