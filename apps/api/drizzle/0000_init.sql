CREATE TYPE "public"."organization_kind" AS ENUM('household', 'contractor', 'developer', 'supplier', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'handover', 'archived', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"display_name" text NOT NULL,
	"verified_phone" text,
	"verified_email" text,
	"locale" text DEFAULT 'rw' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_verified_phone_unique" UNIQUE("verified_phone"),
	CONSTRAINT "users_verified_email_unique" UNIQUE("verified_email")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"currency" char(3) DEFAULT 'RWF' NOT NULL,
	"timezone" text DEFAULT 'Africa/Kigali' NOT NULL,
	"country_code" char(2) DEFAULT 'RW' NOT NULL,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "projects_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;