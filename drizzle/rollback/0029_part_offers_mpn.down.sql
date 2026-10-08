-- [B24-A4] DOWN for 0029_part_offers_mpn (OD-193). Class: requires empty - it runs only while every `part_offers.mpn` is
-- NULL (a stored exact MPN is data this DOWN cannot keep); otherwise DB_ROLLBACK_DATA_PRESENT. The reverse of 0029:14.
--
-- Reviewed SQL, kept outside the forward file: every byte of a forward migration is in its checksum and every non-comment chunk
-- of it runs forward (app/lib/db/migrations/manifest.ts), so an executable DOWN section inside the forward file would run on the
-- way up and, once edited, be checksum drift on every database that applied it. The rollback manifest
-- (app/lib/db/migrations/rollback.ts) binds this file to its forward migration's checksum and to its own;
-- `pnpm run db:migrate -- --rollback <name> --confirm <the typed confirmation>` runs it only while that migration is the newest
-- applied one, in one transaction with the removal of its ledger row, under the runner's advisory lock.

ALTER TABLE "part_offers" DROP COLUMN IF EXISTS "mpn";
