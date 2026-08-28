# Migration delivery and live state (§D-delivery / R5)

## The reproduced facts (no live database was contacted at any point)
- `drizzle/meta/_journal.json` registers 27 entries, idx 0–26, ending at
  `0026_parts_atomic_links`. **Neither `0027_project_membership` nor
  `0028_bom_project_ownership` is registered.**
- `drizzle/meta/` contains snapshots only through `0008_snapshot.json` — the
  drizzle-kit metadata has not tracked the hand-written migrations since 0009.
- `package.json` exposes `db:generate` (drizzle-kit generate) and `db:push`
  (drizzle-kit push) and NOTHING that runs the SQL migration files in order
  (no `drizzle-kit migrate` / migrator script). No repository test runs the
  drizzle migrator.
- Before this stage, `schema.ts` declared the BOM ownership columns and owner
  indexes but NOT the ownership-completeness CHECKs — so the `db:push` path
  would have silently omitted the constraint entirely.

## What B16.0.3 changed (semantics, not delivery)
- The CHECK semantics are now correct AND identical in both checked-in
  sources: migration `0028` and `schema.ts` (name-matched constraints;
  parity test-pinned). Whichever delivery path the owner uses, the same
  correct constraint arrives.
- Nothing was applied. No live database was touched. No Drizzle snapshot or
  journal metadata was invented or edited — fabricating `_journal.json`
  entries without the corresponding snapshot chain (which stops at 0008)
  would falsify metadata drizzle-kit relies on, and is exactly what this
  stage refuses to do.

## Disposition: 0027/0028 are OWNER-APPLIED MANUAL migrations (documented)
Since 0009 this repository's migrations are hand-written SQL files that the
journal does not register; the de-facto delivery path has been the owner
applying the SQL directly (or `db:push` diffing `schema.ts`). Given that:
1. `0027` and `0028` are hereby documented as **owner-applied manual
   migrations** — idempotent by construction (`IF NOT EXISTS` /
   `DROP CONSTRAINT IF EXISTS` + `ADD`), applied deliberately by the operator
   in file order.
2. The ONE explicit, reproducible deployment path for the checked-in
   repository is: **apply `drizzle/0027_project_membership.sql` then
   `drizzle/0028_bom_project_ownership.sql` manually (psql or equivalent),
   OR run `db:push` from `schema.ts`** — both now converge on the same
   ownership columns, indexes, and (post-B16.0.3) the same named CHECK
   constraints. `db:push` alone does NOT create the `project_members` RLS
   policies in 0027's SQL, so the manual path is the complete one; this is
   stated, not hidden.
3. **Registering 0028 through drizzle-kit's journal is an OWNER-GATED
   deployment blocker**: doing it safely requires reconciling the historical
   metadata gap (journal idx 9–26 have no snapshots; snapshots stop at 0008),
   i.e. regenerating a full snapshot chain against the real database state —
   which cannot be done truthfully without connecting to the live database,
   which this stage is forbidden to do. Recorded in
   `unknowns-and-owner-decisions.md`.

## Honest limits
- **No claim is made that any live database is protected.** Whether 0027/0028
  have ever been applied anywhere is UNKNOWN from this repository.
- The application-level quarantine (full-scope predicates; NULL never
  matches) remains the enforced-in-this-tree defence; the DDL constraint is
  correct-in-repo and awaits owner-controlled application.
