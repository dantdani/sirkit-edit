# B16-B — Migration delivery contract

Labels: CONFIRMED (observed in this checkpoint, reproducible by the named test or command) · RECORDED (read from source/artifacts) · INFERRED · UNKNOWN · BLOCKED-LIVE-QUALIFICATION.

## 1. Audit of the Drizzle journal and migration files (CONFIRMED)

| Fact | Evidence |
|---|---|
| `drizzle/` holds 29 SQL migrations, `0000`–`0028` | `ls drizzle/*.sql` |
| `drizzle/meta/_journal.json` (version 7, postgresql) registers **27** entries, `0000`–`0026` | `b16-b-migrations.test.ts` › manifest |
| `0027_project_membership.sql` and `0028_bom_project_ownership.sql` are **not journaled**; snapshots exist only for `0000`–`0008` | `ls drizzle/meta`; no `0027`/`0028` tag in the journal |
| No `db:migrate` command existed; no `__drizzle_migrations` table was ever created by any Sirkit tooling | `package.json` at `62ea4a6` (`db:generate`, `db:push` only); grep of `app/lib`/`scripts` |
| The documented clean-database path was `pnpm run db:push` (`drizzle-kit push` from `schema.ts`) | `drizzle.config.ts`, `schema.ts` comment at `project_members` |
| The migrations assume platform-provisioned objects they never create: the `vector` extension (`0000` declares `vector(1536)` + an hnsw index), the `authenticated` role and `auth.uid()` (`0027`'s policy) | first probe on a bare PostgreSQL: `type "vector" does not exist`; `checkMigrationPrerequisites` reports `extension:vector, role:authenticated, function:auth.uid` |
| The schema-first path emits **no** `CREATE EXTENSION` at all: `db:push` on a clean server needs `vector` **and** `pg_trgm` pre-enabled (the migrations create `pg_trgm` in `0005` and `pgcrypto` in `0024`) | `b16-b-schema-parity.test.ts` (`/CREATE EXTENSION/` absent from `drizzle-kit export`; `gin_trgm_ops does not exist` when applied bare) |

## 2. What a clean database receives (CONFIRMED on a disposable PostgreSQL 17.5)

Reproduced with `b16-b-rls-membership.test.ts` › "every runbook criterion holds against the catalog": after `migrateDatabase` every criterion below is evaluated against `pg_catalog` / `information_schema`, never against TypeScript:

- `project_members` table, 10 columns all `NOT NULL`, CHECKs `project_members_role_check` (five roles), `_state_check` (`active`/`revoked`), `_version_check` (`> 0`), `_identity_check` (no blank identity), unique index `(tenant_id, project_id, user_id)`, lookup index `(tenant_id, project_id, user_id, state)`;
- `relrowsecurity = true` on `project_members`; exactly one policy `project_members_self_select` — `SELECT`, `TO authenticated`, `USING (state = 'active' AND user_id = (select auth.uid())::text)`; **no** INSERT/UPDATE/DELETE policy;
- `bom_snapshots` / `bom_notifications` ownership columns `tenant_id`, `project_id`, `branch_id` (nullable by design: legacy rows quarantined), `*_ownership_complete_check` with explicit `IS NOT NULL` disjuncts, owner indexes `(tenant_id, project_id, branch_id, taken_at|created_at DESC)`;
- no policy grants cross-tenant or cross-project access: every policy predicate is bound to `auth.uid()` (there is exactly one policy in the schema).

Three-valued behaviour (CONFIRMED by inserts): fully-NULL and fully-owned BOM rows are accepted; `('t', NULL, NULL)`, `('t','p',NULL)`, `(NULL,'p','b')` and `('t','p','  ')` are refused by `bom_snapshots_ownership_complete_check` (the `IS NOT NULL` terms make the second disjunct FALSE instead of UNKNOWN — the B16.0.3 R4 closure is executable, not only declared).

## 3. The supported mechanism (CONFIRMED)

`pnpm run db:migrate` (`scripts/db-migrate.ts` → `app/lib/db/migrations/`):

| Property | How |
|---|---|
| One ordered manifest | `loadMigrationManifest`: the journal's 27 entries in journal order + `REGISTERED_POST_JOURNAL_MIGRATIONS = [0027, 0028]` (a reviewed list in code). Refuses an unregistered `.sql`, a missing file, a duplicate, a non-ascending ordinal. No Drizzle metadata is invented: journal and snapshots are read, never written. |
| Transactional ledger | `sirkit_schema_migrations(name PK, checksum, applied_at, statement_count, runner_version)`; every statement chunk of a file **and** its ledger row commit in ONE transaction; a transaction-scoped advisory lock serializes runners; the ledger is re-read inside the lock so a racing instance turns into a verified skip. |
| Idempotent replay | second run: 0 applied, ledger byte-identical (test "replay is idempotent"). |
| Checksum drift refused | `sha256` of the LF-normalized file; a mismatch refuses the WHOLE run before touching anything (`DB_MIGRATION_CHECKSUM_DRIFT`). Unknown ledger rows (`DB_MIGRATION_LEDGER_UNKNOWN`) and holes in the applied prefix (`DB_MIGRATION_LEDGER_GAP`) are refused too. |
| Prerequisites reported, never created | `DB_MIGRATION_PREREQUISITE_MISSING: extension:vector, role:authenticated, function:auth.uid` on a bare server; an operator provisions them deliberately (Supabase provisions them per project). |
| Interruption safety | a failure mid-file (simulated after the first of two chunks of `0026`) leaves no object and no ledger row; the re-run resumes with that file (test "interrupted migration"). |
| Statement splitting | Drizzle's `--> statement-breakpoint`; files without breakpoints (`0027`, `0028`) run as one chunk inside the transaction. |
| Credentials | the CLI prints host:port/database only and strips the URL's user and password from driver errors. |

Commands: `pnpm run db:migrate` (apply), `pnpm run db:migrate -- --dry-run` (plan), `pnpm run db:migrate:status` (applied / pending / drift / unknown / gap; exit 1 on any inconsistency). `.env.local` is read ONLY by this CLI, never by tests.

`pnpm run db:push` now refuses with a pointer to this contract (see §4).

## 4. Divergence audit: schema-first push vs SQL migrations (CONFIRMED, `b16-b-schema-parity.test.ts`)

Both paths satisfy every §2 criterion. Beyond that they are NOT the same schema — 30 structural differences:

- **16 objects only the migrations create** (a `db:push` database silently lacks them): `durable_workflow_heads` record FK + scope CHECK; `durable_workflow_records` head FK + scope CHECK; `durable_workflow_replays` scope CHECK; `durable_workflow_outbox` owner FK + completion/event/owner/scope/state/terminal CHECKs (all from the hand-written `0023`–`0025` hardening); `parts_atomic_links` primary key `parts_atomic_links_pkey`, FK `parts_atomic_links_part_id_fkey`, index `parts_atomic_links_revision_idx`.
- **6 objects only push creates**: `durable_workflow_outbox` attempts / event_version / owner_revision CHECKs (schema.ts names), `parts_atomic_links_part_id_parts_id_fk`, `parts_atomic_links_part_id_value_key_pk` (+ its index) — the same intent under drizzle-generated names.
- **8 changed definitions**: six physical-binding FKs are `DEFERRABLE INITIALLY DEFERRED` in the migrations and immediate in schema.ts (`physical_binding_audit_events` ×3, `physical_binding_migration_records`, `physical_binding_sets`, `physical_readiness_assessments`); the two BOM owner indexes are `DESC NULLS LAST` from schema.ts vs `DESC` (default NULLS FIRST) in `0028` — harmless because `taken_at`/`created_at` are `NOT NULL` (asserted).

Consequence: the migrations are the delivery truth; `schema.ts` is the ORM's typed view and is behind on integrity constraints. `db:push` is therefore refused as a delivery path (INFERRED risk it closes: a pushed database would accept outbox rows in illegal states and orphaned durable records). Re-aligning `schema.ts` with the migration-only constraints is an owner decision (OD-9: it changes what `drizzle-kit generate` would diff against) and is not performed here.

## 5. Disposable database and qualification (CONFIRMED)

- Default suite: PGlite (PostgreSQL 17.5 compiled to WASM, in-process, `@electric-sql/pglite@0.4.6` devDependency) with the extensions `vector`, `pg_trgm`, `pgcrypto` and the documented **platform shims** (`auth` schema + `auth.uid()` reading `request.jwt.claim.sub`; role `authenticated`). Tests prove the migrations and the executable RLS/CHECK behaviour — they do not claim to prove the Supabase platform.
- Real server: `SIRKIT_DB_QUALIFICATION=1` + `SIRKIT_DB_QUALIFICATION_URL` (see `database-qualification` in `test-and-validation-report.md`); Docker Desktop 4.67 on this machine fails at start (`initializing Inference manager … dockerInference: The file cannot be accessed by the system`), so no local container PostgreSQL was available — recorded as LB-6, not worked around by changing the machine's settings.
