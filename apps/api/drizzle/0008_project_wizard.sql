CREATE TYPE "public"."project_type" AS ENUM('house', 'renovation', 'apartment', 'commercial', 'civil');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('not_started', 'in_progress', 'ready_for_review', 'accepted');--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"weight" integer NOT NULL,
	"description" text,
	"planned_start" date,
	"planned_end" date,
	"status" "stage_status" DEFAULT 'not_started' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stages_weight_range" CHECK ("stages"."weight" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "type" "project_type" DEFAULT 'house' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "contract_value" bigint;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stages_project_idx" ON "stages" USING btree ("project_id","position");