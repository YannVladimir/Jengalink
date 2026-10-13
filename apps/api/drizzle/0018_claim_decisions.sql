CREATE TYPE "public"."claim_decision_kind" AS ENUM('approved', 'rejected', 'changes_requested');--> statement-breakpoint
CREATE TABLE "claim_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"kind" "claim_decision_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"claim_revision" integer NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_decisions" ADD CONSTRAINT "claim_decisions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_decisions" ADD CONSTRAINT "claim_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_decisions" ADD CONSTRAINT "claim_decisions_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_decisions_claim_idx" ON "claim_decisions" USING btree ("claim_id","created_at");--> statement-breakpoint
-- Claim decisions are a record: reject UPDATE and DELETE in the database itself.
CREATE OR REPLACE FUNCTION claim_decisions_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'claim_decisions is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claim_decisions_append_only
  BEFORE UPDATE OR DELETE ON claim_decisions
  FOR EACH ROW EXECUTE FUNCTION claim_decisions_reject_change();
