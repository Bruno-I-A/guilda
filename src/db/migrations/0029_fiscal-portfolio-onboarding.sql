ALTER TABLE "clients" ADD COLUMN "pending_fiscal_note" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "suggested_fiscal_owner_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_suggested_fiscal_owner_id_user_id_fk" FOREIGN KEY ("suggested_fiscal_owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;