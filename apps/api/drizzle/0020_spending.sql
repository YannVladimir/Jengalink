CREATE TYPE "public"."budget_movement_kind" AS ENUM('reserve', 'convert', 'release');--> statement-breakpoint
CREATE TYPE "public"."spending_decision_kind" AS ENUM('approved', 'rejected', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."spending_status" AS ENUM('draft', 'submitted', 'approved', 'changes_requested', 'rejected', 'withdrawn', 'closed');--> statement-breakpoint
CREATE TABLE "budget_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"expense_id" uuid,
	"budget_line" text NOT NULL,
	"kind" "budget_movement_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"request_id" uuid NOT NULL,
	"description" text NOT NULL,
	"supplier_name" text,
	"expense_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "expenses_org_number_unique" UNIQUE("organization_id","number")
);
--> statement-breakpoint
CREATE TABLE "spending_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "spending_decision_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"request_revision" integer NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spending_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "spending_status" DEFAULT 'draft' NOT NULL,
	"agreement_id" uuid NOT NULL,
	"milestone_index" integer NOT NULL,
	"milestone_name" text NOT NULL,
	"stage_id" uuid,
	"purpose" text NOT NULL,
	"required_date" date,
	"lines" jsonb NOT NULL,
	"amount" bigint NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "spending_requests_org_number_unique" UNIQUE("organization_id","number")
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "spending_request_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_request_id_spending_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."spending_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_request_id_spending_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."spending_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_decisions" ADD CONSTRAINT "spending_decisions_request_id_spending_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."spending_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_decisions" ADD CONSTRAINT "spending_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_decisions" ADD CONSTRAINT "spending_decisions_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_requests" ADD CONSTRAINT "spending_requests_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_requests" ADD CONSTRAINT "spending_requests_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_requests" ADD CONSTRAINT "spending_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_requests" ADD CONSTRAINT "spending_requests_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_movements_line_idx" ON "budget_movements" USING btree ("project_id","budget_line");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_one_reserve" ON "budget_movements" USING btree ("request_id") WHERE kind = 'reserve';--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_one_release" ON "budget_movements" USING btree ("request_id") WHERE kind = 'release';--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_one_convert" ON "budget_movements" USING btree ("expense_id") WHERE kind = 'convert';--> statement-breakpoint
CREATE INDEX "expenses_request_idx" ON "expenses" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "spending_decisions_request_idx" ON "spending_decisions" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "spending_requests_project_idx" ON "spending_requests" USING btree ("project_id","created_at");--> statement-breakpoint
-- The budget ledger and the owner's answers are records: reject UPDATE and DELETE.
CREATE OR REPLACE FUNCTION spending_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER budget_movements_append_only
  BEFORE UPDATE OR DELETE ON budget_movements
  FOR EACH ROW EXECUTE FUNCTION spending_reject_change();
--> statement-breakpoint
CREATE TRIGGER spending_decisions_append_only
  BEFORE UPDATE OR DELETE ON spending_decisions
  FOR EACH ROW EXECUTE FUNCTION spending_reject_change();
--> statement-breakpoint
CREATE TRIGGER expenses_append_only
  BEFORE UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION spending_reject_change();
