CREATE TABLE "quote_internal_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_revision_id" uuid NOT NULL,
	"costs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "quote_internal_costs_quoteRevisionId_unique" UNIQUE("quote_revision_id")
);
--> statement-breakpoint
ALTER TABLE "quote_internal_costs" ADD CONSTRAINT "quote_internal_costs_quote_revision_id_quote_revisions_id_fk" FOREIGN KEY ("quote_revision_id") REFERENCES "public"."quote_revisions"("id") ON DELETE cascade ON UPDATE no action;