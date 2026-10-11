-- [B24-A4] DOWN for 0030_atomic_revision_status_events (OD-193). Class: requires empty - it runs only while
-- `atomic_revision_status_events` holds no row (a withdrawal event is history this DOWN cannot keep); otherwise the
-- rollback is refused DB_ROLLBACK_DATA_PRESENT and the way back is a restore. The reverse of 0030:15-36.
--
-- Reviewed SQL, kept outside the forward file: every byte of a forward migration is in its checksum and every non-comment chunk
-- of it runs forward (app/lib/db/migrations/manifest.ts), so an executable DOWN section inside the forward file would run on the
-- way up and, once edited, be checksum drift on every database that applied it. The rollback manifest
-- (app/lib/db/migrations/rollback.ts) binds this file to its forward migration's checksum and to its own;
-- `pnpm run db:migrate -- --rollback <name> --confirm <the typed confirmation>` runs it only while that migration is the newest
-- applied one, in one transaction with the removal of its ledger row, under the runner's advisory lock.

DROP INDEX IF EXISTS "atomic_status_event_successor_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "atomic_status_event_revision_state_uniq";
--> statement-breakpoint
DROP TABLE IF EXISTS "atomic_revision_status_events";
