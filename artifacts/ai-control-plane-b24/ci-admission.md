# B24-B2 - CI admission and the missing areas

Increment B24-B2 of chapter B24 on `chapter/b24-production-qualification` (base `b0af256`, B24-B1 committed). It closes D24-15
(OD-204) and D24-16 (OD-205), delivered as B2a (CI admission: deliverables 1-3) then B2b (the missing areas: deliverables 4-6) in one
working tree. Labels: **CONFIRMED** (executed here, or read at the cited line), **INFERRED**, **PROPOSED**, **RECORDED** (taken from a
record), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (a live step that needs a resource the owner has not supplied; never faked, never
claimed). Every workflow line below is the tree's after B2's edit unless a base is named.

- **Admitted to CI.** The 33 suites of D24-15 and the 3 catalogued opt-in live suites no job selected (OD-222) now run in
  prompt-to-gerber: 32 lines inserted before its `--reporter` line (`deterministic-manufacturing.yml:260-291`), the five
  footprint-resolver suites by one directory filter (`:288`). The local run of the 36 at `b0af256` was green (section 4). CONFIRMED
- **The corpus.** `b24-b2-corpus-nightly` rides benchmark-nightly's vitest step (`benchmark.yml:64`) with
  `SIRKIT_B24_CORPUS_NIGHTLY: "1"` (`:66`), schedule and dispatch only; every pull-request job skips its corpus cases. Its local
  flagged run takes 6.5 s and is **red**: three CD-9 circuit-verification packages end `failed_correctness` because the built-in
  executor has no case for their operations (section 7). RECORDED counterexample, a STOP for the lead. CONFIRMED by execution.
  [B24-B2 review, 2026-10-08] A red corpus step no longer skips the nightly's later steps: `stage10:test` (`:67-68`) and the holdout
  declaration (`:79-80`) carry `if: ${{ !cancelled() }}` (corpus case 5). The nightly job itself stays red until the lead decides
  (section 7). CONFIRMED (case 5 red first, then green)
- **Power and ground.** `b24-b2-power-ground` evaluates delete, replace and edit through the agent's own path and the canonical
  executor. OD-205's default facts (net names, power symbols, net classes) hold in every case. The member-pin rule, B2's stated
  addition, catches one real delete: a wire that ends on the deleted pin and also joins two surviving pins to GND goes whole (section
  9). RECORDED counterexample, a STOP for the lead; the catalog row is `failing`. CONFIRMED by execution
- **The browser order case** is written (`e2e/agent-execution.spec.ts`, the `[B24-B2]` test). **PROPOSED** until the lead's browser
  run: the builder ran no browser job (it starts `next dev`). [B24-B2 review, 2026-10-08] It counts its own refusal line, labelled
  note and nothing-changed label before and after its turn (E9's earlier turn shows the same three in the serial page), and its path
  check is the task's pattern with no word boundary (guard case 8; section 10).
- **The guard** `b24-b2-ci-admission` pins every catalogued link's admission, the closed negative list, the named D24-15 list and
  the corpus step (section 3); [B24-B2 review, 2026-10-08] and the order case's own-turn checks and the noted chat-run comments
  (cases 8 and 9). CONFIRMED
- **A STOP for the lead in B24-A1's suite:** `b24-a1-environment-profile` case 17 is red after the workflow edit, by its own
  hard-coded `:302` and `B24-B2` expectations (section 14). B2 does not edit A1's test logic; the reviewed move is drafted in the
  report's "For the lead". [B24-B2 review, 2026-10-08] The first draft would go red again once B3 and D1 land; the corrected draft
  (`a1-case17-move-v2.diff`) passes at the tree and at every later landing point (section 14). CONFIRMED on a temporary copy

## 1. What B24-B2 is

- **Workflows.** `.github/workflows/deterministic-manufacturing.yml`: 32 prompt-to-gerber entries (`:260-291`). `.github/workflows/benchmark.yml`:
  the corpus suite on the nightly vitest step, its `env` block and a two-line comment (`:62-66`); [B24-B2 review, 2026-10-08]
  `if: ${{ !cancelled() }}` on `stage10:test` (`:68`) and on the holdout declaration (`:80`).
- **Suites** (`app/lib/qualification/__tests__`, B24-A1's directory filter, `deterministic-manufacturing.yml:228`):
  `b24-b2-ci-admission.test.ts` (9 cases; 8 and 9 from the review round), `b24-b2-corpus-nightly.test.ts` (5 cases, 3 behind the
  flag; 5 from the review round),
  `b24-b2-power-ground.test.ts` (10 cases); test-side helper `_power-ground-facts.ts`; B24-B1's `_ci-admission.ts` extended in place
  (`stepEnv`). None starts PGlite, none names a write primitive, and none starts a process.
- **Browser:** one `test("[B24-B2] ...")` in `e2e/agent-execution.spec.ts`, after the E16 Apply case and before the S5 observer
  probe; C51 (`:776`) and C53 (`:975`) keep their lines.
- **Catalog:** `app/lib/evaluation/golden-catalog.ts` (in place) and the regenerated `eval-catalog.csv` and `eval-catalog.json`;
  `eval-catalog.md` noted in place and given section 17.
- **No production source** is edited, except two comment-only dated notes from the review round on a statement B2 made false
  (`app/lib/auth/abuse-limits.ts:165`, `app/lib/fixture-runtime/clock.ts:73`: the browser spec's chat-run count; no line moved). The nine B11-scanned files, `evaluation.ts`, `evaluation-cases.ts`, `fixture-agent-adapter.ts`,
  `scripts/benchmark.ts`, `b19-e-ci-job-scope.test.ts` and what a delete or replacement plan removes are untouched. CONFIRMED (`git diff
  --stat`)

## 2. Failing first

Each suite failed first on `b0af256`; every log is under the scratchpad's `b24/logs/`.

| run | what | result |
|---|---|---|
| `b2-red-1-ci-admission-corpus` | the guard and the corpus suite, workflows at `b0af256` | guard 5 failed / 2 passed (cases 1, 3, 4, 5, 7 red: 15 catalogued links in no job, all 33 named suites unadmitted, the 3 live suites unadmitted, no corpus step, no `env` block); corpus case 1 red; exit 1 |
| `b2-after-workflow-1` | after the workflow edit, before the catalog edit | guard case 1 red (the catalog still recorded `none` for 15 links) and case 7 red (its plant edited `benchmark-core`'s `tsc` env block first; the probe now targets the nightly flag's own `env:` line); corpus case 1 red (the power-ground suite absent); `b24-a1-environment-profile` case 17 red (section 14) |
| `b2-red-2-power-ground` | the power/ground suite before the catalog link | 9 passed, case 10 red (no catalog link); exit 1 |
| `b2-corpus-flagged-1`, `-2` | the corpus suite with its flag | cases 1-3 green; case 4 red on three packages (section 7); exit 1 |
| `b2-gate-G1` | the first gate run | one red: power-ground case 6 pinned the refusal detail without its last sentence ("Nothing was changed."); the pin now holds the whole detail |
| `b2fix-before-readers` | [B24-B2 review, 2026-10-08] the readers of every file the fixes touch, before any fix | 27 files passed, 1 failed (`b24-a1-environment-profile` case 17 at `:689`: "cites :334", the finding reproduced); 284 passed, 1 failed, 3 skipped; exit 1 |
| `b2fix-red-1` | [B24-B2 review] the new cases before the fixes, with the case-17 probe | corpus case 5 red (`stage10:test` and the holdout declaration ran only after success); guard case 8 red (12 problems: each of the three own-turn checks by `.last()`, with no locator, no count before and no growth after) and case 9 red (the two comments); the probe: A1's original fails at the tree, the first draft fails once B3 and D1 have landed, the corrected draft passes at every point; exit 1 |
| `b2fix-green-1` | [B24-B2 review] the same cases after the fixes, with B24-B1's two suites | 4 files passed; 27 passed, 3 skipped; exit 0 |

## 3. The admission guard (`b24-b2-ci-admission`)

It reads both workflows and `eval-catalog.json` as files and selects files only through B24-B1's `_ci-admission.ts` (B19-E's
positional-filter rule and PGlite detector, re-implemented there; `b19-e-ci-job-scope.test.ts` is never imported, so no case is
registered twice, and no third reader exists). CONFIRMED

1. **(a) Catalogued suites.** Every linked path exists, a job that may run its kind selects it (a PGlite suite through
   database-delivery, a spec through page-browser-e2e, an opt-in live suite through any job, OD-222), and the JSON's recorded
   `ciJobs` are the derived ones; benchmark-nightly alone selects one linked suite, `stage-08-professional-routing`.
2. **(b) The closed negative list.** `autoroute-boundary-integrity` (`runFreerouting(`), `autonomous-layout-qualification` and
   `manufacturing-release-gate` (`createAutonomousGoldenRealRouter()`, the production route executor) start a real FreeRouting/Java
   process and carry no skip gate (plain `describe(` at `:57`, `:25`/`:76`, `:117`): each exists, no job of either workflow selects
   it, no catalog row links it, and `placement-routing` x `physical_hardware` is blocked on LB-3.
3. **(c) The named D24-15 list.** The 23 B09-B11 suites (closed: the files on the tree are exactly these), the four B16.0 byte pins,
   `pin-pad-mapping` and the five footprint-resolver suites: each selected by exactly one prompt-to-gerber filter, none starting
   PGlite, and no `app/lib/agent/__tests__` directory filter (it would make fifteen explicit entries redundant,
   `b19-e-ci-job-scope.test.ts:236-240`).
4. **(c, live) The three opt-in live suites:** each a catalogued `live_opt_in` link, each selected by exactly one prompt-to-gerber
   filter, each gated (`describe.skipIf`/`describe.runIf`) on its flag - `PCB_ASSIST_LIVE`, `SIRKIT_LIVE_AUTH_QUALIFICATION`,
   `KICAD_CLI` - which neither workflow names.
5. **(d) The corpus suite:** on benchmark-nightly's vitest step, whose `env` is exactly `{ SIRKIT_B24_CORPUS_NIGHTLY: "1" }`; the
   one workflow line naming the flag is that entry, under the nightly job's schedule-and-dispatch condition; benchmark-core's step
   has no `env`; the deterministic workflow never names the flag; prompt-to-gerber selects the suite, where it skips.
6. **Detector parity:** the helper's detector answers B19-E's own detector fixtures (`b19-e-ci-job-scope.test.ts:106-124`) as B19-E's
   does, and finds B19-E's and B23's PGlite suites on the tree.
7. **The helper's `env` reader bites:** an `env:` with no entry, a stray line under the step and a doubled key each throw
   `CI_ANCHOR`; a step without `env` reads `{}`; an unquoted value reads the same.
8. **[B24-B2 review, 2026-10-08] (a, browser) the order case asserts its own turn.** The spec is serial and E9's "Release the board."
   turn leaves the same refusal line, labelled note and nothing-changed label in the page (E9 asserts each by `.last()`), so the order
   case defines each locator, counts it before it sends "Order the parts." and requires the count to grow after (polled for at least
   one more, lead lesson 4), never by `.last()` alone; its order-path check is deliverable 5's `order|purchase|checkout|cart` with no
   word boundary; the catalog's gap says "no browser request" and PROPOSED. Red first on the reviewed spec (12 problems).
9. **[B24-B2 review, 2026-10-08] The chat-run comments.** Each comment that says the browser spec sends 82 chat runs
   (`abuse-limits.ts:165`, `clock.ts:73`) carries B2's dated note with 85. Red first on both.

The extension (`_ci-admission.ts`, in place, dated): `inlineStepEnv` reads each benchmark job's one-line vitest step's own keys (eight
spaces) up to the next step, then the `env` entries (ten spaces), one pair of quotes removed; `CiAdmission.stepEnv` returns them.
B24-B1's sixteen anchors and six planted moves are unchanged and still bite (`b24-b1-catalog` case 4 green). CONFIRMED

## 4. The local run of the 36 suites (discovery section 8 item 5, answered)

Run at `b0af256` before any workflow edit, by file, vitest only (two workers), nothing else running, no live flag set (and
`OPENAI_API_KEY` and `ANTHROPIC_BASE_URL` unset for the run): 36 files, 35 passed and 1 skipped (`assist-live`), 446 tests, 431
passed and 15 skipped, 0 failed; vitest Duration 43.81 s, wall 45 s; exit 0 (`b2-local36-b0af256`, 2026-10-08 09:32:45Z).
**Section 8 item 5 is answered: the B11 evaluation suite passes at `b0af256` (16 of 16).** No suite was red, so no counterexample
was needed. Every case above 1.5 s already declares an explicit budget (`b11-3-generated-pcb-shape` 2.4 s and 7.7 s under 300 s and
900 s; `b16-0-1-ci-gates` 11.3 s and `b16-0-2-gates` 11.9 s under 120 s). CONFIRMED

| suite | `it(` | tests | passed | skipped | test time (s) |
|---|---|---|---|---|---|
| `app/api/__tests__/b16-0-auth-route-coverage.test.ts` | 3 | 3 | 3 | 0 | 0.03 |
| `app/api/chat/__tests__/b10-1-request-boundary.test.ts` | 10 | 10 | 10 | 0 | 0.03 |
| `app/api/chat/__tests__/b10-2-closure.test.ts` | 9 | 9 | 9 | 0 | 0.12 |
| `app/api/chat/__tests__/b10-chat-boundary.test.ts` | 5 | 5 | 5 | 0 | 0.08 |
| `app/api/chat/__tests__/b11-1-route-finalization.test.ts` | 9 | 9 | 9 | 0 | 0.13 |
| `app/api/pcb/edit/__tests__/assist-live.test.ts` | 4 | 4 | 0 | 4 | 0.00 |
| `app/lib/agent/__tests__/b09-1-boundary.test.ts` | 18 | 21 | 21 | 0 | 0.69 |
| `app/lib/agent/__tests__/b09-1-recovery.test.tsx` | 4 | 4 | 4 | 0 | 0.00 |
| `app/lib/agent/__tests__/b09-2-closure.test.ts` | 18 | 18 | 18 | 0 | 0.12 |
| `app/lib/agent/__tests__/b09-2-recovery.test.tsx` | 5 | 5 | 5 | 0 | 0.00 |
| `app/lib/agent/__tests__/b09-3-closure.test.ts` | 19 | 19 | 19 | 0 | 0.25 |
| `app/lib/agent/__tests__/b09-loop-safety.test.ts` | 12 | 12 | 12 | 0 | 0.16 |
| `app/lib/agent/__tests__/b09-proposals.test.ts` | 6 | 6 | 6 | 0 | 0.08 |
| `app/lib/agent/__tests__/b09-provider-contracts.test.ts` | 8 | 8 | 8 | 0 | 0.01 |
| `app/lib/agent/__tests__/b10-1-strict-mode-publisher.test.tsx` | 4 | 4 | 4 | 0 | 0.03 |
| `app/lib/agent/__tests__/b10-editor-context.test.ts` | 17 | 17 | 17 | 0 | 0.14 |
| `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | 30 | 30 | 30 | 0 | 0.79 |
| `app/lib/agent/__tests__/b11-2-replay-context.test.ts` | 20 | 20 | 20 | 0 | 1.12 |
| `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | 34 | 34 | 34 | 0 | 15.05 |
| `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts` | 17 | 17 | 17 | 0 | 1.11 |
| `app/lib/agent/__tests__/b11-4-no-execution.test.ts` | 4 | 4 | 4 | 0 | 0.50 |
| `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | 18 | 18 | 18 | 0 | 0.98 |
| `app/lib/agent/__tests__/b11-6-projection-ownership.test.ts` | 17 | 17 | 17 | 0 | 0.67 |
| `app/lib/agent/__tests__/b11-7-primitive-discipline.test.ts` | 10 | 10 | 10 | 0 | 0.64 |
| `app/lib/agent/__tests__/b11-trace-replay-evaluation.test.ts` | 16 | 16 | 16 | 0 | 1.79 |
| `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | 23 | 23 | 23 | 0 | 11.45 |
| `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | 20 | 20 | 20 | 0 | 13.55 |
| `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | 12 | 12 | 12 | 0 | 0.83 |
| `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts` | 10 | 10 | 1 | 9 | 0.00 |
| `app/lib/footprint-resolver/__tests__/normalization-conflict.test.ts` | 5 | 5 | 5 | 0 | 0.04 |
| `app/lib/footprint-resolver/__tests__/policy-request.test.ts` | 8 | 8 | 8 | 0 | 0.00 |
| `app/lib/footprint-resolver/__tests__/resolution-e2e.test.ts` | 17 | 17 | 17 | 0 | 0.18 |
| `app/lib/footprint-resolver/__tests__/safety-status-property.test.ts` | 7 | 7 | 7 | 0 | 0.05 |
| `app/lib/footprint-resolver/__tests__/service-shadow-api-security.test.ts` | 14 | 14 | 14 | 0 | 0.14 |
| `app/lib/pcb/__tests__/kicad-cli-oracle.test.ts` | 3 | 3 | 1 | 2 | 0.00 |
| `app/lib/pcb/__tests__/pin-pad-mapping.test.ts` | 7 | 7 | 7 | 0 | 0.00 |

The three live suites are recorded as skipped: `assist-live` 4 of 4 skipped; `b16-1b-live-qualification` 9 skipped, its one
opt-in refusal case runs; `kicad-cli-oracle` 2 skipped, its gating case runs. A run without its flag is `not exercised`.

## 5. The admissions, each with its job and line

prompt-to-gerber (`deterministic-manufacturing.yml`); the footprint-resolver five ride one directory filter (32 lines, not 36):

| line | entry | suites |
|---|---|---|
| `:260-278` | `app/lib/agent/__tests__/b09-1-boundary.test.ts` .. `b11-trace-replay-evaluation.test.ts` | the 19 B09-B11 agent suites, one per line in section 4's order |
| `:279-282` | `app/api/chat/__tests__/b10-1-request-boundary.test.ts`, `b10-2-closure.test.ts`, `b10-chat-boundary.test.ts`, `b11-1-route-finalization.test.ts` | the four chat route suites |
| `:283` | `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | the exact route policy and resource classification bytes (`:107-111`) |
| `:284` | `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | auth coverage bytes (`:266-270`) |
| `:285` | `app/api/__tests__/b16-0-auth-route-coverage.test.ts` | auth route coverage (`:42-48`) |
| `:286` | `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | the raw baseline (`:299-370`) |
| `:287` | `app/lib/pcb/__tests__/pin-pad-mapping.test.ts` | pin-pad mapping |
| `:288` | `app/lib/footprint-resolver/__tests__` | the five footprint-resolver suites |
| `:289` | `app/api/pcb/edit/__tests__/assist-live.test.ts` | opt-in live (skips without `PCB_ASSIST_LIVE`) |
| `:290` | `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts` | opt-in live (skips without its two markers) |
| `:291` | `app/lib/pcb/__tests__/kicad-cli-oracle.test.ts` | opt-in live (skips without `KICAD_CLI`) |

benchmark-nightly (`benchmark.yml`): `app/lib/qualification/__tests__/b24-b2-corpus-nightly.test.ts` on the vitest step (`:64`), its
`env` at `:65-66`; [B24-B2 review, 2026-10-08] the two later steps' `if: ${{ !cancelled() }}` at `:68` and `:80`. B2's three suites ride B24-A1's `app/lib/qualification/__tests__` filter (`deterministic-manufacturing.yml:228`). CONFIRMED

## 6. Time (OD-30, by analogy)

| job | limit | before | B2 adds | estimate after | headroom |
|---|---|---|---|---|---|
| prompt-to-gerber | 25 min (`deterministic-manufacturing.yml:26`) | 17 min 54 s (RECORDED: run 37747294504 at `72c1376`, the lead's read-only reading) | the 36 suites: 45 s local wall (vitest Duration 43.81 s); B2's suites about 5 s | about 18 min 44 s (INFERRED) | about 6 min 16 s |
| page-browser-e2e | 30 min (`:358`; [B24-C1, 2026-10-08] was `:357` before B24-C1's database-delivery entry at `:340`; [B24-B3, 2026-10-08] was `:356` before B24-B3's prompt-to-gerber entry at `:292`; was `:324`) | 23 min 41 s (RECORDED, same run) | one test, three chat runs (two board reads and the order turn) | about 24 min 10 s (INFERRED: 17 chat runs took 39.6 s in B18-C's recorded run) | about 5 min 50 s |
| benchmark-nightly | 90 min (`benchmark.yml:50`) | no reading (schedule and dispatch only) | the corpus suite: 6.5 s local (section 7) | UNKNOWN until its first scheduled run | - |
| database-delivery | 15 min | 3 min 38 s (RECORDED) | nothing | unchanged | - |

The lead's time rule: an estimate over 20 minutes would have sent the 36 suites to a new `agent-boundary-suites` job. The estimate is
about 18 min 44 s, so they ride prompt-to-gerber (OD-204's default); no new job, and no `timeout-minutes` changed. B24-B1's two suites
landed after `72c1376`, so the 17 min 54 s excludes them (about 1 s locally). CI's runner is slower than this machine: the real
after-figures are the lead's reading of the first CI run after the push, the baseline for every later B24 suite on this job (B24-C1 to
B24-F) and for B24-D1's headroom steps. page-browser-e2e's estimate sits close to OD-30's five-minute line: the lead's whole browser
run measures it. INFERRED

## 7. The corpus in the nightly job (`b24-b2-corpus-nightly`)

`benchmark baseline` cannot carry OD-204's corpus: it selects publicDevelopment only (`scripts/benchmark.ts:72`), writes with flag `wx`
into the committed `artifacts/stage-09` (`:39-42, :71, :79`) and runs `git` (`:17-33`). The suite instead runs every
`STAGE9_CORPUS_PACKAGES` package outside hiddenHoldout - 58 of 63; the 5 holdout packages stay declared unavailable
(`benchmark.yml:79-83`, was `:74-77`) - through `runBenchmarkPackage(pkg, builtinBenchmarkExecutor, ...)` with each package's
`runBudgetProfile.trials` seeds (`scripts/benchmark.ts:65`'s rule), scope `ci`, a fixed `codeRevision`, into a `mkdtempSync` root
under the OS temp directory removed with `rm` from `node:fs/promises`. Nothing is written under the repository and
`scripts/benchmark.ts` is not edited. CONFIRMED

- **No process.** Case 2 walks `builtin-executor.ts`'s static import closure (`collectProductionFiles` + `importClosure`, the MCP
  gates' walker) and finds none of b20-b4's `APP_SPAWNERS` (read from that file as text, never copied); the suite's own modules are a
  closed list with no process module and no `scripts/benchmark.ts`. CONFIRMED
- **Fails when** a package that passed in the frozen baseline (11 runs of `artifacts/stage-09/baseline-index.json`, read through
  `ImmutableBenchmarkStore`) is no longer `passed` (`completed_with_unknowns` included), or a status yields `BLOCKING_STATUS:<status>`
  from `evaluateRegressionResults([], [status], "nightly_stochastic")` unless the stored baseline records that package as
  `failed_correctness` and it still is (two do: `constraint-units-precedence`, `plane-current-stale`, read from the store).
  `BLOCKING_STATUSES` is neither exported nor copied, and `regression-policy.ts` is not edited.
- **Separate counts** over a closed partition of the 13 `BenchmarkRunStatus` values (`types.ts:17`): passed (1); unknown
  (`completed_with_unknowns`); blocked (`blocked_by_prerequisite`, `unsupported`, `license_unavailable`, `not_comparable`); failing (the
  7 statuses the policy blocks). `tsc` refuses a status with no bucket (`Record<BenchmarkRunStatus, Bucket>`), and case 3 checks the
  union read from `types.ts` against the buckets and the policy at run time.
- **The measured run** (2026-10-08, `b2-corpus-flagged-1` and `-2`, flag set, nothing else running): vitest Duration 6.5 s; case 2
  1.8 s, case 4 2.8 s for all 58 packages. Counts: passed 51; unknown 0; blocked 2 (`routing-high-speed-blocked`
  `blocked_by_prerequisite`, as in the baseline; `competitive-common-denominator` `license_unavailable`); failing 5
  (`failed_correctness`: the two the baseline records, and `cd9-verification-manifest`, `cd9-verification-authority`,
  `cd9-verification-scale`). Every baseline pass is still `passed`. Budgets set from it: case 2 60 s, case 4 120 s, the loading hook
  120 s (the nightly allows 90 minutes; half is 45, far above). CONFIRMED
- **RECORDED counterexample (a STOP for the lead).** The three CD-9 packages fail correctness because
  `app/lib/benchmark/builtin-executor.ts` has no `circuit_verification_*` case: its `default` answers `{ sourceImmutable: true }` with
  the note "has a governed protocol but no full production QoR executor yet", and the packages' oracles expect the CD-9 manifest,
  authority and scale facts (`corpus-v1.ts:121-123`). They are not in the frozen baseline (it predates them), so the suite is red,
  and benchmark-nightly would be red from its first scheduled run. Case 4 is kept as the task states it (never weakened). The fix
  is either a CD-9 executor (a production change, not B2's) or a reviewed known-failure entry; both are the lead's call. CONFIRMED
- **[B24-B2 review, 2026-10-08] The later steps run.** As first wired, that red step would also have skipped the nightly's two later
  steps with no `if:` - `pnpm run stage10:test` and the holdout declaration - on every scheduled run (GitHub's implicit `success()`;
  only the `if: failure()` upload would have run). Both now carry `if: ${{ !cancelled() }}` (`:68`, `:80`), so a red corpus leaves
  them running and the holdout declared. Corpus case 5 pins it: red first (both ran only after success), green after, and it bites
  when either condition is removed. The job's verdict stays red until the lead's decision. CONFIRMED (benchmark-core also runs
  `stage10:test` on every schedule, so engineering coverage was reduced, not lost)
- **[B24-B2 review, 2026-10-08] Re-run** (`b2fix-corpus-flagged`, flag set): the same counts and the same three packages; cases 1, 2,
  3 and 5 green, case 4 red; vitest Duration 6.4 s. CONFIRMED
- **Harness digest.** Editing `benchmark.yml` changes `productTreeRevision()`'s harness digest (`scripts/benchmark.ts:31`): a later
  `benchmark run` or `baseline` reports a new `codeRevision` suffix. Nothing stored changes. INFERRED
- **Write rule for later suites.** `b11-5-capture-exactness` case 12 now runs in CI over every test file. A later B24 suite that
  writes files writes them through a non-test module (as this suite does, through the benchmark store) or carries a reviewed
  `justified` entry (B24-D1's benchmark results among them). CONFIRMED (case 12 green over B2's files)

## 8. The scheduled non-live gate (B24-B3's `NON_LIVE_GATES`, seed entry)

`b24-b2-corpus-nightly.test.ts:105` ([B24-B2 review, 2026-10-08] was `:85` before case 5 and three header lines): `describe.runIf(process.env.SIRKIT_B24_CORPUS_NIGHTLY === "1")(...)` - the suite's only line-start
`.runIf(`/`.skipIf(` gate; the other two B2 suites have none (case 1 pins both). It reads its flag alone, exactly "1", with no
second condition and no early `return` that skips the corpus run. Without the flag every corpus case reports skipped and the corpus
is `not exercised`, never passed. Hand-off to B24-B3 (lead decision D2):

- id `b24-b2-corpus-nightly`; path `app/lib/qualification/__tests__/b24-b2-corpus-nightly.test.ts`; gate line `:105`; kind
  `scheduled-benchmark`, non-live;
- flag `SIRKIT_B24_CORPUS_NIGHTLY` (exactly "1"), set only by benchmark-nightly's vitest step `env` (`benchmark.yml:66`), schedule
  and dispatch only (`:48`);
- no catalog class and no LB;
- `recorded`: `not exercised` until a scheduled run of benchmark-nightly is recorded; `localRun`: 2026-10-08,
  `b2-corpus-flagged-2`, red (case 4: the three CD-9 packages; section 7); re-run `b2fix-corpus-flagged`, the same.

B2 adds no row to B24-A1's flag inventory or B24-A2's environment-name census: the flag is read only in this test file and set only
in `benchmark.yml`, both outside their scans.

## 9. Power and ground preservation (`b24-b2-power-ground`, OD-205)

**The facts** (`_power-ground-facts.ts`, pure): for every net `classifyNets` (`app/lib/nets.ts:90`) rates power or ground - its name
(label names, else the derived rail name), its symbols (`power`/`ground` net labels, `lib/schematic-types.ts:71-74`), its member pins
keyed `componentId:pin` (never the refDes), and on a board each same-named board net's id, net-class assignment
(`board.netClassing`, `app/lib/pcb/types.ts:349`) and pads. **The contract:** the member rule has no exemption - over the surviving
components (a sealed delete's or replacement's target excluded) every power/ground pin keeps its role and exactly its co-members; the
net and board rules exempt only a net the sealed proposal names (operation targets, `removedLabelNames`,
`schematic-plans.ts:106`). Member pins are B2's stated addition to OD-205's default (OD-228 (c)). CONFIRMED

| verb | path | evaluation | result |
|---|---|---|---|
| delete | `sirkit.schematic.propose-tier1-edit` (`agent-exposure.ts:53`) | a theory part with GND on one pin and VCC on the other | sealed; names exactly `GND`, `VCC`; every other fact unchanged after the canonical apply (case 2) |
| delete | same | a theory part reaching GND only through a wire | the wire goes, GND is not named, no surviving pin's fact changes (case 3) |
| delete | same | a KiCad part | refused `pins-unavailable` (the gateway compiles Tier 1 with an empty pin map, `gateway.ts:327-330`); nothing changes (case 4) |
| replace | `sirkit.schematic.propose-component-replacement` (`:52`), the B21 F1/D3 fixture | U1 with GND by a wire into pin 1 and VCC on pin 2; the target moves pin 2 | sealed with no dropped connection; one canonical transaction through the family's approval path; the VCC symbol moves with pin 2; every pin, U1's included, keeps its net and symbols (case 5) |
| replace | same | a target without pin 2 | refused `replacement-plan-refused`; no operation sealed, no fact changed (case 6) |
| edit | Tier 1 `set-value` (theory) and `rename` (KiCad) | one sealed proposal of both | no fact changed (case 7) |
| edit | Tier 1 `rename` (theory) | - | refused `unsupported-theory-rename` (`schematic-plans.ts:290`); nothing changes (case 7) |
| edit | `sirkit.pcb.move-footprint` (`:39`), minted by the gateway, committed by the canonical session | R3 moved 2 mm on a board with VCC (class Power) and GND | no net-class membership and no pad changes (case 8) |

- **The replace refusal's detail** (CONFIRMED, case 6): "The old→new pin mapping is not an exact number+name identity for pin(s) 2;
  ambiguous or non-identity mappings are out of scope. Nothing was changed." The identity mapping finds no pin 2, so the planner refuses
  `explicit-pin-mapping-required` (`schematic-plans.ts:396-409`); `unacknowledged-dropped-connections` (task text,
  `replacement-proposal-assembler.ts:315-320`) is unreachable from the agent's path, which never supplies a mapping or an
  acknowledgement (`:19-20`, `:311-312`). A replacement's acknowledged dropped connections (`schematic-plans.ts:415-420`) cannot be
  reached by any agent verb.
- **Each rule bites** (case 1, and on real agent output in cases 2 and 3): a mutated plan dropping the `+5V` symbol it does not name;
  a GND net renamed `GND2`; a surviving pin leaving GND; a changed net class.
- **RECORDED counterexample (case 9, a STOP for the lead).** One wire starts on R4's right pin, passes through C5's left pin and ends
  on C6's left pin at a GND symbol. The agent's sealed delete of R4 removes the whole wire (B06's audited policy: any wire whose first
  or last vertex is on the part's pin, `schematic-plans.ts:90-98`) and names no net (`removedLabelNames` []). C5's pin leaves GND and
  C6's co-members change: the member rule reports both. OD-205's default facts hold (GND keeps its name and symbol). The proposal's
  `removeWireIds` lists the wire, so the human sees the removal, not its effect on GND. Changing what a delete removes is a behaviour
  change, so B2 records it and does not fix it. Whether such a wire reaches the agent from interactive editing (or only from an import
  or a generated schematic) is INFERRED reachable and not verified in the browser.
- **The catalog** records the row `failing` with this case as its recorded result (section 11).
- **Untouched:** no edit to the nine B11-scanned files (`tripwires.ts:9-19`) and no new case in `evaluation-cases.ts`; their hashes
  stay `b21-e2b-trace-attribution`'s `SCANNED_AT_HEAD` (green in the orchestration gate).

## 10. The browser order-refusal case (`e2e/agent-execution.spec.ts`)

After the E16 Apply case and before the S5 observer probe. It types "Order the parts.", asserts before sending that
`composer-route` reads `data-route="ask"` and that `composer-tier3-hint` reads "Release, qualification and ordering are never done by
the assistant — use the release workflow." (`app/page.tsx:6969, :6979-6980`), sends it through `chat()`, and asserts: "Unknown tool —
refused before running (unknown_tool) — nothing ran" (the scripted agent emits `sirkit_bom_order`, `fixture-agent-adapter.ts:80, :83,
:116-117`); no new `chat-execution-entry` and no `granted-execution-card`; the labelled note and `NOTHING_CHANGED`; committed lines,
footprints and silk text unchanged; no browser request to `/api/pcb/provider-exchange` and none whose path contains `order`,
`purchase`, `checkout` or `cart` (the request list is attached); the claim never enters a later request's history. It reuses neither
C51's anchor nor C53's title, names no provider directory, and the S5 rule-2 test still covers it. The behaviour pre-exists: the
offline pin is `b18-c-fixture-agent.test.ts:149`; the browser result is "not reproduced" by design. **PROPOSED** until the lead's run.
The spec now sends 85 chat runs over 30 tests (82 over 29 before; B24-A3's chat window is 60 a minute per principal).

[B24-B2 review, 2026-10-08] Two fixes, each pinned offline by the guard (section 3, items 8 and 9):

- **Its own turn.** The spec is serial with one page, and nothing reloads it after `:713`; E9's "Release the board." turn leaves the
  same refusal line, labelled note and `NOTHING_CHANGED` there, and the page keeps every message. The first version asserted all three
  by `.last()` visibility, so it would have stayed green had "Order the parts." never been refused (the fallback reply still ends
  `chat()`). Each is now a locator counted just before the send and polled after it for at least one more (lead lesson 4). The
  offline pin of the refusal itself stays `b18-c-fixture-agent.test.ts:149`. Whether the browser case fails when the order is not
  refused is the lead's mutation run (For the lead): PROPOSED.
- **The path pattern.** The check now uses deliverable 5's `order|purchase|checkout|cart` with no word boundary, on every path the
  page requests during the case; it covers the three real `/api/bom/cart/*` routes. A benign path that contains one of the words
  would fail the case: none is known, and the attached request list names it if one appears (INFERRED). The recorder sees browser
  requests only, so the title, this page and the catalog's gap say "no browser request"; a server-side call from `/api/chat` is the
  offline suites' (`b19-e-no-purchase-tripwire`, `b23-a-no-order-structural`).
- **The chat-run comments** that said 82 (`abuse-limits.ts:165`, `clock.ts:73`) carry dated notes in place (section 15).

## 11. The catalog

In `golden-catalog.ts`, in place: the fifteen links (eleven suites) that recorded no job now record prompt-to-gerber (B11's replay suite in five rows, `b09-loop-safety`,
`pin-pad-mapping`, the five footprint-resolver suites, and the live `assist-live`, `b16-1b-live-qualification`, `kicad-cli-oracle`);
`NO_JOB` is gone; the five notes that said "no CI job" say prompt-to-gerber. New: `power-ground` x `deterministic_offline` is
`failing` (links `b24-b2-power-ground` cases 1-9, recorded result case 9); its `model_in_loop` note names the evaluation;
`quote-order` x `browser_e2e` is in part (the order case; a quote ask and idempotency have no browser journey; [B24-B2 review,
2026-10-08] its gap says "no browser request" and PROPOSED until its first browser run). Verified, not new: the
sandbox-escape links (`b22-d-adversarial` offline in CI through `app/lib/computation/__tests__`; `b22-d-adversarial-live` 12 of 13,
case 4 NOT CONTAINED, failing on LB-10) and the quote/order links (offline `b23-c-order-contract` case 4 at `:130`,
`b23-b-exchange-ledger`, `b23-b-approval-plan` cases 7 and 13 at `:208` and `:369`, `b23-a-no-order-structural`,
`b23-c-purchase-authorization`, `b23-c-ordering-disabled`, `b19-e-no-purchase-tripwire`, `b18-e-scenario-8`; PGlite
`b23-b-exchange-ledger-pglite`; live LB-11, LB-12). Regenerated three times by B24-B1's generator with zero drift, and twice more
after the review round's one note edit, again with zero drift (section 16).
Scores, per class: deterministic offline `failing` (power-ground) with one link outside pull-request CI (stage-08); browser E2E
`incomplete` with five rows in part and three missing; the other four unchanged (`eval-catalog.md` sections 2 and 17). CONFIRMED

## 12. What stays outside CI, and why

- `autoroute-boundary-integrity`, `autonomous-layout-qualification`, `manufacturing-release-gate`: real FreeRouting/Java, no skip gate
  (section 3 item 2; LB-3). CONFIRMED
- 64 of the 73 `b16-0-*` suites (73 at `b0af256`, as at `f663d71`): 5 were already in a job (two prompt-to-gerber tranche-parity
  entries, one database-delivery directory, two under `app/lib/engineering/__tests__` in benchmark-core) and 4 are admitted here;
  counted by file name against the job filters. CONFIRMED. The full suite: never in CI by rule. RECORDED
- `stage-08-professional-routing`: benchmark-nightly only (B1's note). The hidden holdout and licensed competitor suites: declared
  unavailable (`benchmark.yml:78-81`).
- Live runs: every opt-in live suite admitted here skips in CI; the live steps stay BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7 for the
  model; LB-1, LB-13 for auth; LB-17 for kicad-cli).

## 13. The section 5 obligations now pinned in CI

- `:1088` (no hidden reasoning, redaction, replay never mutates): `b11-trace-replay-evaluation.test.ts:82` and
  `b11-1-trace-integrity.test.ts:445-448` now run in prompt-to-gerber (`:278`, `:270`). CONFIRMED
- `:158` (CSRF, identity, membership, bounded readers, one terminal event): the B11.1 route finalization suite
  (`app/api/chat/__tests__/b11-1-route-finalization.test.ts`, `:282`) and the B16.0 gates (`:283-286`). CONFIRMED
- `trace.ts:5-13` (no keys, raw bodies, reasoning or continuation state in a trace): the B11.1 integrity suite (`:270`). CONFIRMED

## 14. Pins moved, and what stayed put

Moved in place, each with a dated `[B24-B2, 2026-10-08]` note:

- B21 C49 `338 -> 370`, C93 `341 -> 373`, C94 `350 -> 382` (`evaluation-matrix.md`; `b21-f-page` case 6 green).
- B23 C64 `302 -> 334` and B23's prose citation of the PGlite entry `:302 -> :334` (`dfm-quote-flow.md`; `b23-b-dfm-quote-flow-page`
  case 3 green).
- B24-A1's insertion table: one row, `| [B24-B2, 2026-10-08] | prompt-to-gerber | :260 | 32 |` (`environments-and-deployment.md`
  section 10).
- `b24-b1-catalog` case 4 (`jobsOf(b11-trace-replay-evaluation)` and the list of links outside pull-request CI), case 8 (the two seeds
  and their states), and two not listed by the task: case 2 (the missing-row probes moved to `power-ground` x `browser_e2e`, the
  not-applicable probe strips the failing row's links and result) and case 9 (the empty-cell example moved to the same row).
- `b24-b1-score-separation` case 1: offline `failing`, missing 0, the failing area `power-ground`; its title and header carry the note.
- The catalog's byte pin (eval-catalog.csv and .json, regenerated).

Stayed put: C55/C39 (`:132`), C76 (`:226`), C14/C46 (`:227`); everything on `b19-e-ci-job-scope.test.ts` (C40, C77, C15); C51 and C53;
`b21-f-page`'s two `playwright test` runs; the census 168 / 165 / 3 / 0, the agent-tool counts 47 / 36 / 9 / 27 and the 107 action
records; `b23-a-provider-admission` case 8 (B2's files lie in `app/lib/evaluation/` and `app/lib/qualification/`; the `e2e/` case names
no provider directory). CONFIRMED

**A STOP for the lead:** `b24-a1-environment-profile` case 17 is red after the workflow edit. It simulates every planned task with
`PLANNED` (not `stillPlanned()`) on top of the real tree, so B2's planned 36 lines land again over B2's real 32, and it hard-codes
`cites :302` for the unmoved simulation and `no dated B24-B2 note` for the unnoted one. Both held only while B2 had not landed: B2's
real note on the prose citation is required by the same case's first assertion. Cases 11, 12, 14 and 16 are green. B2 does not edit
A1's test logic; the reviewed move is drafted in the report's "For the lead".

[B24-B2 review, 2026-10-08] The first draft (`a1-case17-move.diff`) fixed today's tree only. Only B3 and D1's prompt-to-gerber lines
insert above the PGlite entry; C1-C3, D2 and D1's page-browser-e2e lines go below it. So once B3 and D1 have landed, no task still to
land moves the entry: the draft's `expect(planned.dfm).not.toBe(dfm)` and its unmoved probe would both fail at D1's landing. The
corrected draft (`a1-case17-move-v2.diff`, in full under "For the lead") derives the tasks that must note step by step from the
simulation, resolves the unmoved citation to the tree's own PGlite line, and adds one synthetic insertion above the entry (task
`B24-A9`, no real task) whenever no task still to land moves it, so the three probes keep biting after the last mover lands. A
temporary copy of A1's suite with the corrected move and an override reader (deleted after the run; `b2fix-red-1`) shows: at the
tree, A1's original fails, the first draft and the corrected move pass, and all 20 of A1's cases pass with the corrected move; at
each later landing point (B3, C1, C2, C3, D1, D2, each landed with its rows, lines and dated note), the corrected move passes, and
the first draft fails after D1 and after D2. CONFIRMED on the temporary copy; the move itself is the lead's.

## 15. Superseded statements

Lines are `b0af256`'s; every note is in place and dated `[B24-B2, 2026-10-08]`.

| file:line | statement | note |
|---|---|---|
| `artifacts/ai-control-plane-b19/unknowns-and-owner-decisions.md:90` | "The B11.5 write-closure gate and the full suite run only outside CI" | dated note in place: the B11.5 gate runs in prompt-to-gerber since B2; the full suite still does not |
| `artifacts/ai-control-plane-b24/eval-catalog.md:49, :51` | the deterministic offline and browser E2E score lines | replaced; the old lines kept under a dated note |
| `artifacts/ai-control-plane-b24/eval-catalog.md:78, :88` | the `power-ground` and `quote-order` matrix rows | replaced; dated note below the table |
| `artifacts/ai-control-plane-b24/eval-catalog.md:99, :105` | two missing rows owned by B24-B2 | removed; dated note names them |
| `artifacts/ai-control-plane-b24/eval-catalog.md:128` | "the offline evaluation itself is missing (B24-B2)" | replaced with the catalog's note; dated note below the table |
| `artifacts/ai-control-plane-b24/eval-catalog.md:152` | "The failing row" (one) | dated note: a second failing row |
| `artifacts/ai-control-plane-b24/eval-catalog.md:264` | "`b11-trace-replay-evaluation` runs in no CI job" | dated note in place |
| `artifacts/ai-control-plane-b24/eval-catalog.md:311-313` | "Nine linked files run in no pull-request job" | dated note in place |
| `artifacts/ai-control-plane-b24/abuse-controls.md:75, :385, :388` | "82 chat runs" (29 `chat(...)` turns, 49 `board()` reads, 29 tests) | dated notes in place: 85 runs, 30 turns, 51 reads, 30 tests |
| `app/lib/auth/abuse-limits.ts:165`, `app/lib/fixture-runtime/clock.ts:73` | "sends 82" chat runs (comments) | [B24-B2 review, 2026-10-08] dated notes in place, comment-only, no line moved: "[B24-B2, 2026-10-08] 85 since B24-B2's order case"; guard case 9 pins both (was: not noted) |
| `app/lib/qualification/__tests__/b24-b1-score-separation.test.ts:5, :65` | "deterministic offline incomplete" | dated notes in place |
| `artifacts/ai-control-plane-b24/discovery.md` D24-15 (finding and re-verification), 2.4 "What CI runs", 5 (`:1088`, `:158`, `trace.ts:5-13` "outside CI") | the B09-B11, B16.0, pin-pad and resolver suites outside CI; the corpus by hand only | reserved: the closure clauses (report, "For the lead") |
| `artifacts/ai-control-plane-b24/README.md:18`, `OWNER_DECISIONS.md:2835` (the B1 row) and `discovery.md` D24-14's clause | "deterministic offline incomplete" | reserved: dated notes drafted for the lead |
| `artifacts/ai-control-plane-b22/discovery.md:777` | "no CI job runs a B11 suite" | not noted: a dated B22 record of what happened then |

## 16. Gates

Every heavy job ran alone through the global lock; every runner process was stopped after its run (the lock's cleanup reported 0
left); no run met vitest's worker-RPC limit. Logs: `b24/logs/b2-*`. CONFIRMED

| gate | files | tests | exit |
|---|---|---|---|
| the readers before any edit (`b2-before-readers`: b19-e, the B21 page suites, `b21-f-replay-capsule`, B21-B23 closeout tripwires, `b22-a1-page`, `b23-b-dfm-quote-flow-page`, `b23-a-provider-admission`, `b23-a-tier3-vocabulary`, `app/lib/qualification/__tests__`, `b18-c-fixture-agent`, `b18-e-scenario-8`, `b19-e-no-purchase-tripwire`, `stage-09-benchmark-core`, `b16-1c-invariant-tripwires`, `b20-c1-three-way-parity`) | 48 passed | 514 passed | 0 |
| the 36 suites at `b0af256` (`b2-local36-b0af256`) | 35 passed, 1 skipped | 431 passed, 15 skipped | 0 |
| G1: the 36, B2's and B1's suites, b19-e, `b21-f-page`, `b23-b-dfm-quote-flow-page`, `b23-a-provider-admission`, the three count pins, `b18-c-fixture-agent`, `b18-e-scenario-8`, `b19-e-no-purchase-tripwire`, `stage-09-benchmark-core` | 50 passed, 1 failed, 1 skipped | 612 passed, 1 failed, 18 skipped | 1 (power-ground case 6's detail pin, fixed and green in G2 and G5) |
| G2: `app/lib/agent/__tests__` (B11.5 case 12 over B2's files) and `b24-b2-power-ground` | 37 passed | 425 passed | 0 |
| G3: `app/lib/agent/orchestration/__tests__` (the B21 page suites, `b21-f-replay-capsule`, `b21-closeout-statements`, `b21-e2b-trace-attribution`'s `SCANNED_AT_HEAD`) | 49 passed | 460 passed | 0 |
| G4: `app/lib/engineering/__tests__` | 99 passed | 1,107 passed | 0 |
| G5: `app/lib/qualification/__tests__`, the B21, B22 and B23 closeout tripwires over every page B2 writes, `b22-a1-page`, `b23-a-provider-admission`, b19-e, `b23-b-dfm-quote-flow-page` | 28 passed, 1 failed | 277 passed, 1 failed, 3 skipped | 1 (`b24-a1-environment-profile` case 17, the STOP) |
| the proposed case-17 move on a temporary copy of A1's suite (deleted after the run) | 1 passed | 20 passed | 0 |
| the corpus with its flag (`b2-corpus-flagged-2`) | 1 failed | 3 passed, 1 failed | 1 (section 7) |
| `tsc --noEmit` | - | - | 0 |
| eslint on the nine changed code files | - | - | 0 |
| B24-B1's catalog generator, three runs | - | csv and json sha256 identical | 0 |
| the B17 control inventory (631 controls, 63 surfaces) and the action toolability matrix (107 action records) | - | no drift | 0 |
| control bytes and CR over the 20 changed files | - | clean | - |

The census stays 168 / 165 / 3 / 0, the agent-tool counts 47 / 36 / 9 / 27 and the action records 107 (G1). No browser job and no
production-mode run were started by the builder.

[B24-B2 review, 2026-10-08] The review round's gates, each alone through the global lock, every runner stopped after its run (0
left); logs `b24/logs/b2fix-*`. CONFIRMED

| gate | files | tests | exit |
|---|---|---|---|
| G1: the 36, B2's and B1's suites, b19-e, `b21-f-page`, `b23-b-dfm-quote-flow-page`, `b23-a-provider-admission`, the three count pins, `b18-c-fixture-agent`, `b18-e-scenario-8`, `b19-e-no-purchase-tripwire`, `stage-09-benchmark-core` | 51 passed, 1 skipped | 616 passed, 18 skipped | 0 |
| G2: `app/lib/agent/__tests__` (B11.5 case 12 over every new suite) and `b24-b2-power-ground` | 37 passed | 425 passed | 0 |
| G3: `app/lib/agent/orchestration/__tests__` | 49 passed | 460 passed | 0 |
| G4: `app/lib/engineering/__tests__` | 99 passed | 1,107 passed | 0 |
| G5: `app/lib/qualification/__tests__`, the B21, B22 and B23 closeout tripwires over every page, `b22-a1-page`, `b23-a-provider-admission`, b19-e, `b23-b-dfm-quote-flow-page`, `b23-d-physical-evidence-contract`, `b21-f-page` | 30 passed, 1 failed | 315 passed, 1 failed, 3 skipped | 1 (`b24-a1-environment-profile` case 17, the STOP: section 14) |
| G6: the corpus with its flag (`b2fix-corpus-flagged`) | 1 failed | 4 passed, 1 failed | 1 (case 4, the CD-9 STOP: section 7) |
| the corrected case-17 move on a temporary copy of A1's suite (`b2fix-probe-final`; deleted after the run, A1's suite byte-identical) | 1 passed | 22 passed (A1's 20 and the two probes) | 0 |
| guard case 8 against two deliberate spec breakages (the word-boundary pattern back; the nothing-changed label by `.last()` again), the spec restored by sha256 each time (`b2fix-mutation-m1`, `-m4`) | 1 failed each | 8 passed, 1 failed each | 1 each (the breakage caught) |
| `tsc --noEmit` | - | - | 0 |
| eslint on the eleven changed code files (B2's nine, `abuse-limits.ts`, `clock.ts`) | - | - | 0 |
| B24-B1's catalog generator, two runs after the note edit | - | csv and json sha256 identical; undoing the one note gives back the first round's bytes | 0 |
| the B17 control inventory (631 controls, 63 surfaces) and the action toolability matrix (107 action records) | - | no drift | 0 |
| control bytes and CR over the 22 changed files | - | clean | - |

## 17. What stays open

- **The corpus is red** on three CD-9 packages (section 7): a STOP for the lead. [B24-B2 review, 2026-10-08] It no longer skips
  `stage10:test` or the holdout declaration; the nightly's verdict stays red until the lead's decision.
- **The member-pin counterexample** (section 9): a STOP for the lead; the catalog row stays `failing` until a decision.
- **`b24-a1-environment-profile` case 17** (section 14): a STOP for the lead; the corrected draft (v2) is verified on a temporary
  copy at every landing point.
- **The browser case and the whole browser job** are PROPOSED until the lead's runs; page-browser-e2e's headroom is estimated at
  about 5 min 50 s (section 6). INFERRED
- **CI time** after the push is unread (section 6). The B16.0 gates' whole-tree walks take 11-14 s each here and run synchronously;
  under a loaded runner they are the most likely to meet vitest's worker-RPC limit (`4a988c8`, `9cb675d`). INFERRED
- **No quote case** in the browser (OD-173: a quote ask reaches nothing); it needs a new scripted sentence in
  `fixture-agent-adapter.ts`, which B2 does not edit.
- [B24-B2 review, 2026-10-08] **The order case's path check** has no word boundary now: a benign request path that contains `order`,
  `purchase`, `checkout` or `cart` would fail it in the lead's run; none is known (INFERRED). The production comments stating 82 chat
  runs are noted (section 15).
