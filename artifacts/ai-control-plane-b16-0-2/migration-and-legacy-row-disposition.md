# Migration & legacy-row disposition (§B / R3)

## Forward-only migration (NOT applied to any live DB this stage)
`drizzle/0028_bom_project_ownership.sql` adds server-derived ownership columns
`tenant_id`, `project_id`, `branch_id` to `bom_snapshots` and `bom_notifications`
(nullable), an all-or-nothing ownership CHECK, and owner-scoped indexes. The
schema (`app/lib/db/schema.ts`) is updated to match; `projectKey` remains as
NON-AUTHORITATIVE display/dedupe metadata (the server writes the trusted project
id into it) and never authorizes access.

## Legacy rows are QUARANTINED — ownership is never guessed
Existing rows receive NULL ownership. Every application predicate requires the
FULL non-null scope (`tenant_id = … AND project_id = … AND branch_id = …`), so a
NULL row can never match: legacy rows are invisible, immutable, and undeletable
through the API until an explicit **owner-controlled** migration assigns
ownership. No backfill from `project_key` is performed — a schematic-content hash
is not an owner. The isolation tests seed a NULL-ownership row keyed to a real
project id and prove even that project cannot reach it (list / diff / mark /
delete all skip it).

## Owner action required before live use
Provision `project_members` rows, then run a bespoke, owner-reviewed migration
that assigns `(tenant_id, project_id, branch_id)` to each legacy snapshot /
notification from an authoritative mapping (never from `project_key`). Until
then, legacy BOM history stays quarantined by design.


---

## SUPERSESSION NOTE (B16.0.3, 2026-08-24)

The "all-or-nothing ownership CHECK" described above did NOT actually enforce
the invariant: with the btrim-only second disjunct, a PARTIALLY-owned row (one
ownership column NULL, the others set) made the predicate SQL UNKNOWN, which a
PostgreSQL CHECK accepts. B16.0.3 corrected both checked-in sources — explicit
IS NOT NULL conjuncts in drizzle/0028_bom_project_ownership.sql AND
name-matched check() constraints declared in app/lib/db/schema.ts (so db:push
cannot omit them) — with the six-value truth table and schema/migration parity
test-pinned. The migration DELIVERY state (journal ends at 0026; 0027/0028 are
owner-applied manual migrations; drizzle-kit registration is an owner-gated
blocker) is documented in
artifacts/ai-control-plane-b16-0-3/migration-delivery-and-live-state.md.
Nothing was applied to any live database; the application-level quarantine
semantics described above are unchanged.
