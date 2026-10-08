# B24-A4 - Data layer: roles, row security, TLS, test isolation, rollback and recovery

Labels: **CONFIRMED** (executed here and measured, or read at the cited file:line), **INFERRED** (code reading, nothing executed),
**PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied; never faked, never claimed).

Base: `3cd7d6e` on `chapter/b24-production-qualification` (B24-A1, A2 and A3 committed). B24-A4 closes D24-2 offline, D24-3 offline,
D24-7 offline and D24-12 (runbook B24-A `:1031` "supported database migration/rollback;", `:1033` "least-privilege service roles;",
`:1037` "backup/restore and point-in-time recovery evidence;", `:1044` "Never reuse production data in tests.", B24-D `:1103`
"database failover/recovery;"; OD-191, OD-192, OD-193, OD-194, OD-201; LB-14). It was delivered in one workflow run in two halves for one
commit by the lead: B24-A4a (row security, TLS, test isolation; sections 1-5) and then, after A4a's suites were green in that run,
B24-A4b (rollback, restore, a lost connection; sections 6-9). Every line number on this page is the B24-A4 working tree's unless it
names another tree.

## 0. What B24-A4 is

- **What it is.** One migration, `drizzle/0031_rls_default_deny.sql`, that enables row security with no policy on the 142 tables other
  than `project_members` and on the runner's own ledger (section 2); `.enableRLS()` on the same 142 `pgTable` declarations of
  `schema.ts`, each on its closing line; `verifyDefaultDenyRls`; one TLS rule, `databaseTls`, at every `postgres(` call (section 3); a
  shared test-data guard that every database-gated suite awaits before its first statement, with `schema-integrity` scoped to its own
  run (section 4); a start check for the acceptance driver; a reviewed rollback of the newest migration, with its DOWN SQL kept in
  `drizzle/rollback/` and an operator CLI (section 6); a logical dump and restore (section 7); and a proof that a lost database
  connection fails closed (section 9).
- **What it is not.** No route, agent or MCP tool, action record, UI control, environment name or dependency (OD-42): the census stays
  168 / 165 / 3 / 0, the tool counts 47 / 36 / 9 / 27, the action records 107. The migration count moves 31 -> 32 by review (section
  15). Migrations 0000-0030 are byte-identical to `3cd7d6e` (their checksums are pinned literally, `b24-a4-rollback` 1). Nothing was
  applied to any live database, no Supabase setting, role, grant or backup was touched, and every live half is
  **BLOCKED-LIVE-QUALIFICATION** (section 11). The nine B11-scanned files are untouched.
- **What the builder did not run.** No `next dev`, `next build`, `next start` or Playwright, no `db:migrate`, no acceptance driver, and
  no database-gated suite with the qualification marker set: every database proof here ran on PGlite in the test process.

## 1. The pre-edit counterexamples (PGlite, before any edit; **CONFIRMED**)

A temporary suite ran on the unedited `3cd7d6e` tree, was recorded and was then deleted (it is not committed):

- **P1, Data API exposure (D24-3).** With the platform's default grants emulated (section 2.4), `anon` and `authenticated` each read
  the seeded `bom_snapshots` row: `{"anon":1,"authenticated":1}`; one `public` table of 143 had row security (`project_members`).
  Reproduced.
- **P2, no rollback (D24-2).** The runner exported `MigrationRefusal, checkMigrationPrerequisites, ensureLedger, migrateDatabase,
  migrationStatus, reconcileLedger` and nothing that rolls back; the CLI read only `--baseline`, `--status` and `--dry-run`; no rollback
  module and no `drizzle/rollback/` existed. **INFERRED** from that source: at `3cd7d6e` any other flag, `--rollback` included, fell
  through to `migrateDatabase` and would have applied every pending migration. Reproduced.
- **P3, unscoped deletes (D24-12).** The five statements at `3cd7d6e`'s `schema-integrity.test.ts:54-58` (`DELETE FROM
  physical_binding_audit_events`, `... physical_readiness_assessments`, `... physical_binding_migration_records`, `...
  physical_binding_sets`, `... physical_binding_revisions`), run against a database holding a foreign tenant's physical-binding aggregate,
  took its rows from `{"revisions":1,"sets":1,"audits":1,"migrations":1,"assessments":1}` to all zero, its readiness row included.
  Reproduced.

## 2. Default-deny row security (D24-3 offline, OD-192)

### 2.1 Migration 0031 (**CONFIRMED** on PGlite)

`drizzle/0031_rls_default_deny.sql` holds 143 statements, `ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY;`, one per table: `schema.ts`'s
tables but `project_members`, then `sirkit_schema_migrations` (created by the runner before any migration runs, `runner.ts:163-168` at
`3cd7d6e`). The list is static and reviewed, not a loop over the catalog. No policy, no `FORCE`, no `CREATE ROLE`, no `GRANT`, no
`REVOKE` (`b24-a4-rls-default-deny` 6, 7, 9). Since the review round (section 18) the guard over `drizzle/` reads each statement whole,
with comments and literals tokenised rather than pattern-blanked, so a role or a grant inside a DO block, dynamic SQL (`EXECUTE` of a
literal naming one), `CREATE USER`/`GROUP`, `ALTER ROLE`/`USER`/`GROUP`, `ALTER DEFAULT PRIVILEGES`, and a statement behind a block
comment or an inline comment's apostrophe are refused too (case 9's planted variants). It is registered in place at `manifest.ts:36`
(on 0030's line, so no line of the manifest moves). Its header states the owner bypass (**INFERRED** for the real platform, LB-14), the
owner's pre-apply step (2.2) and the way back.

On a database migrated through the manifest, every `public` table has row security, the ledger included (read from `pg_class`, because
the snapshot leaves it out, `verify-schema.ts:29`), and none is forced (`b24-a4-rls-default-deny` 1). With the grants emulated, `anon`
and `authenticated` read zero rows of `bom_snapshots`, `libraries` and `architecture_candidates` and every insert is refused (case 2);
the `project_members` self-select is unchanged: a user reads only their own active row, `anon` none, nobody writes, and that policy is
the only one (case 3). A non-superuser owner (`NOLOGIN NOSUPERUSER NOBYPASSRLS`) reads and inserts into the tables it owns; on its own
instance, after a test-only `FORCE ROW LEVEL SECURITY` on `libraries`, the same role reads zero rows there, so the owner case is not
vacuous (case 4; the PGlite session is a superuser, which bypasses row security even when forced, `disposable-postgres.ts:3-4`).

`schema.ts`: all 143 `pgTable(` declarations carry `.enableRLS()`, 142 added on their closing lines, the 143rd at `:1384` as before;
the file keeps its 1,502 lines (case 5). The push path keeps parity: `b16-b-schema-parity` is green unchanged, with the same 30
recorded differences (`onlyInPush=6 onlyInMigrations=16 changed=8`). `verifyDefaultDenyRls` (`verify-schema.ts:163`) checks that every
`public` table in the snapshot has row security, none is forced, policies exist only on `project_members`, and
`verifyMembershipAndOwnership` still holds (one row); it fails a database through 0030 on exactly the 142 tables, and a forced table or
an open policy elsewhere by name (case 8).

### 2.2 The owner's pre-apply step, and the way back (**RECORDED**; never run by the builder)

Which role production's `DATABASE_URL` names is **UNKNOWN** (discovery section 8 item 3). If that role neither owns the tables nor has
`BYPASSRLS`, 0031 makes every server read return zero rows and every insert fail. So, on the target, connected as the server's own
`DATABASE_URL` role, one of these must hold, or 0031 is not applied:

```sql
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user);
-- returns no row: the role owns every table
SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user;
-- returns true
```

The way back is 0031's lossless DOWN: `pnpm run db:migrate -- --rollback 0031_rls_default_deny --confirm roll_back_newest_migration`
(section 6). The shared guard and the restore refuse a target whose rows row security may hide from the connecting role (section 4.1),
and the dump refuses such a role (section 7), so a weakly privileged role is never read as an empty database or dumped as one.

### 2.3 The proposed application role (**PROPOSED**; nothing applied)

A login role that owns nothing and holds table-level `SELECT, INSERT, UPDATE, DELETE` on the `public` tables the server uses. Because
0031 denies every non-owner without a policy, that role needs one of two things, and the owner chooses (LB-14):

- `BYPASSRLS` on the role (one attribute; row security then guards only the Data API roles); or
- one policy per table naming the role (`CREATE POLICY ... TO sirkit_app USING (true) WITH CHECK (true)` on each of the 142 tables, and
  a write policy beside `project_members`' self-select) - a reviewed migration of its own, which the guard in
  `b24-a4-rls-default-deny` 6 would then have to admit by review.

Either way the server keeps one `DATABASE_URL` until the owner provisions the role; the owner of the tables stays the migration role.

### 2.4 The emulated Data API grants (**INFERRED**)

The B16-B disposable instance has no `anon` role and grants `authenticated` only `project_members` (`disposable-postgres.ts:28-41`), so
the counterexample uses a test-only emulation of the platform's documented default grants
(`app/lib/qualification/database/__tests__/_b24-a4-data-api.ts`): `anon` created, both API roles given schema usage and table-level
`SELECT, INSERT, UPDATE, DELETE` on every table in `public`. It is INFERRED from the platform's documentation; the real project's
grants and exposure are **UNKNOWN** (LB-14).

## 3. TLS for every non-loopback database URL (D24-3, OD-192; **CONFIRMED**)

`app/lib/db/connection-security.ts` (pure: it imports nothing and reads no environment) answers `databaseTls(url)` (`:87`):
`"require"` for any host but loopback; `undefined` for loopback (`localhost`, `127.0.0.0/8` in four decimal octets, `::1`) or a Unix
socket; the stronger mode the URL names kept and never downgraded (`verify-ca` and `verify-full` both answer `"verify-full"`:
postgres-js 3.4.9 has no CA-only mode - any mode string other than require/allow/prefer verifies the chain and the host name,
`node_modules/postgres/src/connection.js:283-286`). It refuses `DB_TLS_REQUIRED` for a non-loopback URL naming `disable`, `allow` or
`prefer`, and `DB_URL_MALFORMED` for a URL that does not parse, names no host, names an sslmode libpq does not define, names another
TLS parameter (`ssl`, `sslrootcert`), or holds an unencoded `@` before a host list. No refusal echoes the URL or any part of it
(`b24-a4-database-tls` 1: 43 rows).

The hosts are read as the driver reads them (`parse`, `:47`; review round, section 18): postgres-js 3.4.9 takes a host list after the
FIRST `@` when that text holds a comma (`node_modules/postgres/src/index.js:543, :557`), and otherwise the URL parser's host, after the
last `@` (`:438`). The two differ only when the credentials hold an unencoded `@` with a comma after it - `postgres://u@db.example,y@localhost/d`
was read as loopback here, while the driver would connect first to `db.example` with no TLS (**INFERRED** from the driver's code; no
connection was made) - and that URL is now refused. An
unencoded `@` with no host list stays accepted (both read the last `@`). `b24-a4-database-tls` 6 is a differential check: restating
the driver's pinned `parseUrl`/`parseOptions` lines, every host the driver would connect to for a URL the rule answers with no TLS is
loopback or no host name at all.

Why every site must pass it: postgres-js takes an explicit `ssl` option over the URL's own `sslmode` (`node_modules/postgres/src/
index.js:443, :474`), so the old `ssl: url.includes("supabase.") ? "require" : undefined` silently dropped a URL's `sslmode=require`
on every host but a `supabase.` one (case 2; **CONFIRMED** by reading the driver, the effect on a live server **INFERRED**).

Applied in place at the four sites and the fifth client (case 3's census: exactly these five files import `postgres` at run time under
`app`, `lib`, `components`, `scripts` and `e2e`, every `postgres(` call takes `ssl: databaseTls(<its own url>)`, and no
`includes("supabase.")` remains): `app/lib/db/client.ts:33` (one connection site, `b23-a-route-vocabulary.test.ts:68`; the import on
`:13`, so `:41` and the B21-D3 closure facts stay), `app/lib/db/migrations/postgres-executor.ts:32`,
`scripts/backfill-mpn-and-generics.ts:77`, `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts:198`, and
`app/lib/physical-binding/__tests__/schema-integrity.test.ts:18`, which set no TLS at all before. The guard's own connection goes through
the migration executor, so the rule covers it. Since the review round the census reads bindings from the syntax tree only and follows
every run-time form - a default or namespace import, `{ default as x }`, a whole-module or destructured `import("postgres")`, and
`require("postgres")` - and names any run-time reference it cannot follow (a re-export, a bare `import()`), so a sixth client cannot
drop out of it (case 7, planted files).

**The sixth client, drizzle-kit, is RECORDED as unsupported** (`b24-a4-database-tls` 4): drizzle-kit 0.31.10's postgres credential
schema keeps only `url` in its URL form and strips any other key (`node_modules/drizzle-kit/bin.cjs:11086-11092`), and connects with
`postgres.default(credentials2.url, { max: 1 })` (`:78952`; `pg` is not installed), so an `ssl` beside `url` in `drizzle.config.ts`
would be silently dropped. `drizzle.config.ts` is unchanged (`:10`, and `:14` as `b16-1b-membership-schema-parity.test.ts:99-100` pins
it): drizzle-kit's TLS is whatever the URL's own `sslmode` names. Certificate verification against the platform's own CA is not built
(LB-14).

## 4. The shared test-data guard (D24-12; OD-191, OD-201)

### 4.1 The guard (`app/lib/db/qualification-target.ts`; **CONFIRMED** on PGlite)

- `publicTablesHoldingRows(runner)` (`:45`): every `public` table holding a row, the migration ledger excepted, with its count - the
  strict predicate, exported on its own (the restore uses it alone).
- `requireDisposableQualificationTarget(executor, label, options)` (`:80`) accepts a target in two cases only: it already carries the
  claim marker - a row in `sirkit_qualification.claim`, a schema outside `public`, so `b16-b-postgres-qualification.test.ts:35-36` and
  every schema fingerprint are untouched - or no `public` table holds a row, and then it claims it. The claim runs in one transaction
  under `pg_advisory_xact_lock(hashtext('sirkit_qualification_claim'))` (`:82`) and re-reads the marker and the rows inside the lock; the
  claim row is a singleton (`ON CONFLICT DO NOTHING`), so an interleaved second claim adds nothing. Anything else is refused
  `DB_QUALIFICATION_TARGET_NOT_EMPTY` before any write, naming tables and counts, never a row or the URL - and so is a target whose rows
  row security may hide from the connecting role (`tablesRowSecurityMayHide`, `:57`: row security on, no superuser or `BYPASSRLS`, and
  another owner - or, since the review round, the role's own table with row security FORCEd), which a naive count would read as empty
  (`b24-a4-test-isolation` 10, 16).
- `requireNoPublicTable` (review round): a caller that migrates from nothing - `b16-b-postgres-qualification`, at both of its guard
  sites - passes it, and a target holding any `public` table is then refused inside the lock before the claim is read or written; a
  migrated but row-free target was claimed first and refused by the suite's own check afterwards, leaving a permanent claim (case 14).
- `claimQualificationTarget(url, label)` (`:101`) opens `createPostgresMigrationExecutor(url)` (imported lazily, so the restore's
  predicate reaches no network package), runs the guard and closes the connection; the TLS rule refuses a weak `sslmode` before any
  socket opens (case 9).
- It is reachable from no route, imports neither PGlite nor the disposable instance, and reads no environment variable itself.
- On PGlite (cases 5-10, 14, 16): it claims an empty migrated target and a bare one, the fingerprint unchanged; it accepts a claimed
  target that has since gained rows; it refuses an unclaimed non-empty target before any write, the fingerprint, the namespaces and the
  claim table unchanged; an interleaved claim leaves one claim row and no error, and the claim's advisory lock is read from `pg_locks`
  inside its transaction (case 8; the runner's key is not held there, and the lock is gone after it); its message carries no row and no
  URL; an owner without `BYPASSRLS` whose table is FORCEd is refused, and without FORCE the same owner reads its row.

### 4.2 The eight database-gated suites (**CONFIRMED** by source, default mode only)

The set is exactly eight files: the importers of `db/test-qualification` minus its contract suite and minus B24-A1's `b24-a1-flags`,
which imports the gate to pin its default and opens no database (`b24-a4-test-isolation` 1). Each awaits the guard before its first
database statement, read or write (case 2, on the syntax tree): `ingest-integrity.test.ts:33` (a separate async hook registered before
its synchronous publication, so `b16-b-database-qualification.test.ts:224-234` holds), `schema-integrity.test.ts:108`,
`tenant-scope.test.ts:18`, `app/api/pcb-sync/__tests__/route.test.ts:254`, `revalidation.test.ts:28`,
`electrical-identity-boundary.test.ts:143`, `pcb-sync-authority.test.tsx:80`, and `b16-b-postgres-qualification.test.ts:46, :75` (both
URLs, with `requireNoPublicTable` since the review round; on the existing lines, so `:78` stays). Every suite keeps
`databaseQualification()`, so `b16-b-database-qualification.test.ts:214-222` holds. A cleanup hook runs a database statement only once
the guard admitted the target: vitest 3.2.6 runs `afterAll` after a failed `beforeAll` (`@vitest/runner` `runSuite`), so
`schema-integrity`'s `afterAll` cleanup now sits under the `admitted` flag its guard hook sets after the guard's await (`:108`, `:111`),
and `b24-a4-test-isolation` 15 holds every `afterAll`/`afterEach` statement of the eight to that rule. In default mode (no marker) every
database case of the eight skips and nothing else fails (section 16).

### 4.3 `schema-integrity` scoped to its run (**CONFIRMED** by source; the live cases need the marker and did not run)

Every row it writes carries a run-unique tenant prefix (`runScopePrefix`, `_schema-integrity-scope.ts`): the aggregates through
`physicalBindingAggregate(suffix, <run>tenant-1)` (the builder moved there; its migration key carries the tenant, the table's primary
key), the cross-scope row's tenant (`<run>tenant-other`, was the raw `'tenant-other'`) and the two literal revision ids (`<run>cross-
scope-revision`, `<run>rollback-revision`). The cleanup moved to `app/lib/physical-binding/__tests__/_schema-integrity-scope.ts` and runs
in one transaction: first `physical_readiness_assessments` by the run's revisions (that table has no `tenant_id`,
`drizzle/0022_footprint_binding_stage01.sql:91-101`, no later ALTER), then the four other tables by prefix equality
(`left(tenant_id, length($1)) = $1`, never `LIKE`). The 19 UPDATEs, the count read and the two `INSERT ... SELECT ... LIMIT 1` sources are
scoped to the run's prefix or the run's own ids; the suite also clears its own rows after its last case, but only once the guard has
admitted the target (section 4.2; before the review round a refused target still met five scoped DELETEs from `afterAll`). The write census
(`b24-a4-test-isolation` 3) walks the eight suites and every `__tests__` helper they import (relative imports to depth 4, as
`startsPostgresVia` does, plus the `@/` alias) and finds no DELETE, UPDATE, TRUNCATE or DROP without a predicate over a bound value, and
no unscoped `INSERT ... SELECT`; it follows `_schema-integrity-scope.ts`, so moving the DELETEs there could not have turned it green by
relocation. A foreign aggregate with a readiness row survives the scoped cleanup, and the run's own rows are gone (case 11).

### 4.4 The acceptance driver (OD-201 narrowed; OD-226)

`scripts/e2e-prompt-to-gerber.ts:107-108` refuses to start unless it is invoked with `--disposable-target`, `SIRKIT_E2E_BASE_URL` is an
http(s) URL on loopback, and its own catalog read cannot reach a non-loopback database (the fixture runtime serves the catalog,
`parts-search.ts:137`, or the driver's `DATABASE_URL` is unset or loopback by `databaseTls`'s rule). The check is the pure
`acceptanceDriverRefusal` (`qualification-target.ts:134`); the driver passes the facts and exits 2 on a refusal, before its first request
(`:113`) and its catalog read (`:124`), which `b24-a4-test-isolation` 13 checks on the source text, never by importing it (importing the
driver runs it). No environment name is added. OD-201's default - the server reports the fixture runtime or a disposable marker - is
narrowed: no route reports it, and A4 adds none, so the server's own database stays the operator's responsibility (OD-226,
**BLOCKED-LIVE-QUALIFICATION**, LB-14). No `__tests__` file imports or spawns `scripts/db-migrate` or `scripts/e2e-prompt-to-gerber`
(case 4).

### 4.5 Recorded, not changed

- The live-auth matrix's isolation is a name prefix (`b16-1b-live-qualification.test.ts:27-28`); its only database write is a scoped
  canary (`:99-104`, `:204`; LB-1). **RECORDED**.
- Outside CI, local Playwright reuses a server already on its port (`playwright.config.ts:43`, `reuseExistingServer: !process.env.CI`),
  so a developer's own server and its database can serve a local browser run. **INFERRED**.

## 5. The qualification procedure, and the limit of the claim path (**RECORDED**)

For an opt-in real-server qualification (the owner's; never on the main project, OD-191):

1. Provision an EMPTY disposable database with the platform prerequisites (`vector`, the `authenticated` role, `auth.uid()`).
2. Claim it first: `claimQualificationTarget`, or the first database-gated suite run (`b16-b-postgres-qualification` claims it before it
   migrates). Then migrate it (`b16-b-postgres-qualification`, or `pnpm run db:migrate` against it).
3. Run the bounded footprint ingest that `ingest-integrity` needs, then `ingest-integrity` and the other gated suites. The claim, not
   emptiness, admits these runs and every re-run on the same database.

The limit: a re-run on a claimed target can still fail on the fixed-id collisions of the pcb-sync, electrical-identity and
assignment-revalidation suites (`EXECUTION_LEDGER.md:2500-2506`; the owner's queued fix, not in B24-A4). The guard keeps foreign data
out of reach; it does not make those suites re-runnable on one database.

## 6. Supported rollback (D24-2 offline, OD-193; **CONFIRMED** on PGlite)

The DOWN SQL lives in `drizzle/rollback/<name>.down.sql`, never inside the forward file: every byte of a forward migration is in its
checksum and every non-comment chunk runs forward (`manifest.ts:88-90, :93-99, :139`), so an executable DOWN inside 0027-0030 would run
on the way up and, once edited, be `DB_MIGRATION_CHECKSUM_DRIFT` (`runner.ts:133` at `3cd7d6e`) on every database that applied them -
the two 2026-09-24 databases included. `loadMigrationManifest` lists `.sql` files of `drizzle/` only (`manifest.ts:128`), so it never
reads the subdirectory (`b24-a4-rollback` 1: 32 entries, none from it). The rollback manifest (`app/lib/db/migrations/rollback.ts:54`)
binds each DOWN to its forward name and checksum and to its own checksum:

| Migration | Class | DOWN | Condition for rollback |
|---|---|---|---|
| `0031_rls_default_deny` | lossless | the same 143 tables, `DISABLE ROW LEVEL SECURITY`, reverse order | none |
| `0030_atomic_revision_status_events` | requires empty | `DROP INDEX IF EXISTS "atomic_status_event_successor_idx"; DROP INDEX IF EXISTS "atomic_status_event_revision_state_uniq"; DROP TABLE IF EXISTS "atomic_revision_status_events";` | `atomic_revision_status_events` holds no row |
| `0029_part_offers_mpn` | requires empty | `ALTER TABLE "part_offers" DROP COLUMN IF EXISTS "mpn";` | every `part_offers.mpn` is NULL |
| `0028_bom_project_ownership` | requires empty | `0028:63-72`, uncommented, unchanged | no `bom_snapshots` or `bom_notifications` row has an ownership column set |
| `0027_project_membership` | requires empty | `0027:58-62`, uncommented, unchanged | `project_members` holds no row |
| `0000`-`0026` | forward-only | none | rollback means restore (section 7) |

`rollbackNewestMigration` (`rollback.ts:160`) runs one transaction under the runner's own advisory lock and re-reads the ledger inside
it. Before touching anything it refuses: the runner's drift, unknown-row and gap refusals; `DB_ROLLBACK_NOT_NEWEST`;
`DB_ROLLBACK_FORWARD_ONLY`; `DB_ROLLBACK_BINDING_MISMATCH` (a forward checksum, a missing or edited DOWN file);
`DB_ROLLBACK_DATA_PRESENT` (the table and a count, never a row); and, unless it is a dry run, `DB_ROLLBACK_CONFIRMATION_REQUIRED`. It then
runs the DOWN and deletes the ledger row together, and verifies that the ledger is the manifest prefix without that entry before the
transaction commits. On PGlite: apply all, roll back 0031, re-apply - after the rollback the fingerprint equals a fresh database through
0030 and the emulated `anon` reads the seeded row again (the D24-3 state, on purpose), after the re-apply it is the clean fingerprint
and `anon` reads nothing (case 2); 0031 through 0027 rolled back newest-first equal the 0000-0026 fingerprint and re-applying reaches the
clean one (case 3); every refusal leaves the ledger and the fingerprint byte-identical, and since the review round each "requires
empty" check meets a row that matches it - a withdrawal event (0030), a stored exact MPN (0029), an owned BOM snapshot and an owned BOM
notification (0028), a membership (0027) - and, where a row may stay, one that does not (a NULL MPN, an unowned notification) (case 4);
an interruption at the 71st DOWN statement leaves no change and the re-run completes, and the DOWN runs under the runner's advisory lock,
read from `pg_locks` inside the transaction (case 5); a dry run plans only (case 6).

The CLI: `pnpm run db:migrate -- --rollback <name> --confirm roll_back_newest_migration [--dry-run]`. The operator types the
confirmation (`--baseline`, by contrast, passes its own, `db-migrate.ts:79` at `3cd7d6e`, now `:89`); `--rollback` with `--baseline` or
`--status` refuses; `--confirm` without `--rollback` refuses; an unknown flag or a stray word now refuses instead of falling through to
an apply. The arguments are parsed by `app/lib/db/migrations/cli-arguments.ts` (`parseMigrateArguments`, side-effect free) before
`.env.local` is loaded or anything connects (`db-migrate.ts:58`, `:61`); the suite imports that module only (case 7). Refusals print
with the CLI's existing redaction (`db-migrate.ts:32-44` at `3cd7d6e`). A real-server rollback is **BLOCKED-LIVE-QUALIFICATION** (LB-14).

## 7. Logical dump and restore (D24-7 offline, OD-194; **CONFIRMED** on PGlite)

`app/lib/db/recovery/logical-dump.ts` works over a `MigrationStatementRunner`, imports no network package and no PGlite, is reachable
from no route and has no CLI. Why not `pg_dump`: no dump tool ships with the dependencies (`@electric-sql/pglite` 0.4.6, `postgres`
^3.4.9) and OD-42 forbids adding one.

- **The dump** (`sirkit.db-logical-dump.v1`, `createLogicalDump`, `:82`): the schema fingerprint; the ledger (name and checksum); the
  session settings that shape the rows' text (TimeZone, DateStyle, IntervalStyle, bytea_output, extra_float_digits); and for each of the
  143 `public` tables its row count, the SHA-256 of its rows and the rows as the database's own JSON text (`row_to_json(t)::text`), ordered
  by the primary key's columns as text under `COLLATE "C"` where the table has one (101 tables) and by the row text under `COLLATE "C"`
  otherwise (42 tables, `architecture_candidates` among them). No row value passes through a JavaScript number: a 19-significant-digit
  JSON number survives as written (`b24-a4-restore` 2). Since the review round, a role that row security may hide rows from is refused
  `DB_DUMP_ROWS_HIDDEN` (`DumpRefusal`, `:174`) before any row is read: after 0031 a SELECT-only role without `BYPASSRLS` dumped
  `{"ledger":0,"tables":143,"rows":0}` - a dump that looked valid and held nothing, found only at restore time - and an owner of every
  table without `BYPASSRLS` with one table FORCEd dumped that table empty (`{"ledger":32,"tables":143,"rows":0}` for a database holding one
  row) (case 6).
- **The restore** (`restoreLogicalDump`, `:128`): `DB_RESTORE_TARGET_NOT_EMPTY` unless `publicTablesHoldingRows` is empty (the claim
  marker is never a reason to accept a target: a claimed target holding one row is refused before any write); `DB_RESTORE_SCHEMA_MISMATCH`
  unless the dump's ledger is a prefix of the manifest and the target's ledger a prefix of the dump's; then it migrates the target through
  exactly the dump's ledger and requires the dump's fingerprint and tables; it loads every table in foreign-key order in ONE transaction,
  the deferrable keys deferred (`json_populate_recordset`, 500 rows a statement), the session settings set locally; and it verifies the
  fingerprint, the counts and the digests, refusing `DB_RESTORE_DIGEST_MISMATCH` - before any write when the envelope already shows the
  mismatch (a row changed without its digest, a count that disagrees), otherwise by rolling the load back (an equivalent but
  differently spaced row text whose digest was recomputed: loaded, re-dumped, refused, no row left).
- **The fixture** (9.4): an active and a revoked membership, an owned BOM snapshot, one physical-binding aggregate, one
  `mfg.provider-exchange.v1` attempt settled through B23's in-process fakes (`_b23-b2-fake-provider.ts`, `_b23-b-release-fixture.ts`; no
  provider was contacted), and one `computation.evidence.v1` record appended through
  `createComputationEvidenceStore(new PostgresDurableWorkflowRepository())`. It round-trips into a bare target and into a migrated empty
  one with an equal fingerprint, ledger, counts and digests (case 1), and both aggregates load on the copy through their own verifying
  stores with the same digests (`evidence-store.ts:220-229, :264`; `exchange-ledger.ts:114, :303`), the memberships through the Postgres
  membership repository (case 3).

## 8. The recovery runbook

Offline, in this repository (**CONFIRMED** on PGlite only):

1. Dump: `createLogicalDump(runner)` over a connection to the source (the dump is a JSON-serialisable envelope), connected as the
   tables' owner with no table FORCEd, or as a `BYPASSRLS` role: any other role is refused `DB_DUMP_ROWS_HIDDEN` before a row is read,
   because after 0031 row security would hand it an empty ledger and empty tables.
2. Provision an empty target with the platform prerequisites; restore with `restoreLogicalDump(executor, dump, { manifest })`, connected
   as the tables' owner with no table FORCEd, or a `BYPASSRLS` role (a role row security may hide rows from is refused).
3. The restore verifies itself (fingerprint, ledger, counts, digests) and rolls back on any mismatch.

The owner's steps (**BLOCKED-LIVE-QUALIFICATION**, LB-14; never run by the builder):

- `pg_dump --format=custom` of the source and `pg_restore` into a fresh project, then `pnpm run db:migrate -- --status` (no pending, no
  drift) and a logical dump of both compared by digest;
- the platform's own backups: the schedule, the retention and the point-in-time recovery window are the plan's (discovery section 8 item
  4, **UNKNOWN**), and a restore drill into an isolated project is the only evidence that they work;
- failover and a read replica: none exists in the code (one client, `client.ts:29-46`); the platform's offering is the owner's to choose.

A rollback of a forward-only migration (0000-0026), or of a "requires empty" one holding data, is a restore.

## 9. A lost connection fails closed (D24-7, D24-3; **CONFIRMED** on PGlite)

The fault: `getDb` is replaced by a fault-injecting double over PGlite (the B23 PGlite suite's `db/client` mock,
`b23-b-exchange-ledger-pglite.test.ts:31`) whose queries fail with a connection error.

- **The membership read - the observed answer, recorded before any edit.** With the PostgreSQL membership repository bound
  (`setMembershipRepositoryFactory`) and every query failing, `resolveTrustedRequestContext` (`trusted-request-context.ts:57`) rejects
  with drizzle's `DrizzleQueryError` - `Failed query: select "membership_id", ... from "project_members" where ... limit $4` followed by
  `params:` and the tenant, project and user ids - whose cause is the lost connection (it awaits the read uncaught, `:104`;
  `postgres-membership.ts:17-25` has no catch). It never yields a context; through `authenticatedRoute`, the request's promise rejects
  and the handler never runs, so no Sirkit body is built (`b24-a4-restore` 5a). No context, no 2xx, and no driver message or URL in a
  body: fail closed. **INFERRED**: Next answers an uncaught route error with its own 500 and logs the error - the query and its
  parameters (identifiers, never the URL or a credential) - on the server; that log line is recorded in section 12.
- **A durable append.** An exchange record's `prepare` and an evidence append, each losing the connection after the first statement of
  its commit transaction, leave no head, record or replay row when read through a healthy connection; each retried append then writes
  exactly once (a third call replays) (case 5b).
- Real reconnection, failover and a replica remain **BLOCKED-LIVE-QUALIFICATION** (LB-14); none is claimed.

## 10. The 2026-09-24 run

The owner authorised the main Supabase project for live tests on 2026-09-24 (`EXECUTION_LEDGER.md:2490-2509`): two empty disposable
databases on its server, the nine database-gated suites run there. It is recorded as "real-server qualification on a non-isolated
project" (OD-191), not as staging: the project may hold production data (discovery section 8 item 2, **UNKNOWN**), and B24 treats it as
production - no B24 test, script or run touches it.

## 11. Live: BLOCKED-LIVE-QUALIFICATION (LB-14)

Every item below needs the owner's resource - an isolated, disposable project, or the staging or production project's settings,
grants and backup plan - and is never faked:

- the Data API's exposure of `public` and the project's real grants (section 2.4);
- the real roles and their attributes: which role `DATABASE_URL` names, whether it owns the tables or has `BYPASSRLS` (0031's pre-apply
  step, section 2.2), and the application role (section 2.3);
- certificate verification against the platform's CA (section 3);
- the backup schedule and the point-in-time recovery window (section 8);
- failover, a replica and real reconnection (section 9);
- a real-server rollback and a real-server restore (sections 6-8);
- the server's own database behind the acceptance driver (section 4.4).

## 12. What stays open (**INFERRED**, low)

- A failed membership read reaches the server log as drizzle's error text, with the tenant, project and user ids as parameters
  (section 9). No URL or credential is in it and no body carries it; whether the hosting platform's log retention suits ids is the
  owner's (LB-13, LB-14).
- `verify-ca` is enforced as `verify-full` (section 3): a server whose certificate does not name its host would be refused where libpq
  would connect. No such URL is configured in the repository.
- The guard, the dump and the restore count rows table by table under the connecting role. A role without superuser or `BYPASSRLS` is
  refused wherever row security is on for a table it does not own, or FORCEd on one it does (section 4.1; the FORCE half since the
  review round). The owner test compares the table's owner with the role itself, so a role that holds the owner's privileges only by
  membership is refused too: conservative, never an empty read. A role that owns some tables and not others is refused as well.
- The migration guard (`b24-a4-rls-default-deny` 6) reads statements and literals; it does not evaluate SQL, so dynamic SQL that builds
  a role statement by concatenation (`EXECUTE 'GR' || 'ANT ...'`) is beyond it. It is a review guard over reviewed files, not a parser.
- A single-host URL naming a Unix socket directory percent-encoded (`postgres://u@%2Fvar%2Frun%2Fpostgresql/d`) is answered with no TLS,
  but postgres-js 3.4.9 takes that host from the URL parser undecoded and so treats it as a host name, not a socket (it also splits each
  host on `:`, so `[::1]` becomes `[`); such a URL reaches no host at all. **INFERRED** from the driver's `parseUrl`/`parseOptions`
  (`node_modules/postgres/src/index.js:438, :466-468`); `b24-a4-database-tls` 6 counts a name holding `%` or brackets as no host.

## 13. Superseded statements, handed to B24-F

Each is left as written by A4 (Lead note 1) and handed to B24-F for its one table at closeout commit 1/2:

- `drizzle/0027_project_membership.sql:7`, the header's "Rollback: see the DOWN section at the bottom of this file" - superseded by
  `drizzle/rollback/0027_project_membership.down.sql` and `--rollback`;
- the commented DOWN sections at `drizzle/0027_project_membership.sql:57` and `drizzle/0028_bom_project_ownership.sql:62` - superseded as
  the rollback path by `drizzle/rollback/` and `--rollback`;
- `drizzle/0028_bom_project_ownership.sql:3`, `drizzle/0029_part_offers_mpn.sql:3` and `drizzle/0030_atomic_revision_status_events.sql:3`
  ("FORWARD-ONLY") - each now has a reviewed DOWN of class "requires empty";
- `artifacts/ai-control-plane-b16-0/migration-and-rollback.md:29-30` ("Rollback SQL is in the file's DOWN section") - superseded by
  `drizzle/rollback/0027_project_membership.down.sql` and `--rollback`;
- `artifacts/ai-control-plane-b16-closeout/migration-delivery-contract.md:43`, the command list (apply, dry run, status, baseline) - A4
  adds `--rollback <name> --confirm <typed> [--dry-run]` (section 6); the contract page is left as written.

## 14. Test-first record (**CONFIRMED**)

- Pre-edit counterexamples: section 1 (`b24/logs/a4-preedit.log`, 3 failed of 3 as designed).
- A4a red on `3cd7d6e` (the three new suites only): `b24-a4-database-tls` and `b24-a4-test-isolation` failed to load (no
  `connection-security`, no `qualification-target`); `b24-a4-rls-default-deny` 7 failed, 1 passed (the `project_members` self-select, a
  guard). That run's guard case also read 0031; the case was then split: the guard (case 6) reads `.sql` files only and is green over
  0000-0030, which are byte-identical to `3cd7d6e`, and the planted variant moved to case 9. A4a green: 3 files, 27 tests; then 21 files
  passed and 3 skipped, 158 tests passed and 15 skipped over `app/lib/db`, the eight gated suites, `app/lib/physical-binding/__tests__`,
  `b19-e-ci-job-scope` and the new suites.
- A4b red after A4a's green run, before A4b's code (`rollback.ts`, `cli-arguments.ts`, `logical-dump.ts`, the DOWN files absent): 13 failed
  of 13 - every rollback and restore case on its missing module; the two connection-loss cases on their first expectation only, which
  spelled the bare connection error where drizzle wraps it (the observed answer, section 9, recorded and adopted). A4b green: 2 files, 13
  tests.
- Review round (2026-10-08, section 18): the strengthened and new cases ran first on the unfixed tree - 9 failed of 46 over the five
  suites (`b24/logs/a4fix-red-1.log`): `b24-a4-database-tls` 1 (the two `@`-before-a-host-list URLs answered `undefined`), 3 (the old
  census read a binding from an initializer's text, so this suite's own planted strings made it a sixth importer), 6 (the driver would
  reach `db.internal.example` and `t`) and 7 (the census missed the namespace, destructured, required, re-exported and bare forms);
  `b24-a4-rls-default-deny` 9 (the DO-block `CREATE ROLE` of `_b24-a4-data-api.ts` gave no hit); `b24-a4-test-isolation` 14 (`claimed`),
  15 (`schema-integrity.test.ts:111 clearRun()`) and 16 (`claimed`); `b24-a4-restore` 6 (`{"code":"dumped","ledger":0,"tables":143,
  "rows":0}`, `a4fix-red-2-restore6.log`). The `b24-a4-rollback` 4 and 5 and `b24-a4-test-isolation` 8 strengthenings were green on the
  unfixed code - the code was right and the tests were weak - so each was proven against a deliberate breakage of the source, restored
  byte-for-byte and checked by sha256 (`rollback.ts` `a956f7c3...`, `qualification-target.ts` `63cca4f1...`): 0030's check set to
  `false`, 0029's to `mpn IS NULL` and to `true`, and `bom_notifications`' to `false` (case 4 red at its own assertion each time,
  `a4fix-break-1..4`); both advisory locks removed (rollback 5: `[false]` for `[true]`; isolation 8: `[false, false]` for `[true, false]`,
  `a4fix-break-5b`); the FORCE clause removed (isolation 16 `claimed`; restore 6, the owner's dump `{"code":"dumped","ledger":32,
  "tables":143,"rows":0}`, `a4fix-break-6`). After the fixes: 7 files passed and 1 skipped, 73 tests passed and 9 skipped over the five
  suites, `schema-integrity`, `b16-b-postgres-qualification` and `b16-b-database-qualification` (`a4fix-green-1.log`).

## 15. Pins moved, and why (each in place, with a dated `[B24-A4, 2026-10-08] reviewed pin move` note)

- 0031: `app/lib/db/__tests__/b16-b-migrations.test.ts:39, :40, :41, :42, :104, :119, :147, :152, :176, :190, :229, :244, :246` (the
  migration count 31 -> 32 at `:39`) and `b16-b-postgres-qualification.test.ts:78`.
- The workflow: four database-delivery entries at `deterministic-manufacturing.yml:303-306`, after B23's PGlite entry (`:302`, unmoved);
  one row appended to `environments-and-deployment.md` section 10's insertion table (`| [B24-A4, 2026-10-08] | database-delivery |
  `:303` | 4 |`); B21's C49, C93 and C94 moved +4 (`:334` -> `:338`, `:337` -> `:341`, `:346` -> `:350`) in
  `evaluation-matrix.md`. B23's C64 and its prose citation of the PGlite entry do not move (A4 appends after `:302`).
- Not moved: `b16-b-schema-parity.test.ts:61, :104-107`; `b16-1b-membership-schema-parity.test.ts:99-100`;
  `b16-b-database-qualification.test.ts:37-45, :156-161, :214-234`; `b23-a-route-vocabulary.test.ts:68`; `b21-d3-pin-facts.test.ts:136,
  :140`; `b23-a-provider-admission` case 8 (A4's provider-naming files are under the admitted `app/lib/qualification/`); `.env.example`;
  the census and the tool counts.

## 16. Gates (2026-10-08; **CONFIRMED**)

Every row below is the review round's re-run over the final tree (`b24/logs/a4fix-*`); the first round's counts are kept in brackets.

| gate | result |
|---|---|
| the five new suites | 5 files, 46 tests passed (TLS 7, row security 9, isolation 16, rollback 7, restore 7), inside the next two rows' runs [first round: 40] |
| `app/lib/db`, the eight gated suites by file (default mode), `app/lib/physical-binding/__tests__`, `app/lib/durable-workflow/__tests__`, `app/lib/auth/__tests__`, `b19-e-ci-job-scope`, the new suites | 66 files passed, 3 skipped; 666 tests passed, 24 skipped (every database case of the eight skips; nothing else fails) [660 passed] |
| the database-delivery list exactly as the workflow names it (18 filters) | 20 files passed, 3 skipped; 179 tests passed, 12 skipped; 93.41 s (95 s wall, two workers); A4's four files 88.0 s of file time [175 passed; 86.13 s; a first-round run failed one case of `b16-b-database-qualification` because `b24-a4-rollback` spelled the env loader as a call - fixed, then green] |
| `app/lib/manufacturing-providers/__tests__`, `.../database/__tests__`, `app/lib/computation/__tests__`, `app/lib/agent/orchestration/__tests__` | 105 files passed, 2 skipped; 1,152 tests passed, 18 skipped |
| `app/api/__tests__`, `app/lib/qualification/__tests__` (the B24-A1..A3 suites and A4's TLS suite), B11.5 capture exactness, the B20 import and process gates, B14.1-B14.3, B15.2 | 56 files, 1,362 tests passed [1,360] |
| B14.4 AST import gates (alone) | 22 passed, 18.2 s |
| the workflow's readers before and after the workflow edit (`b24-a1-environment-profile`, `b21-f-page`, `b24-a2-headers`, `b24-a2-secret-scan`, `b22-a1-page`, `b23-b-dfm-quote-flow-page`; after: + `b19-e-ci-job-scope`) | first round: before 6 files, 86 tests; after 7 files, 100 tests (the review round did not touch the workflow; all seven are inside the rows above) |
| the B21, B22 and B23 closeout-statement tripwires, `b21-f-page` and `b24-a1-environment-profile`, over this page as it stands | 5 files, 66 tests passed |
| tsc (`--noEmit -p tsconfig.json`) | exit 0 (the review round's first run failed TS7022 on one unannotated loop variable in the new isolation code; annotated, then exit 0) |
| eslint over the 30 changed and new TypeScript files | exit 0, 0 errors, 1 warning (`e2e-prompt-to-gerber.ts:25`, an unused import that predates A4) |
| the secret scan (tree mode, untracked files included) | exit 0, 4,063 entries, 8 allowlisted lines [4,062] |
| the 21 generators | each exit 0, no drift: the tree's status and diff hash identical before and after |
| `drizzle-kit export` (spawned by `b16-b-schema-parity`) | green, 30 recorded differences unchanged (`onlyInPush=6 onlyInMigrations=16 changed=8`) |

Database-delivery's limit is `timeout-minutes: 15` (`deterministic-manufacturing.yml:275`). Locally the list takes 95 s; CI's runner is
slower (INFERRED: twice as long would still leave the job well under its limit).

## 17. Suites

| suite | `it(` | what it proves |
|---|---|---|
| `app/lib/qualification/__tests__/b24-a4-database-tls.test.ts` | 7 | the TLS rule's table, why every site passes it, the five-file census, the recorded sixth client, the module's purity; the driver-host oracle and the planted census (review round) |
| `app/lib/qualification/database/__tests__/b24-a4-rls-default-deny.test.ts` | 9 | 0031 on PGlite: the census, the emulated Data API roles, the self-select, the owner and its FORCE control, `.enableRLS()`, the guard over `drizzle/`, 0031's header, `verifyDefaultDenyRls`, planted role and grant forms (widened in the review round) |
| `app/lib/qualification/database/__tests__/b24-a4-test-isolation.test.ts` | 16 | the eight gated suites, guard-first, the write census, no script import, the guard on PGlite (with its lock), the scoped cleanup, the driver's refusal and call order; `requireNoPublicTable`, the cleanup-hook rule and the FORCEd owner (review round) |
| `app/lib/qualification/database/__tests__/b24-a4-rollback.test.ts` | 7 | the rollback manifest, apply/rollback/re-apply, 0031-0027, every refusal (each "requires empty" check against a matching row since the review round), an interruption under the runner's lock, a dry run, the CLI arguments |
| `app/lib/qualification/database/__tests__/b24-a4-restore.test.ts` | 7 | the dump and restore round trip, the row-order rule, both aggregates on the copy, the refusals, a lost connection; a dump that row security would empty (review round) |

## 18. Review round (2026-10-08; **CONFIRMED**)

An adversarial review confirmed ten findings, two of them one defect seen from two lenses; each was fixed test-first (section 14):

| finding | what was wrong | the fix | the proof |
|---|---|---|---|
| correctness-1 (low) | 0030's and 0029's `DB_ROLLBACK_DATA_PRESENT` checks and the `bom_notifications` half of 0028's were never run against a matching row; changing any predicate left every suite green | none in the code (the predicates were right); the test now seeds each matching row, and a non-matching one where it may stay | `b24-a4-rollback` 4, red against four deliberate predicate breakages |
| correctness-2 (low) | the migration guard matched GRANT/REVOKE/CREATE ROLE only at a statement's start, after blanking literals by pattern: a DO block, `EXECUTE '...'`, `CREATE USER`, `ALTER DEFAULT PRIVILEGES`, a block comment or an inline apostrophe slipped past | the guard tokenises comments and literals and matches role and privilege forms anywhere in a statement, and in the literals of dynamic SQL | `b24-a4-rls-default-deny` 9 (12 planted forms refused, 5 harmless ones not); 6 still green over every file under `drizzle/` |
| correctness-3 (low) | `b16-b-postgres-qualification` claimed a migrated but row-free target, then refused it in its own check, leaving a permanent claim | `requireNoPublicTable`: the guard refuses a target holding any `public` table inside its lock, before the claim; the suite passes it at both sites | `b24-a4-test-isolation` 14 |
| correctness-4 (low) | after a refused guard, vitest still ran `schema-integrity`'s `afterAll`, whose cleanup ran five DELETEs on the refused target | the cleanup runs only under the `admitted` flag set after the guard's await | `b24-a4-test-isolation` 15, a rule over every `afterAll`/`afterEach` of the eight |
| correctness-6 and security-6 (low) | `databaseTls` read the hosts after the last `@`; postgres-js reads a host list after the first, so an unencoded `@` and a comma in the credentials could reach a remote host with no TLS | such a URL is refused `DB_URL_MALFORMED`; the reading is the driver's otherwise | `b24-a4-database-tls` 1 (five new rows) and 6 (a differential oracle over the driver's pinned lines) |
| correctness-8 (low) | the TLS census dropped a namespace import and a destructured dynamic import, so a sixth client could leave it | the census reads bindings from the syntax tree, follows every run-time form and names what it cannot follow | `b24-a4-database-tls` 3 and 7 (ten planted files) |
| correctness-9 (low) | no test showed the claim's or the rollback's advisory lock; removing either left every suite green | none in the code; each seam now reads the lock from `pg_locks` inside the transaction | `b24-a4-test-isolation` 8 and `b24-a4-rollback` 5, red with both locks removed |
| security-1 (medium) | after 0031 a dump by a SELECT-only role without `BYPASSRLS` succeeded with an empty ledger and empty tables - a backup that looked valid and held nothing | `createLogicalDump` refuses `DB_DUMP_ROWS_HIDDEN` before any row is read; the runbook names the dump's role | `b24-a4-restore` 6 |
| security-3 (low) | the hidden-rows check ignored FORCE, so an owner without `BYPASSRLS` could count a FORCEd table as empty and claim, restore into or dump the target | a FORCEd table counts as hidden from its own owner without `BYPASSRLS` | `b24-a4-test-isolation` 16 and `b24-a4-restore` 6, red with the clause removed |

The review round added no route, tool, environment name, migration or dependency, and moved no pin: the census stays 168 / 165 / 3 / 0,
the tool counts 47 / 36 / 9 / 27 and the migration count 32. The new refusal codes are `DB_DUMP_ROWS_HIDDEN` and, under
`DB_URL_MALFORMED`, the unencoded `@` before a host list; `requireNoPublicTable` is an option of the guard, not a new export.
