CREATE TYPE "public"."claim_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'changes_requested', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "claim_updates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"claim_id" uuid NOT NULL,
	"site_update_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "claim_updates_pair_unique" UNIQUE("claim_id","site_update_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "claim_status" DEFAULT 'draft' NOT NULL,
	"agreement_id" uuid NOT NULL,
	"milestone_index" integer NOT NULL,
	"milestone_name" text NOT NULL,
	"milestone_amount" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "claims_org_number_unique" UNIQUE("organization_id","number")
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "claim_updates" ADD CONSTRAINT "claim_updates_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_updates" ADD CONSTRAINT "claim_updates_site_update_id_site_updates_id_fk" FOREIGN KEY ("site_update_id") REFERENCES "public"."site_updates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_project_idx" ON "claims" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "media_claim_idx" ON "media" USING btree ("claim_id","position");