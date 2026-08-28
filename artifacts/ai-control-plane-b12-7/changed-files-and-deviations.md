# B12.7 — changed files and deviations

## Changed files

| File | Change |
| --- | --- |
| `app/lib/agent/redaction.ts` | ADDITIVE: `renderUnknownError` (the one total, bounded unknown-error renderer) + `UNRENDERABLE_THROWN_VALUE` (the fixed generic diagnostic). No existing export changed |
| `app/lib/project/autosave.ts` | `run()` settles the save attempt TOTALLY: guarded `ok`/`reason` reads, `saved` only for an explicit `{ ok: true }`, thrown values rendered via `renderUnknownError`, `pending = true` restored BEFORE any status/listener work. `settleAutosaveForTransition`: flush-catch renders via `renderUnknownError`; only `flush() === true` settles ok (falsy AND truthy non-Booleans fail closed, non-Booleans with a distinct prefix). Public API, debounce, subscribe, destroy: unchanged |
| `app/lib/engineering/__tests__/b12-7-total-settlement.test.ts` | NEW — 9 permanent tests covering the stage's 12 items (mapping in [test-evidence.md](test-evidence.md)), under a suite-wide process-level uncaughtException/unhandledRejection capture; imports the SAME `createAutosaver` and `settleAutosaveForTransition` page.tsx imports |
| `app/lib/engineering/__tests__/b12-5-transactional-activation.test.ts` | one test gained an explicit `{ timeout: 20_000 }` (declared allowance — see deviations) |
| `app/lib/engineering/__tests__/b12-6-autosave-settlement.test.ts` | same single-test timeout allowance |
| `artifacts/ai-control-plane-b12-7/` | 10 stage documents |

page.tsx: UNCHANGED in B12.7 (it already imports the two functions this
stage hardened — the closure reaches production through them).

## Deviations and honest notes

- **Self-inflicted invalid battery run, discarded:** one B12-family run
  and one full-suite run were executed CONCURRENTLY with each other and
  with the artifact generators; the resulting timeout failures
  (b12-5-activation R2, several b12-6 coordinator tests — all at the 5s
  default ceiling) were scheduling contamination, not functional
  failures. Both runs were discarded as evidence; the two heavyweight
  tests (each carries its file's one-time production persistence
  import, ~1.5s standalone) were granted explicit 20-second timeouts —
  the same declared allowance the b12-4 pointer tests already carry —
  with ZERO assertion changes, and the family and full suite were
  re-run cleanly (isolated 3× green first: 23/23 each run).
- The stage's test list has 12 items; the suite covers them in 9 test
  functions (several items share a scenario — e.g. status-not-saving
  and retained-pending are asserted inside every failure test). The
  mapping is explicit in [test-evidence.md](test-evidence.md).
- `String(value)` IS used inside the renderer — only on primitives
  (numbers, booleans, bigints, symbols, undefined), where no user trap
  can exist. Objects are never string-converted at all.
