CREATE TABLE "bom_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_key" text NOT NULL,
	"source_snapshot_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"part_id" uuid,
	"summary" text NOT NULL,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bom_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_key" text NOT NULL,
	"label" text,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bom_meta" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bom_notifications" ADD CONSTRAINT "bom_notifications_source_snapshot_id_bom_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."bom_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_notifications" ADD CONSTRAINT "bom_notifications_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bom_notifications_unread_idx" ON "bom_notifications" USING btree ("project_key","read_at") WHERE "bom_notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "bom_notifications_created_idx" ON "bom_notifications" USING btree ("project_key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bom_snapshots_project_idx" ON "bom_snapshots" USING btree ("project_key","taken_at" DESC NULLS LAST);