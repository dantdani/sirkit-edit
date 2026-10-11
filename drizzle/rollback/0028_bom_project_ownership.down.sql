-- [B24-A4] DOWN for 0028_bom_project_ownership (OD-193). Class: requires empty - it runs only while no `bom_snapshots` or
-- `bom_notifications` row has an ownership column set (server-derived ownership is data this DOWN cannot keep); otherwise
-- DB_ROLLBACK_DATA_PRESENT. 0028:63-72 uncommented, unchanged; 0028:62's commented section is superseded by this file.
--
-- Reviewed SQL, kept outside the forward file: every byte of a forward migration is in its checksum and every non-comment chunk
-- of it runs forward (app/lib/db/migrations/manifest.ts), so an executable DOWN section inside the forward file would run on the
-- way up and, once edited, be checksum drift on every database that applied it. The rollback manifest
-- (app/lib/db/migrations/rollback.ts) binds this file to its forward migration's checksum and to its own;
-- `pnpm run db:migrate -- --rollback <name> --confirm <the typed confirmation>` runs it only while that migration is the newest
-- applied one, in one transaction with the removal of its ledger row, under the runner's advisory lock.

DROP INDEX IF EXISTS "bom_notifications_owner_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "bom_snapshots_owner_idx";
--> statement-breakpoint
ALTER TABLE "bom_notifications" DROP CONSTRAINT IF EXISTS "bom_notifications_ownership_complete_check";
--> statement-breakpoint
ALTER TABLE "bom_snapshots" DROP CONSTRAINT IF EXISTS "bom_snapshots_ownership_complete_check";
--> statement-breakpoint
ALTER TABLE "bom_notifications" DROP COLUMN IF EXISTS "branch_id";
--> statement-breakpoint
ALTER TABLE "bom_notifications" DROP COLUMN IF EXISTS "project_id";
--> statement-breakpoint
ALTER TABLE "bom_notifications" DROP COLUMN IF EXISTS "tenant_id";
--> statement-breakpoint
ALTER TABLE "bom_snapshots" DROP COLUMN IF EXISTS "branch_id";
--> statement-breakpoint
ALTER TABLE "bom_snapshots" DROP COLUMN IF EXISTS "project_id";
--> statement-breakpoint
ALTER TABLE "bom_snapshots" DROP COLUMN IF EXISTS "tenant_id";
