CREATE TYPE "public"."payment_method" AS ENUM('mtn_momo', 'airtel_money', 'bank_transfer', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_side" AS ENUM('client', 'contractor', 'finance');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending_verification', 'settled', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending_verification' NOT NULL,
	"claim_id" uuid,
	"payer" text NOT NULL,
	"beneficiary" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'RWF' NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"payment_date" date NOT NULL,
	"note" text,
	"recorded_side" "payment_side" NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payments_org_number_unique" UNIQUE("organization_id","number")
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_project_idx" ON "payments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_claim_idx" ON "payments" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "payments_reference_idx" ON "payments" USING btree ("organization_id","method","reference");