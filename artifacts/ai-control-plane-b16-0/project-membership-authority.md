# B16.0 — project membership authority

## The one server-owned role source

A human's project ROLE is looked up from `project_members`, never from a
client header and never from user-editable JWT `user_metadata`.

Table (`app/lib/db/schema.ts` + migration `drizzle/0027_project_membership.sql`):

| column | meaning |
|---|---|
| `membership_id` | primary key |
| `tenant_id`, `project_id`, `user_id` | scope + authenticated principal |
| `role` | `viewer` \| `commenter` \| `editor` \| `reviewer` \| `admin` |
| `state` | `active` \| `revoked` (revoked fails closed immediately) |
| `version` | monotonic; changes retire bound proposals/approvals |
| `created_at`, `updated_at`, `audit_actor_id` | audit |

- Unique membership per `(tenant_id, project_id, user_id)`.
- CHECK constraints pin the role and state vocabularies and non-empty ids.
- No implicit first-user administrator; no public endpoint grants membership;
  no browser-supplied role.

## Explicit role mapping

`app/lib/auth/project-membership.ts` maps the stored membership role to
Sirkit's `ProjectRole` through a closed table
(`PROJECT_ROLE_FROM_MEMBERSHIP`): `viewer→viewer`, `commenter→commenter`,
`editor→pcb_editor`, `reviewer→reviewer`, `admin→project_admin`. An
unrecognized stored value maps to null (fail closed). A JWT-metadata role
string can never map (it is not a membership role) — proven by
`projectRoleFromMembership("project_admin") === null`.

## Repositories

- `ProjectMembershipRepository.loadActiveMembership({tenant, project, user})`
  — returns the ACTIVE record or null (missing / revoked / cross-tenant /
  cross-project all fail closed).
- `PostgresProjectMembershipRepository` — production, reads `project_members`
  (no I/O at construction).
- `InMemoryProjectMembershipRepository` — tests.
- `LocalDevProjectMembershipRepository` — the fixed local principal is admin
  on any selected project (local_dev only; never production).

## RLS (defence in depth)

The migration enables RLS on `project_members` with a single
`SELECT`-to-`authenticated` policy scoped to `user_id = (select auth.uid())`
and `state = 'active'` (the `(select …)` initPlan form per Supabase
guidance). No INSERT/UPDATE/DELETE policy is granted to `authenticated` — a
user can never grant, escalate, or revoke their own membership. All writes go
through the trusted server path (secret/service key), which bypasses RLS by
design. Server application checks (`resolveTrustedRequestContext`) remain the
MANDATORY authority even with RLS present.

## Membership revision binding

`membershipRevisionOf(record)` derives a stable `mbr1-…` digest over
tenant/project/user/role/state/version. A role change, version bump, or
revocation changes it (permanent test), so any proposal/approval that binds
the `TrustedRequestContext.membershipRevision` is invalidated when membership
changes. A revoked member is refused at the chat surface (403), so no new
proposal can be issued after revocation.
