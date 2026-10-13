CREATE TYPE "public"."captured_at_source" AS ENUM('device', 'exif');--> statement-breakpoint
CREATE TYPE "public"."media_scan_status" AS ENUM('pending', 'clean', 'infected', 'failed');--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "captured_at_source" "captured_at_source";--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "scan_status" "media_scan_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "scan_engine" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "thumb_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "processing_error" text;