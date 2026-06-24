CREATE TABLE "alternates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"alternate_part_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"score" integer NOT NULL,
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"distributor" text NOT NULL,
	"distributor_sku" text,
	"price_breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stock" integer,
	"min_order_qty" integer,
	"lead_time_days" integer,
	"product_url" text,
	"last_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "normalized_mpn" text;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "internal_part_number" text;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "lifecycle_status" text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "rohs_status" text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "package_normalized" text;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "key_specs" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alternates" ADD CONSTRAINT "alternates_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternates" ADD CONSTRAINT "alternates_alternate_part_id_parts_id_fk" FOREIGN KEY ("alternate_part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_offers" ADD CONSTRAINT "part_offers_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alternates_part_kind_idx" ON "alternates" USING btree ("part_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "alternates_pair_uniq" ON "alternates" USING btree ("part_id","alternate_part_id");--> statement-breakpoint
CREATE UNIQUE INDEX "part_offers_part_distributor_uniq" ON "part_offers" USING btree ("part_id","distributor");--> statement-breakpoint
CREATE INDEX "part_offers_part_idx" ON "part_offers" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_offers_refreshed_idx" ON "part_offers" USING btree ("last_refreshed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_normalized_mpn_uniq" ON "parts" USING btree ("normalized_mpn") WHERE "parts"."normalized_mpn" IS NOT NULL;