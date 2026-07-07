-- pcb_footprints: KiCad official footprint library, ingested from
-- https://github.com/KiCad/kicad-footprints (CC-BY-SA 4.0 with KiCad Libraries Exception).
-- Hand-edited after `drizzle-kit generate`: added the pg_trgm extension and
-- IF NOT EXISTS guards so re-applying is a no-op.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pcb_footprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lib_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tags" text,
	"attr_smd" boolean DEFAULT false NOT NULL,
	"attr_tht" boolean DEFAULT false NOT NULL,
	"pad_count" integer NOT NULL,
	"smd_pad_count" integer DEFAULT 0 NOT NULL,
	"tht_pad_count" integer DEFAULT 0 NOT NULL,
	"pads" jsonb NOT NULL,
	"courtyard_bbox" jsonb,
	"body_bbox" jsonb NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_sexpr" text NOT NULL,
	"source" text DEFAULT 'kicad-footprints' NOT NULL,
	"source_commit" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcb_footprints_embedding_idx" ON "pcb_footprints" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcb_footprints_trgm_idx" ON "pcb_footprints" USING gin (("lib_name" || ':' || "name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcb_footprints_pad_count_idx" ON "pcb_footprints" USING btree ("pad_count");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pcb_footprints_source_lib_name_uniq" ON "pcb_footprints" USING btree ("source","lib_name","name");
