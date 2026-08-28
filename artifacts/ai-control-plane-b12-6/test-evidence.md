# B12.6 — test evidence

New permanent suite: `app/lib/engineering/__tests__/b12-6-autosave-settlement.test.ts`
— **12 / 12** — importing the SAME `settleAutosaveForTransition` that
page.tsx imports (the source gate pins the import and the hook
expression, so a harness-only fix is structurally impossible).

Stage requirement → test mapping:

| # | Required coverage | Test |
| --- | --- | --- |
| 1 | no autosaver | helper test 1 (null and undefined) |
| 2 | no pending work | helper test 2 (zero save calls, status untouched) |
| 3 | successful pending flush | helper test 3 |
| 4 | false-returning failed save | helper test 4 (real autosaver; recorded `quota` detail surfaced) |
| 5 | throwing save | helper test 5 — BOTH shapes: a throwing save() through the real autosaver (surfaces as false + detail) and a hostile Autosaver whose flush() itself throws |
| 6 | failed transition leaves target uninstalled | coordinator test 6+7+9 (installer never invoked, pointer unchanged, no UI adoption) |
| 7 | survivor/reactivation state after failure | same test (fresh ACTIVE interlock, real lease acquired/released, transitionPending false) |
| 8 | false failure followed by a successful retry | coordinator test 8 (A's pending save re-runs and succeeds BEFORE B installs) |
| 9 | exact single terminal outcome | test 6+7+9 (`outcomes.length === 1`, typed `transition-failed`) |
| 10 | retained pending dirty state | helper test 10 (same save re-ran on the healthy retry: 1 → 2 calls) |
| 11 | bounded/safe error detail | helper test 11 (credential-shaped reason redacted; 5,000-char reason capped ≤ 260 total; hostile status() cannot break the refusal) |
| 12 | compatibility with reentrant callback and interlock-barrier cases | tests 12a (settlement failure behind a held lease: refusal strictly post-barrier, survivor reactivated) and 12b (retry from inside the failed outcome callback installs after recovery) |
| — | page wiring | source gate: import + exact hook expression + no bare flush in the coordinator construction + export-handler boolean check untouched |

## Battery (exact counts)

| Suite | Result |
| --- | --- |
| **B12.6** `b12-6-autosave-settlement` (new) | **12 / 12** |
| **B12 family total** (19 files: B12–B12.6) | **177 / 177** |
| B07 + B06/B03.2 (hydration, revision, undo, gesture, serialization) | **238 / 238** (11 files) |
| Project lifecycle incl. `autosave.test.ts`, checkpoints, history | **37 / 37** (5 files) |
| `npx tsc --noEmit` | clean |
| Scoped ESLint (autosave.ts, new suite) | clean |
| `npx eslint app/page.tsx` | exactly the 14 pre-existing baseline errors, 0 new |
| descriptor `--check` | OK (same graph/source digests) |
| `generate-b11-artifacts` ×2 | byte-stable; 19/19 cases + 59/59 checks both runs; pins hash unchanged |
| `git diff --check` | clean (pre-existing CRLF advisories only) |
| **Full suite** `npx vitest run` | **2548 passed, 20 skipped, 3 flakes** (305 files) |

## The three non-passes — classified only after isolated reproduction

`compute-fill` (< 300 ms pour), `pcb-repair-agent` (snapshot
performance target), `route-tool` (500-track preview) — all wall-clock
performance thresholds in PCB code B12.6 never touched, all documented
flake-family members. Each FILE re-run **three consecutive times in
isolation: 7/7, 8/8, 25/25 — green every time.** No functional failure
was classified as timing; no threshold was relaxed.
