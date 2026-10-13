CREATE TYPE "public"."acceptance_decision" AS ENUM('accepted', 'changes_requested');--> statement-breakpoint
CREATE TABLE "project_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"decision" "acceptance_decision" NOT NULL,
	"note" text,
	"project_revision" integer NOT NULL,
	"contract_value" bigint,
	"currency" char(3) NOT NULL,
	"stages" jsonb NOT NULL,
	"decided_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_acceptances" ADD CONSTRAINT "project_acceptances_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_acceptances" ADD CONSTRAINT "project_acceptances_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_acceptances_project_idx" ON "project_acceptances" USING btree ("project_id","created_at");--> statement-breakpoint
-- Owner decisions are a record, not editable data: reject UPDATE and DELETE in the database itself.
CREATE OR REPLACE FUNCTION project_acceptances_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'project_acceptances is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER project_acceptances_append_only
  BEFORE UPDATE OR DELETE ON project_acceptances
  FOR EACH ROW EXECUTE FUNCTION project_acceptances_reject_change();
