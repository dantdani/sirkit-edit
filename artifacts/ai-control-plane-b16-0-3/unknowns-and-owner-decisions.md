# Unknowns & owner decisions (B16.0.3)

## R9 — live Supabase authentication: UNKNOWN (unchanged, never claimed)
Every B16.0.3 proof runs against injected identity/membership fakes and
fail-closed branches. No live sign-in, JWT round-trip, or real
`project_members` row was exercised. The B16.0.1 R9 owner checklist still
stands, now including the replacement-authority route: a live editor session
must be shown to reach it and a live non-member refused.

## Migration delivery — OWNER-GATED deployment blocker (from §D / R5)
- `drizzle/meta/_journal.json` ends at `0026`; snapshots end at `0008`.
  `0027`/`0028` are **owner-applied manual migrations** (documented in
  `migration-delivery-and-live-state.md`), idempotent, applied in file order.
- **Registering 0028 through drizzle-kit cannot be done safely from this
  repository alone**: it requires reconciling the 0009–0026 snapshot gap
  against the REAL database state, i.e. a live connection this stage is
  forbidden to make. Owner decision required: either continue the manual-SQL
  delivery path (complete — includes 0027's RLS policies, which `db:push`
  does not create), or perform a one-time metadata reconciliation against the
  live database and adopt `drizzle-kit migrate`.
- **No claim is made that any live database currently enforces the ownership
  CHECK** (or has the ownership columns at all). Whether 0027/0028 were ever
  applied anywhere is UNKNOWN from this tree.

## Legacy-row ownership assignment (carried from B16.0.2, still owner-gated)
Quarantined NULL-ownership BOM rows remain unavailable until an
owner-controlled migration assigns ownership from an authoritative mapping —
never guessed from `project_key`.

## Client behaviour note for the owner (deliberate, not a defect)
`/api/replacement-authority` now requires an authenticated project member
(editor class). In a deployment with no authenticated session, the replacement
reauthorization exchange fails CLOSED (401 → the one-shot channel yields null
→ the apply refuses with zero mutation, exactly the B14.2 §A settlement
semantics). The previous local-only anonymous behaviour is intentionally gone;
local development authenticates through the same resolver as everything else
(the fixed local principal via `resolveTrustedRequestContext`).

## Production configuration (unchanged reminders)
- `SIRKIT_EXPECTED_ORIGIN` remains REQUIRED in production (CSRF fails closed
  without it) — this now also protects `/api/replacement-authority`.
- `DATABASE_URL` absent ⇒ the component-authority source withholds (503) —
  truthful and fail-closed, but only reachable AFTER authorization.

## Scope not started (per the stop condition)
B16.1, MCP, multi-agent orchestration, manufacturing expansion, additional
provider work, new AI tool exposure — NOT started. `sirkit.manufacturing.release`
stays internal-only/not-callable; agent tool exposure stays EXACTLY 12
(gate-pinned, re-verified in this stage's gate run).
