# B24-D1 - Benchmark methodology and latency (part 1: D24-27, D24-28; D24-41)

Increment B24-D1 of chapter B24 on `chapter/b24-production-qualification`, from `6acae24` (B24-A2F committed). Labels: **CONFIRMED**
(executed here, or read at the cited file:line), **INFERRED**, **PROPOSED**, **RECORDED** (taken from a record), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION**. Every workflow line below is this tree's unless it says otherwise. Part 2 (memory, large boards,
multi-tab, crash, cleanup) is B24-D2's.

## 0. What B24-D1 is

- **D24-28 (the fragile thresholds and the method; runbook `:1109`, OD-212).** Every real-clock bound CI gates is read from the test
  sources with the TypeScript compiler API (`app/lib/qualification/threshold-census.ts`) and hand-classified one by one
  (`threshold-classification.ts`): 55 CI-gated bounds at `6acae24` - 33 deadline-proofs and 15 complexity-proofs kept, 7 performance
  bounds moved in place to the benchmark (`void <x>; // [B24-D1, 2026-10-09] performance bound moved ...`), 13 bounds outside CI
  carrying no class ([B24-D1 review, 2026-10-09] 53, 14, 6 and 12 before the review round, when the scanner did not follow a timing
  returned by a helper: b20-a1-redaction-linear's two CI bounds and connectivity-board's best-of-runs were missed, section 5). The
  census is byte-pinned (`threshold-census.csv`, 296 rows: 61 elapsed, 7 moved, 178 budget, 23 yield, 13 wait, 14 config).
  **CONFIRMED** (`b24-d1-threshold-census` 1-7).
- **D24-27 (nothing measured or gated; runbook `:1094-1097`, OD-212).** A `benchmark-latency` job (`benchmark.yml`, appended) runs two
  suites with `SIRKIT_B24_BENCHMARK=1`: `b24-d1-latency` (view and read commands on a recorded ROUTED board, a granted reversible edit,
  the first stream event, the silent gap and the completion of `POST /api/chat`, and the seven moved workloads) and
  `b24-d1-latency-workflow` (publish, preflight, apply and qualify on the committed recorded router, verified against the pinned
  identities). Each metric has fixed warm-ups and samples, `performance.now()` only, p50 and p95 by the stage-09 `quantile`, and a
  results document `sirkit.latency-results.v1` written through one non-test writer to a directory outside the repository. The gate
  (`scripts/b24-latency-gate.ts`) evaluates against the append-only `latency-baseline.json` (`sirkit.latency-baseline.v1`) with the
  stage-09 budget shape plus a floor and never an absolute target. **CONFIRMED** locally (section 2); the runner baseline is
  **BLOCKED-LIVE-QUALIFICATION** (section 3).
- **D24-27's second half (long tool waits send nothing).** Measured and stated: after `run_started` the route sends seven `warning`
  lines at once (0.03 ms median between the first two lines on the first local run) and then nothing until the provider answers - the
  silent gap's median is 260.1 ms for a provider delayed by exactly 250 ms (section 2; 255.3 ms on the first local run). A keepalive is
  an owner question (OD-234), not built here.
- **The OD-30 headroom check (D24-28).** `scripts/ci-job-headroom.ts` over the pure core `app/lib/qualification/ci-headroom.ts`: a
  one-line start step is the first step of `prompt-to-gerber`, `page-browser-e2e` and `agent-boundary-suites` (lead decisions D8,
  D19) and a two-line headroom step follows each job's upload step; it fails `OD30_SPLIT_REQUIRED` under five minutes of headroom and
  `OD30_START_UNKNOWN` with no start. `benchmark-latency` reports only. **CONFIRMED** offline (`b24-d1-latency-policy` 7, 9);
  the three jobs' headroom on the D1 CI run is the lead's reading (section 4).
- **D24-41 (the CD-9 corpus executor; OD-204).** `app/lib/circuit-verification/benchmark.ts` and three `case` lines in
  `builtin-executor.ts`; the flagged corpus run is green with only the two baseline-recorded failed_correctness packages failing
  (section 7). **CONFIRMED**.
- **Not changed:** `regression-policy.ts`, `statistics.ts`, `stage-09-benchmark-core.test.ts`, `route-bench.ts`, `.env.example`,
  `package.json`, every `timeout-minutes`, every `permissions`, the chat stream (no keepalive, heartbeat or timeout;
  `CHAT_PROTOCOL_VERSION` 1), the pinned release identities and bytes, the census (168 / 165 / 3 / 0), the agent-tool counts
  (47 / 36 / 9 / 27), the 107 action records and the 32 migrations (section 8).

## 1. The method (OD-212 as applied)

- **Metric catalogue.** `LATENCY_METRICS` (`app/lib/qualification/latency-policy.ts`) is closed: 16 metrics ([B24-D1 review,
  2026-10-09] 15 before the review round's seventh moved bound), each with its workload, fixed `warmups` and `samples` and the
  increment that added it (B24-D1). Counts (OD-234): view and read 20 and 200, edit 3 and 30, stream 5 and 50, workflow 1 and 10, each
  moved workload 1 and 10.
- **Results document** `sirkit.latency-results.v1`: per metric the sorted sample vector, p50 and p95 computed with `quantile`
  (`app/lib/benchmark/statistics.ts:3-8`, never a second implementation) and `correctness: "verified"`; per run the commit and the
  environment (platform, architecture, OS release and image, Node, CPU model, logical cores) as `scripts/stage10-evidence.ts:33`
  records them. [B24-D1 review, 2026-10-09] A document carries only its own suite's metrics (`METRIC_FOREIGN_SUITE`; the constructor
  refuses a foreign one), and a metric measured in two documents is refused by `evaluateLatency` (`LATENCY_RESULTS_METRIC_DOUBLED`),
  never overridden by the file read last.
- **Baseline document** `sirkit.latency-baseline.v1`: `versions[]`, append-only. Per metric p50, p95, the runner run ids and a budget
  `Pick<RegressionBudget, "practicalRegression" | "noiseBand" | "direction" | "failureAction"> & { floorMs }` -
  `direction: "lower_is_better"`, `failureAction: "block"`, never a `maximumP95` and never a `suiteId` (the stage-09 union is closed,
  `regression-policy.ts:6-14`). Version 1 is declared without values; from the second version on, a widened or dropped metric needs a
  `changeRecord` that `validateThresholdChange` (`regression-policy.ts:103-110`) accepts, else `UNREVIEWED_WIDENING`; v1 to the first
  runner baseline is not a widening. [B24-D1 review, 2026-10-09] Only v1 is declared without values (a later declared version is the
  shape problem `DECLARED_AFTER_V1`), a recorded value nulled in a later version is a widening too (`values_dropped`), and the gate
  script refuses a committed baseline with an unreviewed widening before it evaluates anything.
- **`evaluateLatency`**: one state per catalogued metric - `pass`; `block` (the p50 exceeds baseline x (1 + practicalRegression +
  noiseBand) AND baseline + floorMs; the same on the p95 from 20 samples, reported only below); `baseline_missing`;
  `sample_shortfall`; `unmeasured`. `block`, `sample_shortfall` and `unmeasured` always block; `baseline_missing` blocks too, except
  while the latest committed version is the declared-without-values v1 (lead decision D3; [B24-D1 review, 2026-10-09] version 1 and
  declared, keyed on both: a later declared version never re-arms it), when it is a recorded, non-blocking
  BLOCKED state printed `BLOCKED (OD-212/OD-30: baseline not recorded; Actions minutes not accepted)` in the table and the step
  summary, never `pass`. Stated defaults (OD-234): practicalRegression 0.10, noiseBand = max(0.20, the relative p95 spread across at
  least three runner runs), floorMs 1.
- **The writer** (lead decision D15): `app/lib/qualification/latency-results-writer.ts` exports `BENCHMARK_FLAG_ENV`
  (`SIRKIT_B24_BENCHMARK`, exactly "1") and `BENCHMARK_DIR_ENV` (`SIRKIT_B24_BENCHMARK_DIR`), resolves the directory from the
  environment it is given and refuses one that is unset, relative or inside the repository before any write ([B24-D1 review,
  2026-10-09] a repository child whose name begins with dots, `..results`, is inside: outside is `..`, `../<x>` or another drive); the
  suites name no write primitive (`b11-5-capture-exactness` case 12 needs no `justified` entry). Its confinement is asserted by
  `b24-d1-latency-policy` 6 (B22-A3's `_pinned-ngspice.ts` precedent): each refused directory is refused and the planted in-repository
  paths (`artifacts/.../b24-d1-planted-never-written`, `..planted`, `...`) do not exist afterwards.

## 2. The metrics and the measured local run

The local run (this machine, not the reference runner: `win32 x64`, Node `v24.15.0`, `Intel(R) Core(TM) Ultra 5 125U`, 14 logical
cores; `SIRKIT_B24_BENCHMARK=1`, the directory under the session scratchpad; the review round's re-run, logs
`d1fix-green-latency-flagged` 7 of 7 in 77.52 s and `d1fix-green-latency-workflow-flagged` 1 of 1 in 11.96 s, 2026-10-09; the first
run, `d1-green-latency-flagged` 6 of 6 in 101.69 s and `d1-green-latency-workflow-flagged` 1 of 1 in 19.81 s, measured the first 15
metrics on a more loaded machine, its values in the first-run column). **CONFIRMED** by execution; a history of this machine, never a
baseline (the reference machine is GitHub `ubuntu-latest`, section 3).

| metric | workload | warm-ups / samples | p50 ms | p95 ms | first run p50 / p95 | correctness |
|---|---|---|---|---|---|---|
| `view.pcb-fit-board` | `pcb.fit-board` through `createViewCommand` and `ViewSessionBus` (`pcbCommands`) on the first recorded ROUTED board of `e2e/fixtures/blinker-route-fixture.json` | 20 / 200 | 0.032 | 0.110 | 0.142 / 0.306 | settled, camera kind `board` |
| `view.pcb-pan-to-component` | `pcb.pan-to` a component by reference, round-robin over the nine refs | 20 / 200 | 0.036 | 0.086 | 0.156 / 0.301 | settled, the camera on the component's bounds centre |
| `read.selection-inspect` | `sirkit.selection.inspect` through `createAgentToolGateway` over the activated read binding (`resolveReadBinding` resolves it) | 20 / 200 | 49.138 | 64.681 | 74.552 / 84.520 | the sealed selection's one footprint, exact |
| `read.via-inspect` | `sirkit.pcb.via-inspect` the same way, on the first net with vias | 20 / 200 | 53.419 | 69.952 | 82.344 / 97.704 | the net named, vias present |
| `edit.granted-move-footprint` | one granted reversible edit through the B18-C harness (`composition("execute_explicit_tier1")`, `runScenario` with `MESSAGE`): the chat run, the grant, the ritual and the settlement | 3 / 30 | 286.188 | 299.555 | 305.902 / 311.268 | `completed`, one grant, the ritual `committed`, headSequence +1, R3 moved 2 mm |
| `stream.first-event-ms` | `POST /api/chat` with the fake adapter delayed 250 ms: the first NDJSON line | 5 / 50 | 10.606 | 13.639 | 14.011 / 16.741 | `run_started` first |
| `stream.silent-gap-ms` | the longest interval between two consecutive lines (the provider wait) | 5 / 50 | 260.085 | 264.629 | 255.274 / 260.787 | median >= 225 ms |
| `stream.completion-ms` | the terminal line | 5 / 50 | 277.951 | 281.924 | 279.021 / 284.407 | exactly one terminal, `run_completed` last |
| `workflow.publish-preflight-apply-qualify-ms` | publish, preflight, apply (opt-in header) and `POST /api/pcb/qualify` on the recorded router after the untimed steps 1-4, fresh stores per sample | 1 / 10 | 669.372 | 762.535 | 770.212 / 817.586 | 200, `idempotent: false`, rc02 0 remaining, the pinned identities exactly (`routerExecutions` 2); samples 556.7-773.0 ms (first run 706.6-824.6 ms) |
| `moved.observation-normalizer-huge-text` | b20-a4 case 6: one 5,000,000-character block | 1 / 10 | 20.075 | 29.608 | 35.835 / 41.599 | `rawChars` 5,000,000, `text`, the tail withheld |
| `moved.observation-normalizer-many-blocks` | 100,000 benign blocks | 1 / 10 | 302.922 | 307.719 | 403.390 / 454.273 | 16 read, 99,984 counted, one block of 16 repeats |
| `moved.observation-normalizer-pathological-marks` | 16 blocks of 9,000 ill-ordered marks | 1 / 10 | 865.490 | 915.583 | 924.286 / 971.786 | 16 read |
| `moved.observation-normalizer-structured-budget` | 1,998 structured leaves past the budget | 1 / 10 | 87.893 | 92.781 | 89.730 / 102.888 | `withheld_budget` |
| `moved.pcb-sync-preflight-small-fixture` | one preflight over the ready harness | 1 / 10 | 6.014 | 6.639 | 8.075 / 9.485 | `ready_to_apply` |
| `moved.pcb-sync-aggregate-500-components` | one preflight aggregating 500 blocked components | 1 / 10 | 766.046 | 836.795 | 822.128 / 852.809 | blocked, 500 components, batches 244 and 256, no board |
| `moved.redaction-linear-200-scrubs` | [B24-D1 review, 2026-10-09] b20-a1-redaction-linear (linear time) case 1: 200 `scrubVendorText` scrubs of a 4,000-character `a.` leaf | 1 / 10 | 38.098 | 44.398 | - (added by the review round) | the scrubbed output equals the 1,000-character window |

**The stream's line sequence** (one run, printed by the suite): `run_started`, seven `warning` lines, `text_delta`, `run_completed`.
The seven warnings follow `run_started` within 0.03 ms (median, the first local run); the gap before `text_delta` is the provider
wait. With a provider delayed by 250 ms the median silent gap is 260.1 ms and the completion 278.0 ms (255.3 ms and 279.0 ms on the
first run): nothing is sent during the wait (D24-27's second half, stated). **CONFIRMED**.

**The baseline run ids** are none: no `benchmark-latency` run has been recorded (section 3). The gate over these two files answers
`BLOCKED (OD-212/OD-30: baseline not recorded; Actions minutes not accepted)` for every metric, exit 0 (`d1-gate-2`; on the re-run
`d1fix-gate-2`, 16 metrics, exit 0); with the workflow file absent it answers `BLOCKING unmeasured (NO_RESULT)` for that metric, exit 1
(`d1-gate-1`). **CONFIRMED**.

## 3. The baseline state: BLOCKED

`latency-baseline.json` holds version 1 only, declared without values: every catalogued metric with the default budget and no runner
value. The reference machine is GitHub `ubuntu-latest` (no fixed hardware; the runner's variance is section 8 item 11 of the
discovery). Recording the baseline takes at least three runs of `benchmark-latency` on the D1 commit, their artifacts read-only and
`scripts/b24-latency-gate.ts --baseline <runId>=<file>...`, which prints the next version and writes nothing; the lead appends it
(section 13). Until the owner accepts the job's Actions minutes (OD-212, OD-30), the baseline is **BLOCKED-LIVE-QUALIFICATION** and
`baseline_missing` is the recorded, non-blocking BLOCKED state (lead decision D3). The job stays green on it only while every metric
is measured, with its full samples, and verified, and `route-bench` and the headroom step pass. Once a version with runner values is
appended, `baseline_missing` blocks. B24-F's CI-readiness line and BENCHMARK-QUALITY RESULT read this state from here.

[B24-D1 review, 2026-10-09] The exception is version 1's alone, and nothing re-arms it: `evaluateLatency` keys the non-blocking state
on `version === 1 && declaredWithoutValues`; a declared-without-values version at any later position fails the shape check
(`DECLARED_AFTER_V1`); nulling a recorded value in a later version is an unreviewed widening (`values_dropped`); and
`scripts/b24-latency-gate.ts` refuses a committed baseline with an unreviewed widening (`LATENCY_BASELINE_UNREVIEWED_WIDENING`,
exit 2) before it evaluates anything. `b24-d1-latency-policy` 3-5 pin each, and case 5 checks an appended runner version by shape
(the stage-09 budget plus the floor, the band at least 0.20 - a measured spread is wider - never a `maximumP95`), so the lead's
records commit lands green: before the round a legitimate v2 planted into the file turned cases 3 and 5 red
(`d1fix-counterexample-planted-v2-pre-edit`, the file restored byte-identical by sha256). **CONFIRMED**.

## 4. The CI jobs and OD-30

- **`benchmark-latency`** (`benchmark.yml`, appended after `benchmark-nightly`): `ubuntu-latest`, pnpm 11.2.2, Node 24,
  `timeout-minutes: 30`, no `if:` (every trigger: `pull_request`, `workflow_dispatch`, `schedule`); `SIRKIT_B24_BENCHMARK_DIR:
  /tmp/sirkit-b24-benchmark` in the job's env; `SIRKIT_B24_BENCHMARK: "1"` in the vitest step's env only. Steps: `mkdir -p` and the
  start record; checkout, pnpm, node, install; `pnpm exec vitest run <the two suites> --no-file-parallelism` with junit output;
  `pnpm exec tsx scripts/b24-latency-gate.ts`; `pnpm exec tsx scripts/route-bench.ts > "$SIRKIT_B24_BENCHMARK_DIR/route-bench.json"`
  (the unchanged script `pcb:routebench` runs, its two absolute budgets kept: the one stated exception to OD-212, an owner question in
  OD-234); the headroom report (`--report-only`); the `always()` upload. The gate, route-bench and headroom steps carry
  `if: success() || failure()`, never `continue-on-error`. `permissions: contents: read` is unchanged. **CONFIRMED**
  (`b24-d1-latency-policy` 8). Its minutes per run are **UNKNOWN** until its first run (locally the two suites take 101.7 s and
  19.8 s); no auto-retry.
- **The OD-30 steps** (`deterministic-manufacturing.yml`): `prompt-to-gerber`'s start step at `:32` and headroom step at `:344-345`,
  `page-browser-e2e`'s at `:405` and `:432-433`, `agent-boundary-suites`'s at `:565` and `:624-625` (lead decision D19; A1's
  insertion table carries the six rows). Still exactly two `playwright test` lines; no new line ends in `pnpm exec vitest run`; the
  admission helper derives the three jobs. **CONFIRMED** (`b24-d1-latency-policy` 9, `b19-e-ci-job-scope`).
- **Headroom.** `page-browser-e2e` (of 30) and `prompt-to-gerber` (of 25) are gated since D1; their headroom on the D1 CI run is the
  lead's reading - **BLOCKED-LIVE-QUALIFICATION** here (the builder runs no CI). History: prompt-to-gerber 17 min 31 s of 25 on
  `b6c6b0d` (`EXECUTION_LEDGER.md:4777`) and 13 min 10 s of 25 at `b3a4f2d` after B24-D0's split (run 37926146764, the lead's
  reading); page-browser-e2e 20 min 25 s on `b6c6b0d` and 16 min 24 s at `b3a4f2d`; agent-boundary-suites 7 min 21 s of 20 at
  `b3a4f2d`. D1 adds to prompt-to-gerber the two always-on suites (11.5 s locally with the census walk, `d1-green-5-always-on`) and the two
  skipped suites (collected only, 1.2 s): under a minute, **INFERRED**. **RECORDED**.
- **The stage-09 harness digest.** Appending to `benchmark.yml` changes the harness digest of `productTreeRevision`
  (`scripts/benchmark.ts:31-32`), so the next manual stage-09 run's `codeRevision` differs; no test pins it. **RECORDED**.

## 5. The threshold census (D24-28)

Scope: every file vitest includes (`vitest.config.ts:17`), 860 files at this tree (858 at `6acae24` plus the four D1 suites, minus
the two benchmark suites, which are excluded by design), each marked with the CI jobs that select it by the positional-substring
rule net of prompt-to-gerber's exclusions (the census's selection equals the admission helper's for every file,
`b24-d1-threshold-census` 2). Keys are file + test title path + ordinal, never a line number. The walk yields between files and the
walking cases carry 120 s budgets (recorded as the suite's own budget and yield rows). An `elapsed` bound is a timestamp difference,
an identifier bound to one, a conversion of one, a call of a helper that returns one (or a timestamp), or the best of pushed timings
spread into `Math.min`/`max` ([B24-D1 review, 2026-10-09] the first scan followed no helper and no spread, so it missed
b20-a1-redaction-linear's two CI bounds - `elapsed(run)` at `:88`, asserted at `:93` and `:103` - and connectivity-board's
`Math.min(...runs)` outside CI; `b24-d1-threshold-census` 3 plants each shape, and the generator refused the two CI bounds
unclassified before they were classified, `d1fix-gen-census-probe-1`).

| kind | rows | classes |
|---|---|---|
| `elapsed` in CI | 48 | 33 `deadline-proof`, 15 `complexity-proof`, 0 `performance` (55 before the moves; [B24-D1 review, 2026-10-09] 47 and 14 before the round) |
| `moved` | 7 | `performance`, each `movedTo` a catalogued metric ([B24-D1 review, 2026-10-09] 6 before the round) |
| `elapsed` outside CI | 13 | no class (admitting the suite makes the census demand one; [B24-D1 review, 2026-10-09] 12 before the round) |
| `budget` (per file) | 178 | `hang-guard` (176 at `6acae24`; the two always-on suites add theirs) |
| `yield` (per file) | 23 | `rpc-yield` against the 60 s onTaskUpdate limit (21 at `6acae24`) |
| `wait` (per file) | 13 | `poll-deadline` |
| `config` | 14 | `harness-default`: vitest 5 s (no `testTimeout` set), the 60 s worker-RPC limit, `vi.waitFor` 1,000 ms (confirmed in the installed vitest 3.2.6: `const { interval = 50, timeout = 1e3 }` twice, waitFor and waitUntil), Playwright 180 s and 20 s, nine `timeout-minutes` |

**The CI-gated `vi.waitFor` calls at the commit, by file:** `b18-d-chat-stop` 2, `b21-b-chat-router` 4, `b21-d2-chat-proposals` 1,
`b22-b-exposure` 1 (15 s), `b20-a1-http-transport` 5, `b20-a3-authorized-post` 2, `b20-a3-token-cache` 2, `b20-b3-read-call` 2,
`b24-a3-embedding-admission` 1, `b24-c1-durable-trace` 4, `b24-c1-llm-call-record` 1, `b24-c2-attribution` 1 (15 s): 26 calls in 12
files, 24 at the 1,000 ms default; one more outside CI (`b14-1-production-integration`). The Lead note's 20 in 9 files at `f663d71`
grew by B24-A3's, C1's and C2's six. **CONFIRMED**.

**Classes.** A `deadline-proof` separates an enforced deadline, abort or cap from its absence and records the bound and the value it
disproves; a `complexity-proof` separates bounded from super-linear work and names the behaviour it disproves; a `performance` bound is
the speed of correct work with nothing disproved within 10x and is moved. Every CI row's class and reason is in
`threshold-classification.ts`; the rendered CSV carries them. No work-count assertion was added beside
`b21-e3-resume-record.test.ts:256`: `resumeAnswerCredentialShape` exposes no count (its quantifiers are bounded in `store.ts:634`);
the bound stays a complexity-proof.

**The review round (2026-10-09).** An adversarial review confirmed nine findings on the D1 tree; each was fixed test-first (the
reproducing assertion red on the unfixed source, `d1fix-red-1-strengthened-tests`: 10 failed of 29; then green): (1, 7) the D3
exception keyed to version 1 alone - `DECLARED_AFTER_V1`, `values_dropped`, the gate's widening refusal (section 3); (2) the census
following helper-returned and best-of-runs timings (above: two CI bounds found, one moved, one a complexity-proof; one outside CI);
(3, 6) the writer refusing a repository child named with dots (section 1); (4) D0's C64 note on `dfm-quote-flow.md` restored whole;
(5) the silent-gap workload text naming the measurement taken (the longest interval between two consecutive lines); (8) honesty case
10's title carrying its dated note; (9) `b24-d1-latency-policy` 5 checking an appended runner version by shape (section 3); and the
results validator refusing a foreign suite's metric and `evaluateLatency` a doubled one (section 1). **CONFIRMED** (section 8).

## 6. The moved bounds and the tight kept rows

| key (file # test # ordinal) | old line | metric |
|---|---|---|
| `b20-a4-observation-normalizer.test.ts # [B20 A4] 6.1 the observation normalizer > 6. enormous content is bounded before any work and within pinned times # 1` | `:338` (`hugeMs` < 3,000) | `moved.observation-normalizer-huge-text` |
| the same test # 2 | `:343` (`performance.now() - started` < 5,000) | `moved.observation-normalizer-many-blocks` |
| the same test # 3 | `:354` (`marksMs` < 10,000) | `moved.observation-normalizer-pathological-marks` |
| the same test # 4 | `:370` (`budgetMs` < 5,000) | `moved.observation-normalizer-structured-budget` |
| `performance-resilience.test.ts # Stage 3 performance and resilience budgets > preflights and applies the small exact new-board fixture within a generous CI budget # 1` | `:17` (`elapsed` < 2,000) | `moved.pcb-sync-preflight-small-fixture` |
| the same describe > aggregates a 500-component blocked design completely without creating a board # 1 | `:44` (`elapsed` < 10,000) | `moved.pcb-sync-aggregate-500-components` |
| `b20-a1-redaction-linear.test.ts # [B20 A1] the URL-credential pattern: linear time > 200 scrubs of a 4 000-character leaf with a word boundary at every letter finish well under 2 000 ms # 1` ([B24-D1 review, 2026-10-09]) | `:93` (`elapsed(() => {...})` < 2,000) | `moved.redaction-linear-200-scrubs` |

Each move is in place on its own line; the files keep their line counts (674, 62 and 109) and `it(` counts (17, 4 and 4); the
workloads and their correctness assertions stay (the NFC counter of `:358-369` among them; the scrubbed output at `:92`).
**CONFIRMED** (`b24-d1-threshold-census` 7). [B24-D1 review, 2026-10-09] The seventh move: the B20 page measured the B19 pattern's
quadratic scan at 1,371 ms for these 200 scrubs (`mcp-client-boundary.md:398-399`), under the 2,000 ms bound, so the bound disproved
nothing within 10x - `performance`; the file's other bound (`:103`, < 1,000 ms per 100,000-character run against the measured 3,184 ms)
separates the linear scan from the quadratic one and stays, a complexity-proof.

**Tight deadline-proofs** (the margin between the bound and the value it disproves under 1 s): `b19-e-agent-read-port`'s two
`< 900 ms` against the vendor's 1,000 ms deadline (100 ms); `b20-a1-http-transport`'s `< 700 ms` against the probe's own 1 s
(300 ms); and the three lower bounds - `b22-a3-diagnostic-runner` 10 `>= 30 ms` against an immediate refusal of a 40 ms wait,
`b22-b-bounded-host` 2 `>= wallClockMs - 20` against a stop before the budget and 8 `>= 90 ms` against an answer before the 60 ms
confirm wait. None is widened past what it disproves. **RECORDED**.

## 7. D24-41: the CD-9 corpus executor (OD-204)

`app/lib/circuit-verification/benchmark.ts` exports `executeCircuitVerificationBenchmark(operation)`; `builtin-executor.ts` dispatches
`circuit_verification_manifest`, `_authority` and `_scale` to it beside the CD-8 and CD-10 cases. Every value is derived:

- the manifest from `CD9_CORPUS_MANIFEST` and its own digest (94 fixtures, 0 invalid hashes, 0 fully implemented, 94 manifest-only);
- the authority booleans from calls into the deciding modules over one full oracle run on a benchmark graph (two nets, a declared VDD
  rail with no source role, one component whose two push-pull outputs both drive VDD): `humanReviewer` refuses an `ai` approver;
  readiness over the run holding the rail's `unknown` finding is never READY and never permits `approve_for_CD10`; readiness over an
  incremental run names `FULL_ORACLE_REQUIRED`; a waiver (`createCircuitWaiver`, independent human approval) on the push-pull
  violation removes it from `unwaivedFindingIds` while the run's result and `blockingFindingIds` keep it and the waiver carries
  `physicalResultPreserved`; `classifyNativeErcCorroboration` answers `corroborating_only` whether the native report corroborates or
  disagrees and readiness takes no ERC input, so neither a legacy ERC nor native KiCad can approve or override;
- the scale figures from `defaultCircuitVerificationCapabilityProfile().limits.maximumRuleInstances` (500,000, the exported policy),
  from `compileRequiredRuleDenominator` with the selector limit at one (the two-net selection cut to one target and diagnosed
  `CD9_SELECTOR_RESOURCE_LIMIT`) and from `runFullCircuitOracle` with one rule's implementation unknown (its instances fail
  `failed_isolated` while the rest complete).

The graph-integrity violation first tried was refused `CD9_FINDING_NON_WAIVABLE` (the registry's integrity rules are non-waivable, a
corpus case itself), which is why the waiver derivation uses the push-pull contention. The problem is a benchmark pin of the graph,
as CD-8's benchmark casts its own. Red first: `d1-red-corpus-flagged-1` (the three CD-9 packages `failed_correctness`; 51 passed, 2
blocked, 5 failing of 58); green: `d1-green-corpus-flagged-2` (5 of 5; 54 passed, 2 blocked, 2 failing: the two baseline-recorded
failed_correctness packages only). **CONFIRMED**.

## 8. Test-first record and gates

Red first on `6acae24` (the modules moved aside, the suites present): `d1-red-1-always-on` (both always-on suites fail at collection:
`Cannot find module '../latency-policy'`, `'../ci-headroom'`), `d1-red-2-benchmark-unflagged` and `d1-red-3-benchmark-flagged` (both
benchmark suites fail at collection the same way; nothing written under the results directory). The census's unclassified count at
`6acae24`: the probe `d1-probe-census-1` listed 53 CI `elapsed` bounds against an empty classification; on the finished tree, case 1
alone with the classification file emptied reports 53 problems - 47 `UNCLASSIFIED` and 6 `MOVED_UNCLASSIFIED` - and exit 1
(`d1-red-census-count`; the file restored byte-identical). No job ran `route-bench` or a latency suite and no job had a start or
headroom step at `6acae24` (read).

| gate | files / cases | exit |
|---|---|---|
| before the workflow edit: `b19-e-ci-job-scope`, `b22-a1-page`, `b23-b-dfm-quote-flow-page`, `b23-d-physical-evidence-contract`, `b23-a-provider-admission`, `b11-5-capture-exactness` (`d1-before-readers-1`) | 6 files, 77 passed | 0 |
| before: `app/lib/qualification/__tests__` (`d1-before-qualification`) | 34 files, 368 passed, 3 skipped | 0 |
| before: `app/lib/agent/orchestration/__tests__` (`d1-before-orchestration`) | 49 files, 460 passed | 0 |
| red first (above) | 2 files; 2 files; 2 files; 1 failed of 5 | 1; 1; 1; 1 |
| `generate-b24-threshold-census` x3 (`d1-gen-census-1..3`; the last two byte-identical, sha256 `6c031017...`) | 293 rows | 0 |
| the two always-on suites (`d1-green-5-always-on`) | 2 files, 17 passed | 0 |
| `b24-d1-latency` with the flag, the directory outside the repository (`d1-green-latency-flagged`) | 6 of 6, 101.69 s, 14 metrics written | 0 |
| `b24-d1-latency-workflow` with the flag (`d1-green-latency-workflow-flagged`) | 1 of 1, 19.81 s, 1 metric written | 0 |
| the two benchmark suites without the flag (`d1-green-benchmark-unflagged`) | 2 files skipped, 7 tests skipped | 0 |
| `scripts/b24-latency-gate.ts` over the latency file alone (`d1-gate-1`: the workflow metric unmeasured) and over both (`d1-gate-2`: BLOCKED, non-blocking) | 15 metrics | 1; 0 |
| the flagged corpus suite (`d1-red-corpus-flagged-1`; `d1-green-corpus-flagged-2`) | 1 failed of 5; 5 of 5 | 1; 0 |
| `tsc --noEmit` (`d1-tsc-4`; `d1-tsc-5` after the pin moves of section 10) | 0 errors; 0 errors | 0; 0 |
| `eslint` on the 24 changed or new TS files (`d1-eslint-1`; `d1-eslint-2` after the pin moves) | 0 problems; 0 problems | 0; 0 |
| after: the readers chain 1 (`d1-after-readers-1`: the six above, `app/lib/pcb-sync/__tests__`, `stage-09-benchmark-core`, `b18-d-chat-stop`, the three import gates, the five B20 readers of `mcp-client-boundary.md`, `b20-d1-malicious-server`, `action-registry`) | 25 files, 377 passed, 142.34 s | 0 |
| the census suite's case 1 alone with the classification file emptied (`d1-red-census-count`; the file restored byte-identical) | 1 failed: 53 problems (47 `UNCLASSIFIED`, 6 `MOVED_UNCLASSIFIED`) | 1 |
| after: `app/lib/qualification/__tests__`, first run (`d1-after-qualification`) | 38 files: 10 failed, 375 passed, 10 skipped, 172.55 s - case 16 (the lead's, 15 -> 17), the kinds pin of `b24-a1-flags` 1, `b24-a2-env-names` 2, 5 and 6 (`GITHUB_STEP_SUMMARY` read by the two scripts with no census row; A2's pin that the three names were not yet read), `b24-a2-headers` 11 (the OD-195 draft's undeclared list), `b24-d0-ci-split` 1, 4 and 7 (the four suites in prompt-to-gerber's selection; C16, C17, C48) and the census suite's 7 (a title-line note that matched the marker); each moved or fixed in place (section 10) | 1 |
| after: `app/lib/qualification/__tests__`, second run (`d1-after-qualification-2`) | 38 files: 1 failed (`b24-a1-environment-profile` 16, the lead's 15 -> 17), 384 passed, 10 skipped (the two benchmark suites and the three live gates), 189.20 s | 1 |
| after: `app/lib/agent/orchestration/__tests__` (`b21-closeout-statements` among them), `b22-closeout-statements`, `b23-closeout-statements` (`d1-after-orchestration-closeouts`) | 51 files, 477 passed, 145.45 s | 0 |
| after: `app/lib/workflow/prompt-to-gerber/__tests__` (`d1-after-prompt-to-gerber`) | 5 files, 34 passed, 19.04 s | 0 |
| `generate-b24-eval-catalog` x2 (114 rows), `generate-b24-scenario-map` x2 (20 scenarios), `generate-b24-threshold-census` once more (`d1-gen-census-4`, 293 rows) | every output byte-identical before and after (sha256 unchanged; `git status` clean on the four committed outputs) | 0 |

| [B24-D1 review, 2026-10-09] the pre-edit counterexample: a legitimate runner v2 (values, three run ids, one band at 0.25) planted into `latency-baseline.json`, the unedited policy suite (`d1fix-counterexample-planted-v2-pre-edit`; the file restored, sha256 `211a263b...` equal before and after) | 2 failed of 10: case 3 at `:190` (the latest version declared), case 5 at `:258` (budget equality on the 0.25 band) | 1 |
| review round: red first, the strengthened policy, census and D0 suites on the unfixed sources (`d1fix-red-1-strengthened-tests`) | 10 failed of 29: policy 1 `:152` (a foreign suite's metric), 2 `:190` (a doubled metric), 3 `:233` (`DECLARED_AFTER_V1`), 4 `:269` (`values_dropped`), 5 `:307` (a declared version appended), 6 `:321` (`..planted` accepted), 8 `:416` (the gate's widening refusal); census 3 `:157` (the helper-timed rows); D0 11 `:584` (D0's C64 sentence) and 4 `:371` (C48's line moved by a comment line, folded back onto its line) | 1 |
| review round: the generator against the extended scanner before the classification (`d1fix-gen-census-probe-1`); the probe (`d1fix-probe-census-1`) | refused: 2 `UNCLASSIFIED` (b20-a1-redaction-linear's two CI bounds); 62 elapsed, 49 in CI, 13 outside | 1; 0 |
| review round: `generate-b24-threshold-census` x2 (`d1fix-gen-census-1..2`, byte-identical, sha256 `586cb9fc...`) | 296 rows | 0; 0 |
| review round: policy and D0 green (`d1fix-green-1-policy-d0`); the two always-on suites and D0 (`d1fix-green-2-always-on-d0`: census 3's plant then completed with its classifications); the census suite alone (`d1fix-green-3-census`) | 22 passed; 28 of 29; 7 of 7 | 0; 1; 0 |
| review round: `b24-d1-latency` with the flag (`d1fix-green-latency-flagged`), `b24-d1-latency-workflow` (`d1fix-green-latency-workflow-flagged`), the gate over both (`d1fix-gate-2`) | 7 of 7 in 77.52 s, 15 metrics written; 1 of 1 in 11.96 s, 1 metric; 16 metrics BLOCKED, non-blocking | 0; 0; 0 |
| review round: the readers chain (`d1fix-after-readers-1`: `b19-e-ci-job-scope`, `b22-a1-page`, `b23-b-dfm-quote-flow-page`, `b23-d-physical-evidence-contract`, `b23-a-provider-admission`, `b11-5-capture-exactness`, `stage-09-benchmark-core`, `b18-d-chat-stop`, `app/lib/pcb-sync/__tests__`, the five B20 readers of `mcp-client-boundary.md` with `b20-a1-redaction-linear`, `b20-a3-live-reread`, the three import gates) | 24 files, 333 passed, 70.21 s | 0 |
| review round: `app/lib/agent/orchestration/__tests__` with `b21-closeout-statements` (`d1fix-after-orchestration`) | 49 files, 460 passed, 62.18 s | 0 |
| review round: `app/lib/qualification/__tests__` (`d1fix-after-qualification`) | 38 files: 1 failed (`b24-a1-environment-profile` 16, the lead's 15 -> 17), 384 passed, 11 skipped (the two benchmark suites, now 8 cases, and the three live gates), 92.30 s | 1 |
| review round: `app/lib/workflow/prompt-to-gerber/__tests__` (`d1fix-after-prompt-to-gerber`) | 5 files, 34 passed, 9.14 s | 0 |
| review round: `tsc --noEmit` (`d1fix-tsc-1`: one TS2345 in the policy suite - a test helper's literal policy-version type, the version spread in as case 4 does - then `d1fix-tsc-2`); `eslint` on the 25 changed or new TS files (`d1fix-eslint-1`; `d1fix-eslint-2` on the re-typed suite); `generate-b24-eval-catalog` x2 (114 rows), `generate-b24-scenario-map` x2 (20 scenarios) | 1 error, then 0; 0 problems, 0; every B24 artifact byte-identical before and after (sha256 lists equal) | 2, 0; 0, 0; 0 |
| review round: the policy suite on the re-typed file and the three closeout scanners on the final page (`d1fix-final-policy-closeouts`: `b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements`) | 4 files passed | 0 |

The lead's commit gate re-runs each chain; the one red case is the lead's own pin (section 12).

## 9. Superseded statements (lead decision D5)

| file:line | statement | what D1 did |
|---|---|---|
| `app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts:329` | "6. enormous content is bounded before any work and within pinned times" | the title keeps its text (the census key and the page pins depend on it); a trailing `// [B24-D1, 2026-10-09] performance bounds moved to b24-d1-latency (OD-212)` on its line |
| `app/lib/pcb-sync/__tests__/performance-resilience.test.ts:10` and `:11` | "Stage 3 performance and resilience budgets"; "... within a generous CI budget" | a trailing dated note on each title line (the `it(` line's names the metric without the marker's words, so the census counts two markers in the file) |
| `artifacts/ai-control-plane-b20/mcp-client-boundary.md:1500` | "enormous content within pinned times" | a dated note in place, run with the five B20 suites that read the page |
| `app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts:90` | "200 scrubs of a 4 000-character leaf with a word boundary at every letter finish well under 2 000 ms" | [B24-D1 review, 2026-10-09] the title keeps its text (the census key); a trailing `// [B24-D1, 2026-10-09] performance bound moved to b24-d1-latency (OD-212)` on its line; the bound at `:93` is the `void` marker |
| `artifacts/ai-control-plane-b20/mcp-client-boundary.md:399` | "(85 times under the 2 000 ms pin)" | [B24-D1 review, 2026-10-09] a dated note in place on the same line (the pin moved to `moved.redaction-linear-200-scrubs`; the 1,000 ms pin stays), run with the five B20 suites and `b24-d0-ci-split`, which read the page |
| `app/lib/qualification/__tests__/b24-b3-live-suite-honesty.test.ts:473` | "10. NON_LIVE_GATES (lead decision D2) holds exactly b24-b2-corpus-nightly" | [B24-D1 review, 2026-10-09] the title keeps B3's text (its pages cite it); a trailing dated note on the `it(` line names the two latency gates the pinned list gained (review correctness-6; `b24-d1-latency-policy` 8 pins the note) |
| `artifacts/ai-control-plane-b23/dfm-quote-flow.md:470` (section 14's intro) | D0's C64 note | [B24-D1 review, 2026-10-09] D0's sentence restored whole and D1's appended as its own sentence (the first D1 edit had spliced D0's rationale onto D1's note; `b24-d0-ci-split` 11 now pins both sentences) |
| `artifacts/ai-control-plane-b20/mcp-client-boundary.md:41`, `mcp-provider-connectors.md:254` | `deterministic-manufacturing.yml:131` (`app/lib/mcp`) | prose no suite resolves: the line is `:132` since D1's start step; not moved, recorded here |
| `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:285, :321, :501` | workflow `:226` | prose: `:227` now; not moved (D0's tripwire holds the text), recorded here |
| `artifacts/ai-control-plane-b23/provider-registry.md:234`, `unknowns-and-owner-decisions.md:50` | `:227` (and `:226`) | prose: `:228` (`:227`) now; not moved, recorded here |
| `artifacts/ai-control-plane-b24/scenario-map.md:306, :477` | `deterministic-manufacturing.yml:292` | B3's records of its insertion: `:293` now; not moved (the two present-tense citations at `:137` and `:508` carry dated notes) |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:724, :1073, :1114`, `retention-and-deletion.md:185`, `ci-split.md:388` | C1-C3's and D0's records of the lines they moved | records of earlier trees; not moved |
| `artifacts/ai-control-plane-b24/README.md:19-24`, `OWNER_DECISIONS.md:110, :113`, `EXECUTION_LEDGER.md`, `discovery.md` | workflow lines | the lead's files (section 13 drafts the README rows' notes) |
| discovery 2.6 and D24-27 ("qualify 170 s in replay") | a measurement | it is the browser spec's replay budget (`e2e/prompt-to-gerber.spec.ts:67`); the unit acceptance replay budget is 60 s (`acceptance-pipeline.test.ts:109`); the 300 s DAG cap holds (`scheduler.ts:64`); the measured replay is 770 ms median here (section 2) |
| discovery 9.4 ("about 19m50s") | the browser job's duration | superseded by B23's 20 min 25 s on `b6c6b0d` and D0's 16 min 24 s at `b3a4f2d` |
| discovery D24-28 ("about 45 CI-gated bounds") | a heuristic | 55 at `6acae24` (section 5; [B24-D1 review, 2026-10-09] 53 before the scanner followed helper-returned timings) |
| discovery section 3 (`b20-a4-observation-normalizer.test.ts:356-369`) | the work-counting citation | the NFC counter is `:358-369`; its wall-clock bounds were `:338, :343, :354, :370` |

## 10. Pins moved (each in place, with a dated `[B24-D1, 2026-10-09]` note)

- The workflow citations D1's steps shifted: B21's C49 412 -> 416, C93 415 -> 419, C94 424 -> 428 (+4), C55 and the other B21 rows
  C31, C32, C33, C34, C39, C50, C51, C60, C115 (+1); B22's C76 226 -> 227; B23's C46 227 -> 228, C14 227 -> 228 (by hand, no suite),
  C64 373 -> 376 and the prose citation of the PGlite entry (`dfm-quote-flow.md:269`, D1's note before D0's); B24's ci-split.md C2-C14
  and its moved-set table (+1), observability-and-replay.md C50 380 -> 383; the B24 pages' prose and README-row drafts keep their
  text and carry a dated note (ci-admission.md, ci-split.md, database-and-recovery.md, observability-and-replay.md,
  retention-and-deletion.md, scenario-map.md).
- A1's insertion table: six rows (`:32` 1, `:344` 2, `:405` 1, `:432` 2, `:565` 1, `:624` 2).
- `b24-d0-ci-split`: the tree constants split from the frozen row values (`FIRST_EXCLUDE` 294, `JOB_FIRST_LINE` 557, the row values
  293 / 551 / 66), case 5's expected job lines (the start and headroom steps), case 10 (D0's rows precede D1's six), case 11's lines;
  cases 1 and 7: D1's four suites joined the qualification filter's selection after D0's measurement (set aside beside D0's own suite in
  case 1; 472 -> 476 in case 7); ci-split.md C16, C17 (`_ci-admission.ts` +1, +4) and C48 (590 -> 607).
- `b24-b3-live-suite-honesty`: case 1's census 19 gates in 16 files -> 21 in 18, `nonLive` [1, 1] -> [3, 3]; case 10's id list (+ the
  two gates), the flag matched as a whole name, each gate's own local run.
- `b24-a1-flags` case 1: 62 -> 65 and its kinds pin (+ the three names, D16); `b24-a2-env-names`: `CLASS_COUNTS` qualification-opt-in
  16 -> 17, platform 8 -> 11 (`GITHUB_STEP_SUMMARY`, the runner's step-summary path the headroom script and the latency gate append
  to when set, is a census row of class platform with no inventory entry: not a Sirkit name), case 5 (the three names read and rows
  since D1, with `GITHUB_STEP_SUMMARY`; was: neither, at A2's tree), case 10 [62, 5] -> [65, 5] with B3's note held to 52 -> 62 and
  the size on D1's; `edge-security.md` section 5 rows and total (93 -> 97) and its OD-195 draft (the four names appended, dated);
  `environments-and-deployment.md` section 3's count note (62 -> 65).
- `_ci-admission.ts`: `benchmark-latency` (the seventh job id, its inline step and its env; no stage10 step).
- `scenario-map.md` section 3: the two gate rows, the census count note and the D1 sentence.
- [B24-D1 review, 2026-10-09] The review round's moves, each in place with a dated note: `b24-d1-threshold-census` 1 (53 / 47 / 6 / 12 ->
  55 / 48 / 7 / 13, classes 33 / 14 -> 33 / 15, 53 -> 55 classifications), 3 (the helper, function-declaration, timestamp-helper,
  spread and voided-helper plants) and 7 (six -> seven markers; + `b20-a1-redaction-linear` 109 lines, 4 `it(`, 1 marker);
  `b24-d1-latency-policy` 1 (15 -> 16 metrics, the seventh moved id; the foreign-suite and workload-text checks), 2 (a doubled metric
  refused), 3 (the D3 rule against the committed v1 alone; the later-declared-version counterexamples), 4 (`values_dropped`), 5 (v1's
  default budget; the latest version by shape; a declared version appended refused), 6 (the `..planted`, nested and `...` children; the
  parent and a sibling outside) and 8 (the gate's widening refusal; honesty case 10's dated title note); `threshold-classification.ts`'s
  header and two entries; `latency-baseline.json` v1 (16 metrics: this commit's file, v1 being authored, so no version is appended);
  `b24-d0-ci-split` 11 (D0's C64 sentence whole and D1's as its own); `b24-b3-live-suite-honesty` 10 (a dated note on its `it(` line);
  `b20-a1-redaction-linear.test.ts:90` and `:93`; `mcp-client-boundary.md:399`; `b24-d1-latency` header and case 4 title (the
  silent-gap wording) and case 7 (new).
- Unchanged: the route census 168 / 165 / 3 / 0, the tool counts 47 / 36 / 9 / 27, the 107 action records, the 32 migrations, the
  B01 CSV and the B17 inventory, `b23-a-provider-admission` case 8 (D1's classification keys name the provider directory under
  `app/lib/qualification/`, an admitted root), `.env.example`, `package.json`. **CONFIRMED** (section 8).

## 11. What is not measured (never estimated)

- Memory (B24-D2 extends the job; results carry `policyVersion` for it).
- Browser paint.
- Live provider latency (LB-2, LB-7, LB-9): the stream metrics drive a fake adapter.
- A deployed host (LB-13): every measurement is in-process on one machine.
- The live router (LB-3): the workflow replays the committed recording and refuses `SIRKIT_B16_1C_RECORD_ROUTES` or
  `SIRKIT_B16_1C_LIVE_ROUTER`.
- The runner itself: the numbers above are this machine's history; the baseline is BLOCKED (section 3).

## 12. What stays open

- **BLOCKED-LIVE-QUALIFICATION:** the runner baseline (section 3), the headroom of the three jobs on the D1 CI run (section 4) and
  `benchmark-latency`'s minutes per run.
- **OWNER (OD-234):** the keepalive question (D24-27's second half); `route-bench`'s two absolute budgets (keep, drop, or convert to
  baselined metrics); the job's Actions minutes.
- **INFERRED:** prompt-to-gerber's extra time from D1's suites (under a minute).
- **The lead's pin:** `b24-a1-environment-profile` case 16 pins 15 insertion rows (D0's two beside the 13 planned groups); D1 landed six
  rows where A1 planned four (lead decision D19 added `agent-boundary-suites`'s two steps), so the count moves by the difference, +2: 15 -> 17 (what the
  suite reports on this tree). The handover forbids an implementer's edit to that suite; the one-line move is drafted in section 13 and the case is red
  until the lead applies it (reported, not hidden).
- **Low (INFERRED):** `latencyResultsDocument` accepts an empty metric list, so a suite whose every case failed still writes a document
  the gate reads as `unmeasured` for each metric (blocking); nothing passes silently, but the file exists. B24-D2 may refuse the empty
  document when it extends the writer.

## 13. For the lead

### Closure clauses (one line each, for discovery section 4)

- [B24-D1, 2026-10-09] D24-28: closed offline by B24-D1 (OD-212 applied). The method: a closed metric catalogue, `sirkit.latency-results.v1` (sorted samples, the stage-09 `quantile`, `correctness: "verified"`, the environment as stage10-evidence records it), the append-only `sirkit.latency-baseline.v1` with the stage-09 budget shape plus a floor and never a `maximumP95`, `evaluateLatency` (pass / block on the band AND the floor, p95 from 20 samples / baseline_missing / sample_shortfall / unmeasured) and the widening rule over every consecutive pair through `validateThresholdChange`. The job: `benchmark-latency` (`benchmark.yml`, appended; 30 minutes, no `if:`, the flag in its vitest step's env, the directory outside the repository, the gate, `route-bench` unchanged, the headroom report, the `always()` upload). The census (`threshold-census.ts`, `threshold-classification.ts`, `threshold-census.csv` byte-pinned): 55 CI-gated bounds at `6acae24` (53 before the review round taught the scanner helper-returned and best-of-runs timings) - 33 deadline-proofs and 15 complexity-proofs kept with what each disproves, 7 performance bounds moved in place to catalogued metrics (b20-a4-observation-normalizer case 6's four, pcb-sync performance-resilience's two, b20-a1-redaction-linear's one), 13 outside CI; 178 budgets, 23 yields, 26 CI `vi.waitFor` calls in 12 files, 14 config rows. OD-30 enforced in CI from D1 on: the start and headroom steps of `prompt-to-gerber`, `page-browser-e2e` and `agent-boundary-suites` (lead decision D19), `OD30_SPLIT_REQUIRED` under five minutes. The stage-09 `REGRESSION_BUDGETS` (`qor-runtime-p95-v1`, `maximumP95` 2,000, `regression-policy.ts:57`) still gate no measured run; D1's latency budgets are the measured ones, and the corpus run belongs to B24-B2 (OD-204). `performance-and-reliability.md` part 1; suites `b24-d1-latency-policy` (10), `b24-d1-threshold-census` (7), `b24-d1-latency` (7), `b24-d1-latency-workflow` (1). The exception of lead decision D3 is version 1's alone (`DECLARED_AFTER_V1`, `values_dropped`; the gate refuses a committed baseline with an unreviewed widening), a results file carries only its own suite's metrics and a doubled metric is refused (the review round, 2026-10-09).
- [B24-D1, 2026-10-09] D24-27: closed offline by B24-D1 (OD-212 applied); the four runbook measurements (view and read commands, a granted reversible edit, one verified workflow on recordings, the first stream event and completion) are measured locally with fixed warm-ups and samples and gated on the runner baseline, which is BLOCKED-LIVE-QUALIFICATION until the owner accepts `benchmark-latency`'s minutes (lead decision D3: `baseline_missing` is a recorded, non-blocking BLOCKED state while the latest version is the declared-without-values v1). Its keepalive half is measured and stated: after `run_started` the route sends seven `warning` lines at once and nothing more until the provider answers (a 250 ms delayed fake: the silent gap's median 260.1 ms on the review round's re-run, 255.3 ms on the first local run), and the question - a protocol keepalive, or silence stated - is OD-234's, never built here.
- [B24-D1, 2026-10-09] D24-41: closed offline by B24-D1 (OD-204): `app/lib/circuit-verification/benchmark.ts` exports `executeCircuitVerificationBenchmark(operation)` and `builtin-executor.ts` dispatches the three CD-9 operations to it beside CD-8's; every value is derived from the CD-9 modules (the manifest and its digest; `humanReviewer`, `evaluateCircuitReadiness`, `createCircuitWaiver` and `classifyNativeErcCorroboration` over one full oracle run on a benchmark graph; the approved profile's `maximumRuleInstances`, a selector cut at the profile's limit, one evaluator failing `failed_isolated`). The flagged corpus run is green (`d1-green-corpus-flagged-2`: 54 passed, 2 blocked, 2 failing of 58, the two baseline-recorded failed_correctness packages only; red first on `d1-red-corpus-flagged-1`).

### The discovery section 10 line

- [B24-D1, 2026-10-09] B24-D1 landed the latency policy, the benchmark job, the threshold census and the OD-30 headroom steps (D24-27, D24-28; OD-212 applied, OD-30 amended, OD-234) and the CD-9 corpus executor (D24-41; OD-204) in one run; suites `b24-d1-latency-policy`, `b24-d1-threshold-census`, `b24-d1-latency`, `b24-d1-latency-workflow` (section 7 wrote `b24-d-*`; `CHAPTERS`' `b24-` admits both). Amendments: the "qualify 170 s in replay" of 2.6 and D24-27 is the browser spec's replay budget (`e2e/prompt-to-gerber.spec.ts:67`), the unit replay budget is 60 s (`acceptance-pipeline.test.ts:109`) and the measured replay is 770 ms median locally; 9.4's "about 19m50s" is superseded by 20 min 25 s on `b6c6b0d` and 16 min 24 s at `b3a4f2d`; "about 45" CI-gated bounds are 55 at `6acae24` (53 before the review round taught the scanner helper-returned timings); section 3's `b20-a4-observation-normalizer.test.ts:356-369` is the NFC counter's `:358-369` (its wall-clock bounds were `:338, :343, :354, :370`, moved by D1). The lead's departures from section 7's D1: the headroom steps in `prompt-to-gerber` and `agent-boundary-suites` too (D19), the non-blocking `baseline_missing` under v1 (D3), the `NON_LIVE_GATES` registration of the two benchmark suites (D2). Pins the plan did not name: `b24-b3-live-suite-honesty` 1 (19 gates in 16 files -> 21 in 18) and 10 (the flag matched as a whole name; each gate's own local run), `b24-a1-flags` 1 (62 -> 65 and the kinds pin), `b24-a2-env-names` `CLASS_COUNTS`, 5 and 10 (`GITHUB_STEP_SUMMARY`, read by the two scripts for the step summary, is a platform census row beside D1's three names; OD-195's undeclared list grows by the four), `b24-d0-ci-split` 1, 5, 7, 10, 11 and its tree constants (D1's four suites in prompt-to-gerber's selection, 472 -> 476), ci-split.md C2-C14, C16, C17, C48 and its moved-set table, observability-and-replay.md C50, B23's C14 and C46, every B21 row that cites the workflow; `b24-a1-environment-profile` 16 is the lead's move (15 -> 17 rows). The review round (2026-10-09; nine confirmed findings, each test-first) moved by review: `b24-d1-threshold-census` 1, 3 and 7 (55 / 48 / 7 / 13; seven markers), `b24-d1-latency-policy` 1-6 and 8 (16 metrics; the D3 exception version 1's alone; the writer's dotted children; a foreign suite's metric and a doubled metric refused; the latest version by shape), `b24-d0-ci-split` 11 (D0's C64 sentence whole), `b24-b3-live-suite-honesty` 10 (a dated note on its title line), `mcp-client-boundary.md:399`, `b20-a1-redaction-linear.test.ts:90, :93` (the seventh moved bound, `moved.redaction-linear-200-scrubs`).

### OD entries

## OD-212 — latency targets and the benchmark job, as applied (B24-D1, 2026-10-09)

- Question: latency targets, the reference machine, and whether the benchmark job's minutes are acceptable (discovery section 8 item 11).
- Default applied: no absolute target. B24-D1 measures p50 and p95 with fixed warm-ups and sample counts in a separate `benchmark-latency` job on GitHub `ubuntu-latest` (no fixed hardware; the runner's variance is stated as the noise band) and gates only on regression against the recorded baseline (`artifacts/ai-control-plane-b24/latency-baseline.json`, the stage-09 budget shape plus a floor, never a `maximumP95`). Deadline-enforcement unit tests keep their bounds (33 deadline-proofs, 15 complexity-proofs, each with what it disproves); performance assertions moved to the benchmark (7, each recorded in `threshold-census.csv` and on `performance-and-reliability.md`).
- Applied by B24-D1: `app/lib/qualification/latency-policy.ts`, `latency-results-writer.ts`, `threshold-census.ts`, `threshold-classification.ts`; `scripts/b24-latency-gate.ts`, `generate-b24-threshold-census.ts`; `benchmark.yml`'s `benchmark-latency`.
- The one stated exception: `scripts/route-bench.ts:86-87` throws on `p50 >= 16` and `p95 >= 50` ms, two absolute budgets that predate B24; D1 keeps the script unchanged and runs it as its own step; the question is OD-234's.
- The baseline: BLOCKED-LIVE-QUALIFICATION until the owner accepts the job's Actions minutes; while the latest version is the declared-without-values v1 (version 1 alone: a later declared version is refused, `DECLARED_AFTER_V1`, and a recorded value nulled later is an unreviewed widening the gate refuses), `baseline_missing` is a recorded, non-blocking BLOCKED state (lead decision D3), and `unmeasured`, `sample_shortfall` and a regression always block. B24-D2 amends this heading with the memory half.
- The owner may choose otherwise.

### OD-30 amendment

- [B24-D1, 2026-10-09] Enforced in CI since B24-D1: `prompt-to-gerber`, `page-browser-e2e` and `agent-boundary-suites` each record their start as their first step (`SIRKIT_JOB_STARTED_AT`) and end, after their upload step, with `scripts/ci-job-headroom.ts`, which fails `OD30_SPLIT_REQUIRED` under five minutes of headroom and `OD30_START_UNKNOWN` with no start (lead decision D19; `app/lib/qualification/ci-headroom.ts`; `b24-d1-latency-policy` 7, 9). `benchmark-latency` reports only. The three jobs' headroom on D1's first CI run is the lead's reading; no `timeout-minutes` changed. History: prompt-to-gerber 17 min 31 s of 25 on `b6c6b0d` and 13 min 10 s at `b3a4f2d`; page-browser-e2e 20 min 25 s and 16 min 24 s of 30; agent-boundary-suites 7 min 21 s of 20 at `b3a4f2d`. D1 adds under a minute to prompt-to-gerber (INFERRED).

### OD-195 amendment

- [B24-D1, 2026-10-09] The undeclared list of OD-195 as applied grows by the names read since B24-D1: `SIRKIT_B24_BENCHMARK` (qualification-opt-in), `SIRKIT_B24_BENCHMARK_DIR`, `SIRKIT_JOB_STARTED_AT` and `GITHUB_STEP_SUMMARY` (platform; the last is the runner's step-summary path the OD-30 headroom step and the latency gate append to when set). Undeclared classes, so `.env.example` does not change (D16, OD-212, OD-30; `b24-a2-env-names` 5 and 6, `b24-a2-headers` 11).

## OD-234 — B24-D1: stated choices beyond its task text, as applied (B24-D1, 2026-10-09)

- The band, the floor and the p95 rule: `practicalRegression` 0.10; `noiseBand` = max(0.20, the relative p95 spread across at least three runner runs); `floorMs` 1; a metric blocks when its p50 exceeds baseline x 1.30 AND baseline + 1 ms, the same on the p95 only from 20 samples (reported below).
- The sample counts and D: view and read 20 warm-ups and 200 samples; edit 3 and 30; first event, silent gap and completion 5 and 50 with the fake provider delayed by D = 250 ms (`STREAM_PROVIDER_DELAY_MS`); workflow 1 and 10; each moved workload 1 and 10. Every benchmark case carries an explicit budget sized to its samples and yields between samples.
- The baseline protocol: version 1 declared without values (every catalogued metric, the default budget); the first runner baseline from at least three `benchmark-latency` runs on the D1 commit through `scripts/b24-latency-gate.ts --baseline` (medians of the runs' p50 and p95, the band from the p95 spread, the run ids), appended by the lead; a widened or dropped metric, or a recorded value nulled, from the second runner version on needs a `changeRecord` `validateThresholdChange` accepts (the gate script refuses the committed file otherwise); only v1 is declared without values; `baseline_missing` non-blocking and recorded BLOCKED while the latest version is v1, blocking after that (lead decision D3).
- The results writer is a non-test module (`latency-results-writer.ts`, lead decision D15) rather than a `b11-5-capture-exactness` `justified` entry; it refuses an unset, relative or in-repository directory (a repository child named with leading dots included) before any write; a results document carries only its own suite's metrics.
- The three names (lead decision D16): `SIRKIT_B24_BENCHMARK` kind live-test-gate, class qualification-opt-in; `SIRKIT_B24_BENCHMARK_DIR` and `SIRKIT_JOB_STARTED_AT` kind tooling, class platform; no `.env.example` line. `GITHUB_STEP_SUMMARY`, the runner's step-summary path the headroom script and the latency gate append to when set, is a census row of class platform and no inventory entry (not a Sirkit name).
- The census classes and the 10x rule: deadline-proof and complexity-proof kept with what they disprove; performance (nothing disproved within 10x) moved; keys by file, title path and ordinal, never a line; a `moved` row keyed as the bound it replaced; an `elapsed` bound includes a timing returned by a helper and the best of pushed timings (the review round, 2026-10-09).
- `route-bench`'s two absolute budgets (`scripts/route-bench.ts:86-87`): the one stated exception to "gates only on regression", kept unchanged; the owner's question - keep, drop, or convert to baselined metrics.
- The job's trigger: no `if:` (every `pull_request`, `workflow_dispatch` and `schedule` run); its minutes per run UNKNOWN until the first run (locally 101.7 s and 19.8 s for the two suites); the reference machine is GitHub `ubuntu-latest`, no fixed hardware, the runner's variance stated through the noise band (discovery section 8 item 11).
- The headroom steps fail under five minutes in `prompt-to-gerber`, `page-browser-e2e` and `agent-boundary-suites` (lead decision D19).
- The keepalive question (D24-27's second half): the chat stream sends seven `warning` lines after `run_started` and nothing during the provider wait (260.1 ms median for a 250 ms wait on the review round's re-run, 255.3 ms on the first run). Add a protocol keepalive (a change to `CHAT_PROTOCOL_VERSION`, the one-terminal-event rule and the page's reader), or keep silence and state it. Not built here.
- The owner may choose otherwise.

### The LB-13 note

- [B24-D1, 2026-10-09] LB-13 note: no latency figure above is a deployed host's; every measurement is in-process on one machine, and the runner baseline waits on the owner's Actions minutes (OD-212, OD-30).

### The LB-3 note

- [B24-D1, 2026-10-09] LB-3 note: `b24-d1-latency-workflow` replays the committed router recording and refuses `SIRKIT_B16_1C_RECORD_ROUTES` and `SIRKIT_B16_1C_LIVE_ROUTER`; the live router's latency is unmeasured.

### The README row

| B24-D1 benchmark methodology and latency (D24-27, D24-28; OD-212, OD-30 amended, OD-234; D24-41, OD-204) | `performance-and-reliability.md` (part 1), `threshold-census.csv`, `latency-baseline.json`; code `app/lib/qualification/{latency-policy,latency-results-writer,ci-headroom,threshold-census,threshold-classification}.ts`, `app/lib/circuit-verification/benchmark.ts`, in place `app/lib/benchmark/builtin-executor.ts`, `app/lib/evaluation/live-suites.ts`, `app/lib/deployment/{flag-inventory,environment-names}.ts`; scripts `b24-latency-gate.ts`, `ci-job-headroom.ts`, `generate-b24-threshold-census.ts`; workflows `benchmark.yml` (`benchmark-latency`, appended), `deterministic-manufacturing.yml` (the OD-30 steps at `:32`, `:344-345`, `:405`, `:432-433`, `:565`, `:624-625`); converted in place `b20-a4-observation-normalizer.test.ts` (4), `pcb-sync/performance-resilience.test.ts` (2), `mcp/b20-a1-redaction-linear.test.ts` (1); suites `b24-d1-latency-policy` (10), `b24-d1-threshold-census` (7), `b24-d1-latency` (7), `b24-d1-latency-workflow` (1) | done 2026-10-09 offline; the runner baseline and the jobs' headroom on the D1 CI run BLOCKED-LIVE-QUALIFICATION (OD-212, OD-30); census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records, 32 migrations |

### The README rows of B24-C1..C3 and B24-D0

- [B24-D1, 2026-10-09] their workflow lines are `:381`, `:382`, `:383` (C1-C3's database-delivery entries), `:294-331` (D0's `--exclude` lines) and `:557-625` (`agent-boundary-suites`, with D1's start step at `:565` and headroom step at `:624-625`) after B24-D1's OD-30 steps; the C1-C3 drafts on their pages carry the same dated note.

### B24-D1 - Benchmark methodology and latency (2026-10-09 local; increment workflow + lead; this commit)

Test-first on `chapter/b24-production-qualification` from `6acae24`, one run. Red first: the two always-on suites and the two benchmark suites failed at collection with the policy, the writer, the headroom core and the census absent (`d1-red-1-always-on`, `d1-red-2-benchmark-unflagged`, `d1-red-3-benchmark-flagged`; nothing written under the results directory); the flagged corpus suite was red on the three CD-9 packages (`d1-red-corpus-flagged-1`: 51 passed, 2 blocked, 5 failing of 58); the census counted 53 CI-gated `elapsed` bounds with no classification (`d1-probe-census-1`; 55 once the review round's scanner followed helper-returned timings, the two new ones refused unclassified by the generator, `d1fix-gen-census-probe-1`). Landed: the policy, the writer (lead decision D15), the headroom core and script, the census scanner, its hand classification (33 deadline-proofs, 15 complexity-proofs, 7 performance bounds moved in place: b20-a4-observation-normalizer case 6's four, pcb-sync performance-resilience's two and b20-a1-redaction-linear's one) and its byte-pinned CSV (296 rows; the generator re-run twice, byte-identical, sha256 `586cb9fc...`), the gate script, the declared-without-values baseline v1, the `benchmark-latency` job appended to `benchmark.yml`, nine OD-30 lines in `deterministic-manufacturing.yml` (six groups, A1's rows), the two `NON_LIVE_GATES` entries (D2), the three names in A1's inventory and A2's census (D16; `GITHUB_STEP_SUMMARY`, read by the two scripts, a platform census row beside them), the CD-9 corpus executor (D24-41, OD-204) and the page. Measured locally (this machine, a history, never a baseline; the review round's re-run `d1fix-green-latency-flagged` 7 of 7 in 77.52 s and `d1fix-green-latency-workflow-flagged` 1 of 1 in 11.96 s; the first run `d1-green-latency-flagged` 6 of 6 in 101.69 s and `d1-green-latency-workflow-flagged` 1 of 1 in 19.81 s, its values the page's first-run column): view 0.03 and 0.04 ms, read 49.1 and 53.4 ms, edit 286.2 ms, first event 10.6 ms, silent gap 260.1 ms (D = 250 ms: the route sends seven `warning` lines at once after `run_started` and nothing during the provider wait), completion 278.0 ms, the workflow replay 669.4 ms (p50; the acceptance suite's 60 s replay budget and the browser spec's 170 s are budgets, not measurements), the moved workloads 20.1, 302.9, 865.5, 87.9, 6.0, 766.0 and 38.1 ms. The gate over both results files answers BLOCKED (`baseline_missing`, non-blocking under v1, lead decision D3), exit 0 (16 metrics on the re-run, `d1fix-gate-2`); over the latency file alone `unmeasured` for the workflow metric, exit 1 (`d1-gate-1`, `d1-gate-2`). The flagged corpus suite went green (`d1-green-corpus-flagged-2`: 54 passed, 2 blocked, 2 failing of 58 - the two baseline-recorded failed_correctness packages only). The census suite's local duration is under 5 s for both always-on suites (`d1-green-5-always-on`: 17 passed in 11.52 s with the policy suite). Gates after the pin moves: the readers chain 25 files 377 passed; the qualification directory 38 files, 384 passed, 10 skipped, 1 failed (`b24-a1-environment-profile` 16, the lead's 15 -> 17; the first after-run's nine other reds - the kinds pin, A2's cases 2, 5, 6 and `b24-a2-headers` 11 on `GITHUB_STEP_SUMMARY` and the three names, D0's cases 1, 4, 7 on the four suites in prompt-to-gerber's selection and C16, C17, C48, the census suite's 7 on a title-line note - each moved in place with a dated note); the orchestration directory with the three closeout scanners 51 files 477 passed; prompt-to-gerber 5 files 34 passed; the three generators byte-identical; tsc 0 (`d1-tsc-4`, `d1-tsc-5`); eslint 0 on 24 files (`d1-eslint-1`, `d1-eslint-2`); no CRLF, control byte or key-shaped literal in the 51 changed files. Prompt-to-gerber's duration on the D1 CI run against its 25-minute limit, the three jobs' headroom and `benchmark-latency`'s minutes are the lead's reading (OD-30 arithmetic: history 13 min 10 s of 25 at `b3a4f2d`; D1 adds under a minute, INFERRED). No baseline run ids: BLOCKED-LIVE-QUALIFICATION until the owner accepts the job's minutes. The lead's own pin: `b24-a1-environment-profile` 16 (15 -> 17 rows, lead decision D19's two `agent-boundary-suites` groups). Review round (2026-10-09; nine confirmed findings, each test-first): a legitimate runner v2 planted into the baseline turned `b24-d1-latency-policy` 3 and 5 red at `:190` and `:258` (`d1fix-counterexample-planted-v2-pre-edit`; the file restored byte-identical by sha256), the strengthened assertions failed on the unfixed sources (`d1fix-red-1-strengthened-tests`: 10 failed of 29 - policy 1-6 and 8, census 3, D0 4 and 11) and went green after the fixes (`d1fix-green-1-policy-d0` 22 passed; `d1fix-green-2-always-on-d0` 28 of 29, census 3's plant then completed, `d1fix-green-3-census` 7 of 7): lead decision D3's exception keyed to version 1 alone (`DECLARED_AFTER_V1`, `values_dropped`, the gate refusing an unreviewed widening), the writer refusing a repository child named with dots (`..results`), a results file carrying only its own suite's metrics and a doubled metric refused, case 5 checking a runner version by shape, the census following helper-returned and best-of-runs timings (b20-a1-redaction-linear's two CI bounds found, `d1fix-gen-census-probe-1`: the 2,000 ms one moved as the seventh performance bound, `moved.redaction-linear-200-scrubs`, 38.1 ms p50 locally; the 1,000 ms one a complexity-proof against the B20 page's measured 3,184 ms; connectivity-board's best-of-runs outside CI; the generator re-run twice, byte-identical, 296 rows), D0's C64 note on `dfm-quote-flow.md` restored whole, the silent-gap workload text, and honesty case 10's dated title note. Gates after the round (section 8's review-round rows): the readers chain 24 files 333 passed (`d1fix-after-readers-1`); orchestration 49 files 460 passed; qualification 38 files 384 passed, 11 skipped, 1 failed (the lead's pin, as before); prompt-to-gerber 5 files 34 passed; tsc 0 (`d1fix-tsc-2`, after one TS2345 on a test helper's literal type in `d1fix-tsc-1`, re-typed in place); eslint 0 on the 25 changed or new TS files; `generate-b24-eval-catalog` and `generate-b24-scenario-map` twice each, every B24 artifact byte-identical; the policy suite with the three closeout scanners 4 files 37 passed (`d1fix-final-policy-closeouts`; the scanners re-run on this paragraph's final text as `d1fix-final-closeouts-2`); no CRLF, control byte or key-shaped literal in the 52 changed files; only the files this round edited differ from the round's start snapshot.

### `PROGRAM_STATE.json`

- next: B24-D2 (the memory half of OD-212, `b24-d2-memory` through the same writer and the same `NON_LIVE_GATES` append; the latency results carry `policyVersion` for it).

### The one-line pin move the lead applies (b24-a1-environment-profile 16; handover rule 4: never an implementer's edit)

- `expect(insertionRowsOf(planned.page)).toHaveLength(15); // [B24-D0, 2026-10-09] ...` -> `expect(insertionRowsOf(planned.page)).toHaveLength(17); // [B24-D1, 2026-10-09] reviewed pin move (the lead's): D1's six real rows where A1 planned four groups (lead decision D19 added agent-boundary-suites's two), +2 on D0's 15; [B24-D0, 2026-10-09] ...` (the case is red on the count alone until then; every other assertion of the suite passes on this tree).

### The baseline (a records commit)

1. Collect at least three runs of `benchmark-latency` on the D1 commit (`workflow_dispatch` or PR runs; they spend Actions minutes: the owner's acceptance first, OD-212, OD-30, section 8 item 11).
2. Download their `benchmark-latency-results` artifacts, read-only.
3. `pnpm exec tsx scripts/b24-latency-gate.ts --baseline <runId>=<path to b24-d1-latency.latency-results.json> <runId>=<path to b24-d1-latency-workflow.latency-results.json> ...` (both files of each run under its run id).
4. Append the printed version to `latency-baseline.json` as version 2 with the run ids; `b24-d1-latency-policy` 5 checks it.

### No local production-mode step

- D1 changes no production module a `next build` would exercise differently (the new modules are test-time and script-time; `builtin-executor.ts` and `live-suites.ts` are data and benchmark paths); no local production-mode run is asked of the lead.

### LB rows

- None new. LB-13 and LB-3 take the dated notes above.

## 14. Citations

| id | file | line | anchor |
|---|---|---|---|
| C1 | `app/lib/benchmark/statistics.ts` | 3 | `export function quantile(values: readonly number[], q: number): number \| null {` |
| C2 | `app/lib/benchmark/regression-policy.ts` | 103 | `export function validateThresholdChange(request: ThresholdChangeRequest): string[] {` |
| C3 | `app/lib/benchmark/regression-policy.ts` | 57 | `maximumP95: 2_000` (on the `qor-runtime-p95-v1` budget line) |
| C4 | `scripts/route-bench.ts` | 86 | `if (report.direct500Tracks.p50 >= 16) throw new Error("RouteBench: direct-route p50 budget exceeded.");` |
| C5 | `scripts/route-bench.ts` | 87 | `if (report.walkAroundSingleBlocker.p95 >= 50) throw new Error("RouteBench: walk-around p95 budget exceeded.");` |
| C6 | `scripts/stage10-evidence.ts` | 33 | `environment: { platform: platform(), architecture: arch(), node: process.version, cpu: cpus()[0]?.model ?? "unknown", logicalCores: cpus().length` (on the `evidenceBase` line) |
| C7 | `e2e/prompt-to-gerber.spec.ts` | 67 | `const QUALIFY_BUDGET_MS = RECORDING ? 900_000 : 170_000;` |
| C8 | `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts` | 109 | `const QUALIFY_TIMEOUT_MS = RECORDING \|\| LIVE ? 900_000 : 60_000;` |
| C9 | `app/lib/agent/orchestration/scheduler.ts` | 64 | `dagWallTimeMs: 300_000,` |
| C10 | `app/api/chat/route.ts` | 48 | `export const CHAT_PROTOCOL_VERSION = 1;` |
| C11 | `app/lib/agent/orchestration/store.ts` | 634 | `export const ORCHESTRATION_RESUME_CREDENTIAL_SHAPES` |
| C12 | `vitest.config.ts` | 17 | `include: ["app/**/__tests__/**/*.test.{ts,tsx}"],` |
| C13 | `.github/workflows/benchmark.yml` | 9 | `permissions:` |
| C14 | `app/api/pcb-sync/route.ts` | 20 | `const workflow = getDurableWorkflowRepository();` |
| C15 | `app/lib/engineering/control-surface.ts` | 2 | ` * [B17-A] UI CONTROL SURFACE scanner` |
| C16 | `artifacts/ai-control-plane-b20/mcp-client-boundary.md` | 398 | `200 scrubs of a 4 000-character "a." leaf 1 371 ms before,` ([B24-D1 review, 2026-10-09]) |
| C17 | `app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts` | 88 | `const elapsed = (run: () => void): number => { const started = performance.now(); run(); return performance.now() - started; };` ([B24-D1 review, 2026-10-09]) |
