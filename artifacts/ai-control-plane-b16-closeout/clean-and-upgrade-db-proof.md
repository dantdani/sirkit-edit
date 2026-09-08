# B16-B — Clean-database and upgrade-database proof

Labels: CONFIRMED = observed by running the named test on this machine on 2026-09-07 (and in CI once the chapter PR runs); RECORDED = read from source; INFERRED; UNKNOWN; BLOCKED-LIVE-QUALIFICATION.

## Instance under test

- **Default suite (deterministic, no live database):** PGlite `@electric-sql/pglite@0.4.6` — PostgreSQL 17.5 compiled to WASM, in-process, single superuser session — with extensions `vector`, `pg_trgm`, `pgcrypto` loaded and the documented platform shims (`CREATE EXTENSION vector`; schema `auth` + `auth.uid()` reading `request.jwt.claim.sub`; role `authenticated`). Harness: `app/lib/db/__tests__/pglite-harness.ts`.
- **Real server (opt-in):** `app/lib/db/__tests__/b16-b-postgres-qualification.test.ts` behind `SIRKIT_DB_QUALIFICATION=1` + `SIRKIT_DB_QUALIFICATION_URL`, scratch schema per run, dropped CASCADE afterwards. Status on this machine: **BLOCKED-LIVE-QUALIFICATION** — no disposable PostgreSQL was reachable (Docker Desktop 4.67 fails at engine start with an internal "Inference manager" socket error; the `.env.local` Supabase project no longer resolves; LB-4/LB-6). The gate was proven to open: with the marker set to an unreachable server the suite RUNS and fails with `connect ECONNREFUSED` (CONFIRMED); without the marker it is SKIPPED with the reason logged (CONFIRMED).

## Clean database (CONFIRMED — `b16-b-migrations.test.ts` › "a clean database receives every migration in one run")

| Observation | Value |
|---|---|
| Migrations applied | 29 (`0000`…`0028`), all in one `migrateDatabase` run |
| Statement chunks | 465 (from the feasibility probe; the ledger stores per-file counts) |
| Wall clock | ≈0.5 s for all 29 files in-process |
| Ledger rows | 29, `runner_version = sirkit.db-migration-runner.v1`, every `statement_count > 0` |
| Public tables | > 100 (142 in the probe), `sirkit_schema_migrations` excluded from every fingerprint |
| `project_members.relrowsecurity` | `true` |
| Prerequisite report on a BARE instance (no shims) | refused `DB_MIGRATION_PREREQUISITE_MISSING`; `checkMigrationPrerequisites` = `extension:vector, role:authenticated, function:auth.uid` — nothing created silently |

## Upgrade from the last supported schema (CONFIRMED — "upgrading from the last journal-covered schema (0000–0026) reaches EXACTLY the clean-database fingerprint")

1. A second instance is migrated with the manifest truncated to the 27 journaled entries (`0000`–`0026`) — this is the schema every pre-B16.0 database has: no `project_members`, no BOM ownership columns (asserted absent).
2. `migrateDatabase` with the full manifest applies exactly `0027_project_membership`, `0028_bom_project_ownership` and skips 27.
3. `schemaFingerprint(captureSchemaSnapshot(upgraded)) === schemaFingerprint(captureSchemaSnapshot(clean))` — the fingerprint canonicalizes tables (+RLS flags), columns (type/nullability/default), constraints (`pg_get_constraintdef`), index definitions, policies and extensions with code-point ordering (host-independent, F8 discipline).

## Replay, drift, interruption, races (CONFIRMED — same file)

| Scenario | Result |
|---|---|
| Second run on a migrated database | `applied = []`, `skipped` = all 29, ledger byte-identical; `migrationStatus` → pending 0 / drift 0 / unknown 0 / gap false |
| `0027` edited after it was applied (checksum drift) | refused `DB_MIGRATION_CHECKSUM_DRIFT` BEFORE `0028` runs; ledger still 28 rows; `bom_snapshots.tenant_id` absent |
| Outage after the first of the two chunks of `0026` (inside its transaction) | run rejects with the injected error; `parts_atomic_links` does NOT exist (rolled back); no `0026` ledger row; `pending = [0026, 0027, 0028]`; the re-run applies exactly those three and the table exists |
| Another instance completes `0028` while this instance applies `0027` | the `0028` transaction re-reads the ledger inside the advisory lock: `skipped` contains `0028`, `applied = [0027]`, pending 0 — never a double apply |
| A ledger row the manifest does not know (`9999_…`) | refused `DB_MIGRATION_LEDGER_UNKNOWN` |
| A hole in the applied prefix (`0002` deleted from the ledger) | refused `DB_MIGRATION_LEDGER_GAP` |
| `--dry-run` | plans, creates nothing (0 tables) |

## Documented command against a clean instance (CONFIRMED — `b16-b-schema-parity.test.ts`)

`drizzle-kit push` cannot be pointed at PGlite with pgvector loaded, so the push path is reproduced through `drizzle-kit export` (the exact DDL push would emit for `schema.ts`) applied in dependency order to a disposable instance. Findings: the DDL contains no `CREATE EXTENSION` (push needs `vector` and `pg_trgm` pre-enabled); both paths satisfy every membership/ownership/RLS criterion; the two schemas differ in 30 objects (16 migration-only constraints/indexes, 6 push-only drizzle-named equivalents, 8 changed definitions — six `DEFERRABLE INITIALLY DEFERRED` binding FKs and two owner-index NULLS orderings). Full list in `migration-delivery-contract.md` §4. `db:push` is refused as a delivery path; `db:migrate` is the supported one.

## What is NOT claimed

- No live Supabase or Docker PostgreSQL executed these migrations in this checkpoint (blocked above); the real-server suite is committed, gated and proven to open, but its pass is UNKNOWN until an owner supplies a disposable server.
- PGlite is a single-user superuser session: concurrency is simulated through the runner's own transaction (the lock re-check path), not with two OS connections.
