# B16.0.9 — Unknowns & owner decisions

## Pre-existing behaviors preserved and DOCUMENTED (not silently kept or fixed)

1. **`interfaces/allocate` has no body-scope check.** The handler reads
   `context.projectId` and immediately `void`s it; the allocation runs on
   caller-supplied snapshot/requirements without a project cross-check. The
   route is still fully authenticated (membership + CSRF + policy), and the
   inputs are compute-only (no durable read keyed by the body), but it is
   looser than its siblings. Adding a scope check would be a CONTRACT CHANGE
   (some callers may pass cross-project snapshots deliberately). **Owner
   decision:** whether to add a snapshot/candidate scope cross-check in a
   dedicated corrective stage.
2. **Shapeless problems make the arch/interfaces validators throw**, landing in
   the provider-error 503 path instead of an integrity 422. Pre-existing,
   preserved, pinned. **Owner decision:** whether to harden
   `validateArchitectureProblem` / `validateInterfacePlanningProblem` to return
   diagnostics on missing arrays.
3. The legacy unreachable `kind !== "authenticated"` 401 became the wrapper's
   unreachable `AUTH_UNSUPPORTED_PRINCIPAL` 403 — not observable for session
   policy rows (no decision needed; recorded).

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** (no live DB contacted).
- Deadline/stall settlement (30 s) is inherited from the shared reader's proven
  contract rather than re-proven per route at full duration (a 17×30 s wall
  would add nothing beyond the reader's existing behavioral proofs).

## Next tranche recommendation (owner to confirm)

Tranche 3 candidates with the same low-risk profile: the schematic family
(8 methods, 16 MB/45 s — needs only different declared limits), the bom family
(7), spice compile/reports/estimate (3 already public-migrated? no — spice/ai +
compile/reports/estimate remain), then the `_scope`-family JSON POSTs.
High-risk (chat, replacement-authority, exports, SPICE streaming) stay last
with dedicated variants.

## Scope adherence

Work confined to `C:\Users\robsa\Desktop\sirkit-edit`; `C:\Users\robsa\sirkit`
untouched; zero provider credits (fake adapter only); no provider config
changes; no DB migrations/writes; no tool-exposure changes; B16.0.10 / B16.1
NOT started.
