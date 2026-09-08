# B16-B — RLS and membership proof (executable, not only represented)

Labels: CONFIRMED = observed by running `app/lib/db/__tests__/b16-b-rls-membership.test.ts` on the disposable PostgreSQL 17.5 instance (2026-09-07); RECORDED = read from source; INFERRED; UNKNOWN.

## Why this proof exists

B16.1B declared the `project_members` RLS policy in `schema.ts` (`pgPolicy` + `enableRLS()`) so that a pushed database would carry it, and migration `0027` carries the same policy in SQL. Until B16-B nothing EXECUTED the policy: no test ever ran `SET ROLE authenticated` against a migrated database. The runbook's pass criterion — "RLS and membership policies are executable, not only represented in TypeScript" — is met by the tests below, which run PostgreSQL's own policy evaluation.

## Fixture (CONFIRMED)

After `migrateDatabase` and the documented grant shim (`GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON project_members TO authenticated` — Supabase grants its API roles by default; the shim grants only what the test exercises):

| membership | tenant | project | user | role | state |
|---|---|---|---|---|---|
| m1 | tenant-a | proj-1 | U1 | admin | active |
| m2 | tenant-a | proj-1 | U2 | viewer | active |
| m3 | tenant-a | proj-1 | U3 | viewer | revoked |
| m4 | tenant-b | proj-9 | U1 | editor | active |

Each authenticated read runs as `SET ROLE authenticated` with `request.jwt.claim.sub` set to the subject (the contract `auth.uid()` reads on Supabase), then `RESET ROLE`.

## Executable results (CONFIRMED)

| Check | Result |
|---|---|
| U1 reads `project_members` | sees exactly `m1`, `m4` — its own ACTIVE memberships across both tenants it belongs to, never `m2`/`m3` |
| U2 reads | sees exactly `m2` |
| U3 (revoked) reads | sees nothing |
| no subject (`auth.uid()` NULL) reads | sees nothing |
| U2 inserts an admin membership for itself | refused: `new row violates row-level security policy for table "project_members"` (no INSERT policy exists) |
| U2 `UPDATE … SET role='admin'` on m2 | affects 0 rows (no UPDATE policy): m2 stays `viewer` |
| U2 `DELETE` m1 | affects 0 rows (no DELETE policy): m1 remains |
| trusted server path (superuser / service role bypasses RLS) | sees all 4 rows |

Catalog facts behind the results (`verifyMembershipAndOwnership`, CONFIRMED): `relrowsecurity = true`; exactly one policy on `project_members`: `project_members_self_select`, `SELECT`, roles `{authenticated}`, `USING ((state = 'active') AND (user_id = ((SELECT auth.uid()))::text))`; the "caller-bound" criterion passes for every policy in the schema (there is one) — no policy predicate is `true` or omits `auth.uid()`, so no policy grants cross-tenant or cross-project access.

## CHECK constraints under three-valued logic (CONFIRMED)

| Insert | Outcome |
|---|---|
| role `owner` | refused `project_members_role_check` |
| state `pending` | refused `project_members_state_check` |
| version `0` | refused `project_members_version_check` |
| tenant `'   '` | refused `project_members_identity_check` |
| `audit_actor_id` NULL | refused NOT NULL |
| duplicate (tenant, project, user) | refused `project_members_tenant_project_user_uniq` |
| BOM row `(NULL, NULL, NULL)` ownership | accepted (quarantined legacy row) |
| BOM row `('t','p','b')` | accepted |
| BOM row `('t', NULL, NULL)`, `('t','p',NULL)`, `(NULL,'p','b')`, `('t','p','  ')` | refused `bom_snapshots_ownership_complete_check` — the explicit `IS NOT NULL` terms (B16.0.3 R4) make the second disjunct FALSE, not UNKNOWN |

## Limits (stated)

- The `authenticated` role and `auth.uid()` are documented shims in the disposable instance; Supabase's real objects are equivalent by contract (the policy text is identical) but were not executed live in this checkpoint (BLOCKED-LIVE-QUALIFICATION: no isolated project — LB-1/LB-4).
- The B16.1B session-liveness, cookie, sign-out and role guarantees are untouched by B16-B: no file under `app/lib/auth/` changed (RECORDED from `git diff --stat`); their suites remain in the default run.
