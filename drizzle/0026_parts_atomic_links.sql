-- Join from the KiCad search catalog (`parts`) to published atomic part
-- revisions. Written only by the atomic seeding/publication flow after
-- `publishPortableAtomicSnapshot` succeeds; read by /api/parts/[id] to attach
-- exact `atomicAssignment` (symbol/footprint/mapping authority) to search
-- results so generated schematic instances carry footprint-ready identity.
-- `value_key` distinguishes value-specific exact parts sharing one symbol
-- (e.g. Device:R at 47k vs 1k are different MPNs); '' is the value-agnostic
-- default used for parts whose identity does not depend on the value field.
-- Hand-written (like 0005): IF NOT EXISTS so re-applying is a no-op.
CREATE TABLE IF NOT EXISTS "parts_atomic_links" (
  "part_id" uuid NOT NULL REFERENCES "parts"("id") ON DELETE CASCADE,
  "value_key" text NOT NULL DEFAULT '',
  "atomic_part_revision_id" text NOT NULL,
  "symbol_asset_version_id" text NOT NULL,
  "footprint_asset_version_id" text NOT NULL,
  "mapping_certificate_id" text NOT NULL,
  "footprint_full_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("part_id", "value_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parts_atomic_links_revision_idx" ON "parts_atomic_links" ("atomic_part_revision_id");
