# B16.0.16 — Unknowns & owner decisions

## Owner decisions taken (documented)

1. **Deadline discovered, not invented (CONFIRMED)** — `scopedTrustedJson`
   passed no `deadlineMs`, so the reader default `30_000` applied. Adopted
   `deadlineMs: 30_000` explicitly.
2. **`calculationScopeFromContext` delegates to `flatScopeOf` (CONFIRMED)** — the
   projector produces the exact `CalculationApiScope` via the same shared
   projection `scopedJson` used, so the scope shape is byte-identical.
3. **`scopedJson` retained (CONFIRMED)** — kept in `_scope.ts` (not deleted);
   only the two categories of helper were ADDED. No shared behavior weakened.
4. **Propose/report/transaction boundary suite uses spied domain validators
   (INFERRED → acceptable)** — `validateCircuitCalculationProblem` /
   `validateCalculationProjectState` are spied to `[]` so the PROVIDER / SCOPE /
   ACTOR boundary can be tested without reconstructing full valid CD-7
   objects. The real validators, evaluators, digest checks, and transaction
   semantics are covered by the unchanged `app/lib/calculation` domain suite
   (green). The route callback logic downstream of validation is byte-identical.
5. **Deadline fake-timer pin not added (INFERRED)** — the 30 s bounded-reader
   deadline is the shared reader's contract, already covered by the standing
   bounded-json suite; the pre-aborted pin proves the abort path at the route
   level. A route-level fake-timer deadline pin would only re-test the shared
   reader and risks timing flake; omitted deliberately.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** — identity/membership via
  injection seams only.
- **Remaining migration: 69 raw methods** (baseline 72) — spice family, chat,
  replacement-authority, schematic-compiler/full-flow and other families, plus
  the 3 factory routes. This stage completes the calculation family; the broader
  migration is **not** complete. **CONFIRMED**.

## Scope adherence

Work confined to `sirkit-edit`; protected original untouched; no provider
credits; no live network/DB; no algorithm/prompt/tool-exposure changes.
B16.0.17 / B16.1 / MCP / multi-agent / provider expansion / new calculation
capabilities NOT started.
