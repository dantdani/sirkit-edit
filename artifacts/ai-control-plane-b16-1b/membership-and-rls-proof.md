# B16.1B §F — membership and migration qualification

## Registration and application of `0027_project_membership.sql`

| question | finding | label |
|---|---|---|
| Is 0027 registered in the drizzle journal? | **No.** `drizzle/meta/_journal.json` has entries 0000–0026; neither `0027_project_membership.sql` nor `0028_bom_project_ownership.sql` is an entry (and snapshots exist only through 0008). B16.0.3 already recorded 0027/0028 as "owner-applied MANUAL migrations; drizzle-kit registration owner-gated". | CONFIRMED |
| How does the repository apply schema? | README: `pnpm drizzle-kit push` (schema-driven sync of `app/lib/db/schema.ts`), not `drizzle-kit migrate`. | CONFIRMED |
| Is 0027 applied to the live database? | **UNKNOWN / BLOCKED** — the configured project is unreachable (pooler: tenant not found; API host: DNS `ENOTFOUND`). The read-only structural probe (table/columns/constraints/indexes/RLS/policies/grants, counts only) could not run. | BLOCKED |
| Was anything applied or written by this stage? | **No.** No migration was run, no `push`, no canary row. Nothing was applied to any database. | CONFIRMED |

### Owner command (precise, not executed)

Against the ISOLATED qualification project only:

```bash
# option A — apply the idempotent SQL file exactly as written (table, indexes, RLS, policy):
psql "$SIRKIT_AUTH_QUALIFICATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0027_project_membership.sql
```

```bash
# option B — schema-driven sync (after B16.1B the drizzle schema declares the same RLS + policy):
DATABASE_URL="$SIRKIT_AUTH_QUALIFICATION_DATABASE_URL" pnpm drizzle-kit push
```

Read-only verification queries the owner can run afterwards (structure only):

```sql
select to_regclass('public.project_members');
select conname, contype from pg_constraint where conrelid = 'public.project_members'::regclass order by 1;
select indexname from pg_indexes where tablename = 'project_members' order by 1;
select relrowsecurity from pg_class where oid = 'public.project_members'::regclass;
select policyname, cmd, roles, qual from pg_policies where tablename = 'project_members';
```

Do NOT run either command against a production/customer database on the strength of this document; the migration is idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`) but application to production is an owner decision.

## Schema/runtime parity (offline, CONFIRMED) — `b16-1b-membership-schema-parity.test.ts`

| element | migration 0027 | `app/lib/db/schema.ts` (`projectMembers`) | parity |
|---|---|---|---|
| columns | `membership_id text PK`, `tenant_id`, `project_id`, `user_id`, `role`, `state` (text NOT NULL), `version integer DEFAULT 1 NOT NULL`, `created_at`/`updated_at timestamp with time zone NOT NULL`, `audit_actor_id text NOT NULL` | identical names, order, SQL types, nullability, default | CONFIRMED |
| checks | `project_members_role_check` (`viewer,commenter,editor,reviewer,admin`), `_state_check` (`active,revoked`), `_version_check` (`> 0`), `_identity_check` (btrim ≠ '') | identical names; the role list equals `Object.keys(PROJECT_ROLE_FROM_MEMBERSHIP)` | CONFIRMED |
| unique index | `project_members_tenant_project_user_uniq (tenant_id, project_id, user_id)` | identical | CONFIRMED |
| lookup index | `project_members_lookup_idx (tenant_id, project_id, user_id, state)` | identical | CONFIRMED |
| RLS enabled | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` | **added by B16.1B**: `.enableRLS()` | CONFIRMED (was a GAP — a `push`-provisioned database had no RLS) |
| policy | `project_members_self_select FOR SELECT TO authenticated USING ("state" = 'active' AND "user_id" = (select auth.uid())::text)` | **added by B16.1B**: `pgPolicy(...)` with the identical predicate (rendered SQL compared after normalisation) | CONFIRMED |
| write policies for `authenticated` | none (`FOR INSERT/UPDATE/DELETE/ALL` absent) | none | CONFIRMED |
| drizzle-kit role handling | — | `drizzle.config.ts`: `entities: { roles: { provider: "supabase" } }` so the kit references, never manages, the platform `authenticated` role | CONFIRMED |

## What the RLS proves and what remains live-only

| requirement | offline evidence | live status |
|---|---|---|
| authenticated users cannot insert, update, grant, escalate, or revoke their own membership through the publishable-key client | with RLS enabled and NO policy for INSERT/UPDATE/DELETE, Postgres denies those commands for `authenticated` (default-deny); the migration comment states it; the schema now declares it; the app itself never uses a publishable-key client for writes (all writes are server-side operator/admin flows — no route grants membership; pinned: no signup surface) | **PROPOSED live check** (`insert`/`update`/`delete` via a publishable-key client as the qualification user must fail; blocked — no project) |
| users can read only their own ACTIVE membership through that client | the policy predicate; this client-facing read is permitted by design (B16.0) but UNUSED by the application (no browser Supabase client exists) | PROPOSED live check (blocked) |
| server membership lookups match the exact (tenant, project, user) tuple | `PostgresProjectMembershipRepository` renders `("tenant_id" = $1 and "project_id" = $2 and "user_id" = $3) … limit 1` with exactly the input values (recording fake DB handle + `PgDialect`); a foreign tuple is queried as given, never widened | CONFIRMED |
| revoked rows fail closed | repository returns `null` for `state ≠ 'active'` → 403 `AUTH_NO_ACTIVE_MEMBERSHIP` | CONFIRMED |
| malformed roles fail closed | `projectRoleFromMembership("superuser")` = null → 403 `AUTH_ROLE_UNMAPPED` through the resolver | CONFIRMED |
| active → revoked takes effect on the immediately following request | membership is loaded per request (no cache); proven with the fake repository and real-SDK identity | CONFIRMED offline; canary against an isolated DB **BLOCKED** (the opt-in live test performs it and restores/deletes the row) |

The server membership path uses the durable `DATABASE_URL` connection (a Postgres role that bypasses RLS by design); the publishable key never reaches the membership table from the server.
