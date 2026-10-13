ALTER TABLE "users" ADD COLUMN "reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_start" text DEFAULT '21:00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_end" text DEFAULT '07:00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_zone" text DEFAULT 'Africa/Kigali' NOT NULL;