CREATE TYPE "public"."receipt_status" AS ENUM('captured', 'manually_reviewed', 'externally_confirmed', 'discrepancy_found');--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"status" "receipt_status" DEFAULT 'captured' NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_tin" text,
	"buyer_tin" text,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"total" bigint NOT NULL,
	"vat_amount" bigint,
	"ebm_reference" text,
	"qr_payload" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "receipts_expenseId_unique" UNIQUE("expense_id")
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_invoice_idx" ON "receipts" USING btree ("organization_id","supplier_tin","invoice_number");--> statement-breakpoint
CREATE INDEX "media_sha256_idx" ON "media" USING btree ("organization_id","sha256");