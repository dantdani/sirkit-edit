# B12.8 — test evidence

New permanent suite: `app/lib/engineering/__tests__/b12-8-observer-isolation.test.ts`
— **9 / 9** — importing the SAME production `createAutosaver` and
`settleAutosaveForTransition` that page.tsx imports, under a suite-wide
process-level `uncaughtException` + `unhandledRejection` capture
asserted EMPTY in `afterAll`.

Stage item → test mapping (12 items in 9 test functions):

| # | Required coverage | Where proven |
| --- | --- | --- |
| 1–4 | throwing listener during dirty / saving / saved / error notification | the per-state matrix test: each of the four states trapped, against BOTH the succeeding-save path and the failing-save path |
| 5 | successful save executes and reports saved despite throwing listeners | reproduction-closure test (exactly one execution, `flush() === true`, status `saved`) + the matrix |
| 6 | failed save remains pending/error despite throwing listeners | the matrix (truthful `false`, committed `{error, quota}`, retry increments the call count) + the no-false-success test |
| 7 | recovered retry executes the retained save | dedicated test (calls 1 → 2, `saved`) |
| 8 | one throwing listener does not block later listeners | thrower-before-recorder test (`dirty → saving → saved` fully delivered) |
| 9 | a listener added reentrantly is not invoked in the current cycle | dedicated test (absent from the adding cycle, present in every later cycle) |
| 10 | debounce-triggered notification produces no uncaught exception | timer-path test + the suite-wide capture |
| 11 | coordinator success after a real persisted save | real-coordinator test 11 (save executed — pre-B12.8: zero — then installed) |
| 12 | coordinator refusal and recovery after a real save failure | real-coordinator test 12 (refusal is the SAVE's; retained write re-runs before install; one outcome per request; interlock/lease/transition/pending/status all clean) |

## Battery (exact counts, serialized)

| Suite | Result |
| --- | --- |
| **B12.8** `b12-8-observer-isolation` (new) | **9 / 9** |
| **B12 family total** (21 files: B12–B12.8) | **195 / 195** |
| B07 + B06/B03.2 (hydration, revision, undo, serialization) | **238 / 238** (11 files) |
| Project lifecycle incl. `autosave.test.ts` | **37 / 37** (5 files) |
| `npx tsc --noEmit` | clean |
| Scoped ESLint (autosave.ts, new suite) | clean (0 errors, 0 warnings) |
| `npx eslint app/page.tsx` | exactly the 14 pre-existing baseline errors, 0 new |
| descriptor `--check` | OK (same graph/source digests) |
| `generate-b11-artifacts` ×2 | byte-stable; 19/19 cases + 59/59 checks both runs; pins hash unchanged |
| `git diff --check` | clean |
| **Full suite** `npx vitest run --pool=forks --poolOptions.forks.maxForks=5` | **2568 passed, 20 skipped, 1 flake** (307 files) |

## Full-suite evidence chain (fully disclosed)

The user's machine was under heavy ACTIVE external load throughout this
stage's validation window (56–73% background CPU from interactive
applications, measured). Three full-suite attempts and their
disposition:

1. Default-parallelism run: 23 non-passes — EVERY one a 5s test-timeout
   or an elapsed-ms bound missed by 2–10× (worst: 48.4s vs a 10s
   budget); zero content/digest assertion failures anywhere. Discarded
   as machine-load contamination.
2. One diagnostic batch of the failing files accidentally executed from
   the wrong working directory picked up an npx-CACHED vitest without
   the workspace config (collection errors, no tests failed) —
   discarded; the scan root did not include the protected original.
3. Re-run from the correct root: the 19 previously-failing files → 15
   passed (210 tests, including every replay-pin, boundary, and
   component suite); only 4 wall-clock family members failed, each then
   **3/3 isolated-green**. A second default-parallelism full suite still
   produced 10 timing-shaped non-passes (including two 20-SECOND
   timeouts on tests that run in ~1.2s standalone — a 15×+ slowdown).
4. Final evidentiary run: the COMPLETE suite (all 307 files, identical
   tests and assertions) with the worker pool bounded to 5 forks so the
   suite does not oversubscribe the 14-core machine already 73% busy —
   **2568 / 20 / 1**. The single non-pass (`pcb-repair-agent`
   wall-clock performance target, a documented flake-family member in
   PCB code B12.8 never touched) was re-run **3× in isolation: 8/8
   green every time**.

No functional failure was classified as timing anywhere in this chain;
no threshold was relaxed; the bounded-pool invocation changes
scheduling parallelism only.
