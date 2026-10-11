-- [B24-A4] DOWN for 0027_project_membership (OD-193). Class: requires empty - it runs only while `project_members` holds no
-- row (a membership is authority this DOWN cannot keep); otherwise DB_ROLLBACK_DATA_PRESENT. 0027:58-62 uncommented,
-- unchanged; 0027:7's header pointer and 0027:57's commented section are superseded by this file.
--
-- Reviewed SQL, kept outside the forward file: every byte of a forward migration is in its checksum and every non-comment chunk
-- of it runs forward (app/lib/db/migrations/manifest.ts), so an executable DOWN section inside the forward file would run on the
-- way up and, once edited, be checksum drift on every database that applied it. The rollback manifest
-- (app/lib/db/migrations/rollback.ts) binds this file to its forward migration's checksum and to its own;
-- `pnpm run db:migrate -- --rollback <name> --confirm <the typed confirmation>` runs it only while that migration is the newest
-- applied one, in one transaction with the removal of its ledger row, under the runner's advisory lock.

DROP POLICY IF EXISTS "project_members_self_select" ON "project_members";
--> statement-breakpoint
ALTER TABLE "project_members" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP INDEX IF EXISTS "project_members_lookup_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "project_members_tenant_project_user_uniq";
--> statement-breakpoint
DROP TABLE IF EXISTS "project_members";
