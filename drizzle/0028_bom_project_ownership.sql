-- B16.0.2 §B — server-derived project OWNERSHIP for durable BOM rows.
--
-- FORWARD-ONLY. NOT applied to any live database during B16.0.2 (the stage
-- mandate forbids live mutation); an operator applies it deliberately.
--
-- Closes R3: `bom_snapshots` / `bom_notifications` were owned by nothing but a
-- caller-supplied `project_key` (often a schematic-content hash) and were
-- read/updated/deleted by raw id. Ownership now lives in three durable,
-- server-derived columns written ONLY from the trusted request context
-- (tenant_id, project_id, branch_id); `project_key` remains as
-- NON-AUTHORITATIVE display/dedupe metadata and never authorizes access.
--
-- LEGACY ROW DISPOSITION: existing rows receive NULL ownership. The
-- application's predicates always require the FULL non-null scope, so a NULL
-- row can never match — legacy rows are QUARANTINED (invisible, immutable,
-- undeletable through the API) until an explicit owner-controlled migration
-- assigns ownership. Ownership is NEVER guessed from project_key; no backfill
-- is performed here. See
-- artifacts/ai-control-plane-b16-0-2/migration-and-legacy-row-disposition.md.

ALTER TABLE "bom_snapshots" ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "bom_snapshots" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "bom_snapshots" ADD COLUMN IF NOT EXISTS "branch_id" text;

ALTER TABLE "bom_notifications" ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "bom_notifications" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "bom_notifications" ADD COLUMN IF NOT EXISTS "branch_id" text;

-- Ownership is all-or-nothing: a row is either fully owned or a quarantined
-- legacy row; a partially-owned row can never exist.
--
-- [B16.0.3 §D] the second disjunct now names IS NOT NULL EXPLICITLY. The
-- B16.0.2 form relied on `btrim(col) <> ''` alone, which evaluates to SQL
-- UNKNOWN when a column is NULL — and PostgreSQL CHECK rejects a row ONLY on
-- FALSE, so a partially-owned row (one column NULL, the others set) produced
-- UNKNOWN and PASSED (B16.0.3 R4). Adding `col IS NOT NULL` makes the second
-- disjunct evaluate to FALSE (not UNKNOWN) when any column is NULL, so a
-- partially-owned row is rejected.
ALTER TABLE "bom_snapshots" DROP CONSTRAINT IF EXISTS "bom_snapshots_ownership_complete_check";
ALTER TABLE "bom_snapshots" ADD CONSTRAINT "bom_snapshots_ownership_complete_check" CHECK (
  ("tenant_id" IS NULL AND "project_id" IS NULL AND "branch_id" IS NULL)
  OR (
    "tenant_id" IS NOT NULL AND "project_id" IS NOT NULL AND "branch_id" IS NOT NULL
    AND btrim("tenant_id") <> '' AND btrim("project_id") <> '' AND btrim("branch_id") <> ''
  )
);
ALTER TABLE "bom_notifications" DROP CONSTRAINT IF EXISTS "bom_notifications_ownership_complete_check";
ALTER TABLE "bom_notifications" ADD CONSTRAINT "bom_notifications_ownership_complete_check" CHECK (
  ("tenant_id" IS NULL AND "project_id" IS NULL AND "branch_id" IS NULL)
  OR (
    "tenant_id" IS NOT NULL AND "project_id" IS NOT NULL AND "branch_id" IS NOT NULL
    AND btrim("tenant_id") <> '' AND btrim("project_id") <> '' AND btrim("branch_id") <> ''
  )
);

-- "list recent snapshots / notifications for the OWNING project"
CREATE INDEX IF NOT EXISTS "bom_snapshots_owner_idx"
  ON "bom_snapshots" ("tenant_id", "project_id", "branch_id", "taken_at" DESC);
CREATE INDEX IF NOT EXISTS "bom_notifications_owner_idx"
  ON "bom_notifications" ("tenant_id", "project_id", "branch_id", "created_at" DESC);

-- ─── DOWN (rollback) ────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS "bom_notifications_owner_idx";
-- DROP INDEX IF EXISTS "bom_snapshots_owner_idx";
-- ALTER TABLE "bom_notifications" DROP CONSTRAINT IF EXISTS "bom_notifications_ownership_complete_check";
-- ALTER TABLE "bom_snapshots" DROP CONSTRAINT IF EXISTS "bom_snapshots_ownership_complete_check";
-- ALTER TABLE "bom_notifications" DROP COLUMN IF EXISTS "branch_id";
-- ALTER TABLE "bom_notifications" DROP COLUMN IF EXISTS "project_id";
-- ALTER TABLE "bom_notifications" DROP COLUMN IF EXISTS "tenant_id";
-- ALTER TABLE "bom_snapshots" DROP COLUMN IF EXISTS "branch_id";
-- ALTER TABLE "bom_snapshots" DROP COLUMN IF EXISTS "project_id";
-- ALTER TABLE "bom_snapshots" DROP COLUMN IF EXISTS "tenant_id";
