CREATE TYPE "public"."site_update_status" AS ENUM('submitted');--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"site_update_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "media_storageKey_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "site_updates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"note" text,
	"blockers" text,
	"status" "site_update_status" DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_site_update_id_site_updates_id_fk" FOREIGN KEY ("site_update_id") REFERENCES "public"."site_updates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_updates" ADD CONSTRAINT "site_updates_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_updates" ADD CONSTRAINT "site_updates_stage_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_site_update_idx" ON "media" USING btree ("site_update_id","position");--> statement-breakpoint
CREATE INDEX "site_updates_project_idx" ON "site_updates" USING btree ("project_id","created_at");