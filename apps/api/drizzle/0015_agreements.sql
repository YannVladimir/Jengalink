CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"quote_id" uuid NOT NULL,
	"quote_number" text NOT NULL,
	"quote_revision_no" integer NOT NULL,
	"title" text NOT NULL,
	"scope" text NOT NULL,
	"exclusions" jsonb NOT NULL,
	"milestones" jsonb NOT NULL,
	"terms" text,
	"currency" char(3) NOT NULL,
	"contract_value" bigint NOT NULL,
	"accepted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_project_version_unique" UNIQUE("project_id","version")
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "decided_revision_no" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Agreements are a record of what was accepted: reject UPDATE and DELETE in the database itself.
CREATE OR REPLACE FUNCTION agreements_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agreements is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agreements_append_only
  BEFORE UPDATE OR DELETE ON agreements
  FOR EACH ROW EXECUTE FUNCTION agreements_reject_change();
