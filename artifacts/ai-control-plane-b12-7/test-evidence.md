# B12.7 — test evidence

New permanent suite: `app/lib/engineering/__tests__/b12-7-total-settlement.test.ts`
— **9 / 9** — importing the SAME `createAutosaver` and
`settleAutosaveForTransition` that page.tsx imports, under a suite-wide
process-level `uncaughtException` + `unhandledRejection` capture
asserted EMPTY in `afterAll`.

Stage item → test mapping (12 items in 9 test functions):

| # | Required coverage | Where proven |
| --- | --- | --- |
| 1 | unstringifiable thrown save value | "R1 closure" (typed failure, error status, retained pending, healed retry persists the ORIGINAL write) |
| 2 | hostile Error.message getter | renderer matrix (falls to `name` → "Error") + thrown-from-save case + thrown-from-flush case |
| 3 | hostile Proxy thrown value | renderer matrix (hostile get/getPrototypeOf traps + a revoked proxy → fixed generic) |
| 4 | Symbol and null thrown values | renderer matrix + thrown-from-save cases (each retained + rendered) |
| 5 | throwing foreign flush | settlement-strictness test — five thrown shapes, settlement never throws (closes R2/R3) |
| 6 | truthy non-Boolean flush result | R4 closure ("yes", 1, {}, [], function → fail closed with the "non-boolean" prefix) |
| 7 | falsy non-Boolean flush result | same test (0, "", null, undefined, NaN → fail closed); literal `true`/`false` behave exactly |
| 8 | status is `error`, never `saving`, after every failure | asserted inside R1 closure, the per-shape save-throw test, the foreign-`{ok:"yes"}` test, and the debounce test |
| 9 | retained-pending retry through the real autosaver | R1 closure + per-shape tests (save call count increments on every later settlement) |
| 10 | coordinator refusal followed by successful recovery | real-coordinator test (refusal with zero installs/pointer moves → healed retry persists A then installs B; no transition/interlock/lease/timer/status leak) |
| 11 | bounded/redacted diagnostic output | renderer bound test + settlement bound test (5,000-char credential-bearing reasons: capped, `sk-live…` redacted) |
| 12 | debounce-triggered hostile save creates no uncaught exception | debounce test (the TIMER runs the hostile save; suite-wide capture empty; retained error state) |

## Battery (exact counts; all runs serialized after one discarded self-contaminated run — see changed-files-and-deviations.md)

| Suite | Result |
| --- | --- |
| **B12.7** `b12-7-total-settlement` (new) | **9 / 9** |
| **B12 family total** (20 files: B12–B12.7) | **186 / 186** |
| B07 + B06/B03.2 (hydration, revision, undo, serialization) | **238 / 238** (11 files) |
| Project lifecycle incl. `autosave.test.ts` | **37 / 37** (5 files) |
| `npx tsc --noEmit` | clean |
| Scoped ESLint (redaction.ts, autosave.ts, 3 touched test files) | clean |
| `npx eslint app/page.tsx` | exactly the 14 pre-existing baseline errors, 0 new |
| descriptor `--check` | OK (same graph/source digests) |
| `generate-b11-artifacts` ×2 | byte-stable; 19/19 cases + 59/59 checks both runs; pins hash unchanged |
| `git diff --check` | clean |
| **Full suite** `npx vitest run` (alone) | **2554 passed, 20 skipped, 6 flakes** (306 files) |

## The six non-passes — classified only after isolated reproduction

Every failing assertion was an ELAPSED-TIME bound or a 5-second
test-timeout on heavy compute — none functional: passive-policy
(7,981 ms vs < 5,000), connectivity-board (52.1 ms vs < 50),
pcb-repair-agent (645 ms vs < 250), run-drc (210.3 ms vs < 200),
auto-place and route-tool (5,000 ms test timeouts on the 100-footprint
and 500-track fixtures). All in PCB/policy code B12.7 never touched
(B12.7 changed only redaction.ts, autosave.ts, and three test files);
the run coincided with heavy external machine load (the reference
budgets missed by 1.6×). Each FILE re-run **three consecutive times in
isolation: 3/3, 8/8, 10/10, 8/8, 25/25, 5/5 — 18 green runs, green
every time.** No functional failure was classified as timing; no
threshold was relaxed.
