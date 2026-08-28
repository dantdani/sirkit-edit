# B12.8 — changed files and deviations

## Changed files

| File | Change |
| --- | --- |
| `app/lib/project/autosave.ts` | ONLY `setStatus` inside `createAutosaver`: commit-before-notify, stable listener snapshot (reentrant additions excluded from the current cycle; mid-cycle removals honored), per-subscriber catch with continued delivery, no rethrow anywhere, no output channel for thrown observer values. Everything else in the module — `run()`, `flush()`, `schedule()`, `destroy()`, `settleAutosaveForTransition`, `renderUnknownError` usage — byte-unchanged from B12.7 |
| `app/lib/engineering/__tests__/b12-8-observer-isolation.test.ts` | NEW — 9 permanent tests covering the stage's 12 items (mapping in [test-evidence.md](test-evidence.md)), under a suite-wide process-level uncaughtException/unhandledRejection capture; imports the SAME production `createAutosaver` and `settleAutosaveForTransition` page.tsx imports |
| `artifacts/ai-control-plane-b12-8/` | 10 stage documents |

page.tsx, the coordinator, the journal, the redaction module: UNCHANGED
in B12.8. No dependency changes.

## Deviations and honest notes

- The stage's 12 test items are covered in 9 test functions: items 1–4
  (per-state throwing listeners) share one parameterized test that
  exercises all four states against BOTH the succeeding and failing
  save paths; items 5–6 are asserted inside that same matrix plus the
  reproduction-closure test; the remaining items are one test each.
- The isolation contract additionally honors mid-cycle UNSUBSCRIBES
  (a membership re-check before each delivery) — not demanded by the
  stage, but the same observers-have-no-authority principle; noted here
  so the verifier does not mistake it for accidental behavior.
- B12.7's throwing-LISTENER note ("a hostile subscriber could still
  propagate out of flush()") had proposed this closure; the verifier's
  reproduction showed it was not merely an exception-propagation
  nuisance but a data-loss defect (the write lost, false success). The
  B12.7 verdict's PROPOSED row is thereby resolved by this stage.
