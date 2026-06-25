ALTER TABLE "part_offers" ADD COLUMN "lifecycle_status" text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "part_offers" ADD COLUMN "lifecycle_raw" text;