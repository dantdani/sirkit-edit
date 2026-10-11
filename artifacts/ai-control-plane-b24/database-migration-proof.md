# B24-F - Database and migration proof

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834`. Written from the suites' own pins and B24-A4's record
(`artifacts/ai-control-plane-b24/database-and-recovery.md:15`); `b24-f-verdict-lines` 8 and 10 check this page.

## 1. The migrations

- **32 SQL migrations**, `0000` to `0031`: the manifest's entries (27 journal entries plus the five registered post-journal migrations
  `0027_project_membership`, `0028_bom_project_ownership`, `0029_part_offers_mpn`, `0030_atomic_revision_status_events` and
  `0031_rls_default_deny`), pinned at `app/lib/db/__tests__/b16-b-migrations.test.ts:39` (the manifest) and `:119` (every one applied on
  PGlite), moved 31 -> 32 by B24-A4's reviewed pin move (OD-192). **CONFIRMED** (read at both lines; `current-system-map.md` derives the
  same 32 from `drizzle/*.sql`).
- **143 PostgreSQL tables** named by `CREATE TABLE` in `drizzle/*.sql` (derived, unpinned; `trust-boundary-map.md` section 5.2).
- **CI.** The `database-delivery` job (`.github/workflows/deterministic-manufacturing.yml:347`) runs its PGlite suites with no
  `DATABASE_URL` and no qualification marker (`:360`): the migration suites and B24-A4's four, `b24-a4-rls-default-deny`,
  `b24-a4-test-isolation`, `b24-a4-rollback` and `b24-a4-restore` (`:377-380`), beside B24-C1..C3's and B24-D2's PGlite suites
  (`:381-384`). `b24-a4-database-tls` runs in `prompt-to-gerber`. B24-D4's run on `6e4e1bb` (38076687384) was green in every job (the
  lead's reading, RECORDED).

## 2. What is proven offline, on PGlite (**CONFIRMED** by B24-A4's suites)

- **Default-deny row security** (D24-3 offline, OD-192): `0031_rls_default_deny` enables row security with no policy on the 143 tables
  but `project_members`, so the emulated Data API roles read nothing (`b24-a4-rls-default-deny`); the server's owning role is
  unaffected. A proposed application role with table-level grants is recorded, not applied (`database-and-recovery.md:49`).
- **TLS for every non-loopback database URL** (`b24-a4-database-tls`; `database-and-recovery.md:116`).
- **The shared test-data guard** (D24-12, OD-201): every database-gated suite refuses a non-empty target before its first write
  (`b24-a4-test-isolation`; `database-and-recovery.md:158`).
- **Rollback** (D24-2 offline, OD-193): reviewed DOWN SQL in `drizzle/rollback/` for 0027-0031, bound to each forward migration's
  checksum, run newest-first by `db:migrate -- --rollback <name> --confirm roll_back_newest_migration` in one transaction under the
  runner's advisory lock; 0000-0026 stay forward-only (rollback means restore). Apply, roll back and re-apply reach the clean
  fingerprint on PGlite, and every refusal leaves the ledger byte-identical (`b24-a4-rollback`; `database-and-recovery.md:250`).
- **Logical dump and restore** (D24-7 offline, OD-194): `sirkit.db-logical-dump.v1` over the 143 tables, restored to an identical
  fingerprint on PGlite (`b24-a4-restore`; `database-and-recovery.md:289`).
- **A lost connection fails closed** (D24-7): no trusted context, no 2xx, no driver message in a body; a durable append that loses its
  connection writes nothing and its retry writes once (`b24-a4-restore` 5; `database-and-recovery.md:342`).

## 3. The 2026-09-24 run: real-server qualification on a non-isolated project (**RECORDED**)

On 2026-09-24, with the owner's authorisation, the lead created two empty disposable databases on the main Supabase project's
PostgreSQL 17.6 server: every migration applied on the clean one, the replay applied nothing, the 0000-0026 upgrade on the second
reached the identical schema fingerprint, and the nine database-gated suites passed there
(`artifacts/remaining-builder-program/EXECUTION_LEDGER.md:2490-2509`). It is recorded as real-server qualification on a non-isolated
project, not as staging (OD-191): the project may hold production data (UNKNOWN; discovery section 8 item 2), so B24 treats it as
production and no B24 test, script or run touched it. It is LB-4's QUALIFIED row and the matrix's Q9
(`artifacts/ai-control-plane-b24/qualification-matrix.md:214`). Whether `0029` and `0030` ran in it is not recorded (INFERRED yes: both
were committed before the run); `0031` did not exist then.

## 4. The real platform: BLOCKED-LIVE-QUALIFICATION (LB-14)

Never faked, each needs the owner's isolated project or the staging or production project's settings (OD-191, OD-192, OD-194;
`database-and-recovery.md:367`): the Data API's exposure of `public` and the real grants; the real roles and whether `DATABASE_URL`'s
role owns the tables or has `BYPASSRLS`; certificate verification against the platform's CA; the backup schedule and the point-in-time
recovery window; failover, a replica and real reconnection; a real-server rollback and restore. The matrix's Q10 is BLOCKED (LB-14,
LB-6).

## 5. What stays open (INFERRED)

- `0031` would be applied to a live database by an operator only; no B24 increment applied any migration to one.
- The rollback of `0027`-`0030` is "requires empty": a populated table refuses (`DB_ROLLBACK_DATA_PRESENT`); restore is the path then.
