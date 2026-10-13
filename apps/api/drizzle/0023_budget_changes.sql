CREATE TYPE "public"."change_category" AS ENUM('owner_request', 'unforeseen_conditions', 'specification_change', 'quantity_correction');--> statement-breakpoint
CREATE TYPE "public"."change_decision_kind" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."change_status" AS ENUM('draft', 'submitted', 'applied', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "budget_change_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"kind" "change_decision_kind" NOT NULL,
	"net_delta" bigint NOT NULL,
	"change_revision" integer NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "change_status" DEFAULT 'draft' NOT NULL,
	"base_agreement_id" uuid NOT NULL,
	"category" "change_category" NOT NULL,
	"reason" text NOT NULL,
	"schedule_days" integer,
	"lines" jsonb NOT NULL,
	"net_delta" bigint NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"applied_agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_changes_org_number_unique" UNIQUE("organization_id","number")
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "budget_change_id" uuid;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN "change_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_change_decisions" ADD CONSTRAINT "budget_change_decisions_change_id_budget_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."budget_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_change_decisions" ADD CONSTRAINT "budget_change_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_change_decisions" ADD CONSTRAINT "budget_change_decisions_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_changes" ADD CONSTRAINT "budget_changes_base_agreement_id_agreements_id_fk" FOREIGN KEY ("base_agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_changes" ADD CONSTRAINT "budget_changes_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_changes" ADD CONSTRAINT "budget_changes_applied_agreement_id_agreements_id_fk" FOREIGN KEY ("applied_agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_changes" ADD CONSTRAINT "budget_changes_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_change_decisions_change_idx" ON "budget_change_decisions" USING btree ("change_id","created_at");--> statement-breakpoint
CREATE INDEX "budget_changes_project_idx" ON "budget_changes" USING btree ("project_id","created_at");--> statement-breakpoint
-- The owner's answers are a record: reject UPDATE and DELETE.
CREATE TRIGGER budget_change_decisions_append_only
  BEFORE UPDATE OR DELETE ON budget_change_decisions
  FOR EACH ROW EXECUTE FUNCTION spending_reject_change();
