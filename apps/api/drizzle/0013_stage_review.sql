CREATE TYPE "public"."stage_review_kind" AS ENUM('submitted', 'accepted', 'changes_requested');--> statement-breakpoint
ALTER TYPE "public"."stage_status" ADD VALUE 'changes_required';--> statement-breakpoint
CREATE TABLE "stage_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"kind" "stage_review_kind" NOT NULL,
	"note" text,
	"stage_revision" integer NOT NULL,
	"criteria" jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_reviews_stage_idx" ON "stage_reviews" USING btree ("stage_id","created_at");--> statement-breakpoint
-- Stage reviews are a record: reject UPDATE and DELETE in the database itself.
CREATE OR REPLACE FUNCTION stage_reviews_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage_reviews is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stage_reviews_append_only
  BEFORE UPDATE OR DELETE ON stage_reviews
  FOR EACH ROW EXECUTE FUNCTION stage_reviews_reject_change();
