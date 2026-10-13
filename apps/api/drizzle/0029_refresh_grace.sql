ALTER TABLE "sessions" ADD COLUMN "previous_token_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "rotated_at" timestamp with time zone;