CREATE TABLE "claim_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"agreement_id" uuid NOT NULL,
	"milestone_index" integer NOT NULL,
	"milestone_name" text NOT NULL,
	"milestone_amount" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"site_update_ids" jsonb NOT NULL,
	"file_ids" jsonb NOT NULL,
	"change_note" text,
	"cancelled_approval" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_revisions_claim_no_unique" UNIQUE("claim_id","revision_no")
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claim_decisions" ADD COLUMN "revision_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "revision_no" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_revisions" ADD CONSTRAINT "claim_revisions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_revisions" ADD CONSTRAINT "claim_revisions_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_revisions" ADD CONSTRAINT "claim_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_revisions" ADD CONSTRAINT "claim_revisions_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- What the owner was sent is a record: reject UPDATE and DELETE in the database itself.
CREATE OR REPLACE FUNCTION claim_revisions_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'claim_revisions is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claim_revisions_append_only
  BEFORE UPDATE OR DELETE ON claim_revisions
  FOR EACH ROW EXECUTE FUNCTION claim_revisions_reject_change();
