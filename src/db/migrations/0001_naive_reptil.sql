CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'awaiting_approval', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"from_status" "task_status",
	"to_status" "task_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"assignee_id" text NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"priority" smallint DEFAULT 2 NOT NULL,
	"difficulty" smallint DEFAULT 2 NOT NULL,
	"xp_value" integer NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_events_org_task_idx" ON "task_events" USING btree ("org_id","task_id");--> statement-breakpoint
CREATE INDEX "tasks_org_assignee_status_idx" ON "tasks" USING btree ("org_id","assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_org_due_date_idx" ON "tasks" USING btree ("org_id","due_date");