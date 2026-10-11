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
  `page-browser-e2e`'s at `:405` and `:432-433`, `agent-boundary-suites`'s at `:565` and `:624-625` ([B24-D4, 2026-10-10] now `:406` and `:435-436`, `:568` and `:627-628`: +1 after B24-D2's database-delivery entry at `:384`, +2 more for the lines after B24-D4's `env:` mapping at `:418-419`; prompt-to-gerber's stand) (lead decision D19; A1's
  insertion table carries the six rows). Still exactly two `playwright test` lines ([B24-D4, 2026-10-10] superseded: three, B24-D4's appended `page-browser-e2e-b24` runs the four moved specs ([B24-D4 lead, 2026-10-10] the lead's option (b): B24-D2's two with B24-D3's two), with B24-D1's start and headroom steps; `ci-split.md` section 11); no new line ends in `pnpm exec vitest run`; the
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
| `artifacts/ai-control-plane-b20/mcp-client-boundary.md:41`, `mcp-provider-connectors.md:254` | `deterministic-manufacturing.yml:131` (`app/lib/mcp`) | prose no suite resolves: the line is `:132` since D1's start step; not moved, recorded here [B24-D2, 2026-10-09] not so for `mcp-provider-connectors.md:254`: `b20-a5-connector-tripwires` T6 resolves it, red at `3d5f225`; B24-D2 moved both of its citations in place to `:132` with a dated note (`mcp-client-boundary.md:41` stays prose) |
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

- [B24-D1, 2026-10-09] their workflow lines are `:381`, `:382`, `:383` (C1-C3's database-delivery entries), `:294-331` (D0's `--exclude` lines) and `:557-625` (`agent-boundary-suites`, with D1's start step at `:565` and headroom step at `:624-625`) after B24-D1's OD-30 steps ([B24-D4, 2026-10-10] now `:560-628`, its start step at `:568`, its headroom step at `:627-628`: +1 after B24-D2's entry at `:384`, +2 after B24-D4's `env:` mapping at `:418-419`); the C1-C3 drafts on their pages carry the same dated note.

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

# B24-D2 - Large boards, memory, multi-tab, crash, restart and process cleanup (part 2: D24-29, D24-30, D24-31)

Increment B24-D2 of chapter B24 on `chapter/b24-production-qualification`, from `3d5f225` (B24-D1 committed). D2a (large boards and
memory) and D2b (multi-tab, crash, restart, process cleanup) land together in the lead's one commit (lead decision D21). The labels
are part 1's. The sections continue part 1's numbering, so a citation of "section 8" stays B24-D1's. Every number below is MEASURED,
with its runner, date and tree, or NOT MEASURED; nothing is estimated.

## 15. What B24-D2 is

- **D24-29, large boards (OD-213).** A bounded, paged board read, `sirkit.pcb.board-page-inspect` 1.0.0 (binding `read.board-page`
  1.0.0; `app/lib/pcb/ai/board-pages.ts` `buildBoardPage`): ONE layer, ONE net or ONE flat region of board-inspect's own snapshot,
  paged so that every page's whole tool result stays within 48,000 characters (`BOARD_PAGE_MAX_RESULT_CHARS`), 12,000 under the
  loop's 60,000 (`MAX_RESULT_CHARS`, `loop.ts:54`). A Tier 0 read modelled on via-inspect, agent-exposed, withheld from MCP by choice
  (OD-235). **CONFIRMED** (`b24-d2-board-read` 1-8, and 10: every size measured on the text the model receives). [B24-D2 review,
  2026-10-09] Not for a strict-mode provider: the argument shape it must send is refused by B05's validation before the read runs
  (**CONFIRMED**, case 9, a recorded defect shared with via-inspect), so D24-29 stays open for those providers (OD-236, proposed).
- **D24-29, memory (OD-212's memory half).** Six `memory` metrics in MiB in B24-D1's catalogue, writer and job: the heapUsed and rss
  deltas of board-inspect on the recorded routed boards, of the full paged read of those boards, and of board-inspect on the placed
  golden board. **CONFIRMED** locally (section 17); the runner baseline is **BLOCKED-LIVE-QUALIFICATION** (B24-D1's state, lead
  decision D3).
- **D24-30, multi-tab (OD-214).** The PCB working copy is compare-before-write: a tab never silently replaces a copy another tab saved
  after it loaded; its board becomes the project's conflict record and the tab says so. **CONFIRMED** at the unit level, red first
  (`b24-d2-working-copy` 1-5; [B24-D2 review, 2026-10-09] 6-7, red first: an idle tab's unchanged rewrite and a checkpoint restore
  no longer lock a tab out; 8 records the one-slot conflict record); the two-tab browser spec is **PROPOSED** (section 18).
  [B24-D2B, 2026-10-10] The browser spec is green in the browser (`d2b-multitab-5`, 3 of 3; the whole default configuration green -
  the orchestration configuration runs `e2e-orchestration` only, never this spec): its first run failed on four premises of the
  spec, never on the product (section 18). [B24-D2B review, 2026-10-10] That fix had dropped the fully stale tab (B never reloaded,
  Syncing after A's publication); case 1 drives it again, first: no publication is created, B's preflight is blocked as stale and B
  says so, the stale plan's apply is refused, and the board record and the server's head stay A's, each read back from the server -
  **CONFIRMED** (`d2b-multitab-7`, 3 of 3, the round-2 file alone; `d2b-multitab-6` ran an earlier case 1; [B24-D2B review 2] this
  round's file - a comment at the replay pin and the header, no assertion changed - in `d2b3-default-final`; section 18).
- **D24-30, crash (OD-214).** A browser spec closes a page mid-commit, before and after the server, and reopens it. **PROPOSED**
  until the lead's run (section 19). [B24-D2B, 2026-10-10] **CONFIRMED, a product defect, fixed test-first**: after the server
  consumed the grant, the reopened page showed the entry's pre-crash state with no notice (the silent loss OD-214 forbids); the
  editor's recovery notice now names a consumed grant no ritual of the page holds (`b24-d2-crash-recovery`, red first; the spec
  green, 2 of 2; section 19). [B24-D2B review, 2026-10-10] That notice was a 6 s toast carrying the raw word `left-in-flight` (B18's
  "still in progress"), and the reloaded entry still read "awaiting the editor's result": now the notice says `interrupted`, and the
  reloaded entry itself takes the sweep's result - interrupted (`outcome_unknown`), not made, or settled (`b24-d2-crash-recovery`
  1-3, red first; section 19). [B24-D2B review 2, 2026-10-10] A restored entry whose grant the server still holds issued is not
  started and open (`outcome_unknown`), never a terminal "not made": another open tab of the profile may still hold that grant's card
  and commit it (case 4, red first). The strengthened spec's assertions (unchanged since; [B24-D2B review 3] this round changed two
  comment lines only) are red in the browser on two older code states, each put over the working files for one run: on the code
  before the review round, (a) at `:172` and, alone, (b) at `:211` (`d2b3-crash-4-pre2code`, `d2b3-crash-5-pre2code-b`); on the
  round-2 code, (a) at `:172` (`d2b3-crash-3-round2code`). [B24-D2B review 3] No run put the code before the first fix (the notice)
  under them, and (b)'s durable-entry assertions (`:212-218`) have never been red in a browser. Green alone (`d2b3-crash-2`);
  section 19. [B24-D2B review 3, 2026-10-10] That entry still went stale at a later load: once the other tab commits, the sweep's
  work list never names the grant again, and the tab that saved its chat last restores its own sentence at every load. **CONFIRMED**
  at the unit level and fixed test-first: every editor load re-derives each restored, unsettled entry from durable truth - the
  sweep's reading of the journal and the server, or the profile journal's record of the grant's end (committed, closed,
  unverifiable, or no record any more) - and the sentences a load writes say only what held at that load, never a later close
  (`b24-d2-crash-recovery` 4 and 5, red first on the round's start code; the cross-tab path at the unit level only). The crash spec
  green on the final bytes alone (`d2b4-crash-1`) and in the default configuration (`d2b4-default-final`); section 19.
  [B24-D2B review 4, 2026-10-10] Its fourth review found four paths on which what a load writes could still be false, each
  **CONFIRMED** at the unit level and fixed test-first (`b24-d2-crash-recovery` 3 moved by review, 6-10 added, red first): a
  restored landed-unverified entry offered the editor's one-step Undo, which a reload no longer offers; a sweep whose write met an
  entry another tab had moved since the sweep read the journal reported the grant not made (its refused close ignored) or poisoned
  the other tab's execution in flight - it now writes only on the entry as it read it and otherwise reports what holds; a sweep in
  flight answered for a project the page had left; and an entry the sweep cannot settle because the canonical lineage was reopened
  promised a retry. The cross-tab paths at the unit level only. The crash spec green on the final bytes alone (`d2b5-crash-1`) and
  in the default configuration (`d2b5-default-final`); section 19.
- **D24-30, restart.** The durable board publication across a dropped process singleton, on PGlite: green on its first run,
  "not reproduced" (`b24-d2-restart-pglite`; section 20). A real-store restart is **BLOCKED-LIVE-QUALIFICATION** (LB-14).
- **D24-31's remainder, process cleanup (OD-145's method).** FreeRouting and kicad-cli end the child's whole tree
  (`app/lib/pcb/process-tree.ts`) and settle only on the child's exit or after the 5,000 ms confirm wait (`killConfirmed`).
  **CONFIRMED** offline, and with one real node process tree on win32 (`b24-d2-process-cleanup` 1-7; section 21). [B24-D2 review,
  2026-10-09] A kill whose exit was not observed is reported past the runner, in each route attempt's evidence and in kicad-cli's
  bundle error and gerbers answer (case 8, red first). The live Java and kicad-cli orphan runs are **BLOCKED-LIVE-QUALIFICATION**
  (LB-3, LB-17); OCI cleanup stays LB-10.

## 16. Large boards (D24-29, OD-213)

**What is proven.**
- The tool: Tier 0, owning command `pcb.board-repair`, via-inspect's roles, project state and authority. The descriptor is a hoisted
  function called on B22-B's spread line (`tool-catalog.ts:1060`, defined at `:1081`), so no catalogue line moved; the binding is
  appended to the activated reads (`tool-bindings-readonly.ts:321-324`), its import at the end of the file.
- The selector: exactly one of `layer`, `netName`, or the region `xMinMm`, `yMinMm`, `xMaxMm`, `yMaxMm` (all four, no minimum above
  its maximum: a region of zero width or height is a line, and is read). The cursor is `bp1.<page>.<hash>`, the hash over the schema, the board revision, the selector and the page
  (`board-pages.ts:153-154`): a cursor of another revision or another selector is refused `stale_cursor`, a malformed one
  `cursor_invalid`.
- Membership, stated in the descriptor's `verificationStrategy` and on every page: by layer, footprints with a pad on it, pads with
  copper on it, tracks on it, vias whose span includes it, zones on it, keepouts listing it; by net, the net itself, the footprints
  with a pad on it, its pads, tracks, vias and zones; by region, footprints whose body bounds meet it, pads and vias positioned in it,
  tracks whose segment meets it, zones and keepouts whose polygon's bounding box meets it. Nets are not selected by layer or region.
- Order and packing: kinds in `BOARD_PAGE_KINDS`, ids by code point within a kind; whole items only, packed greedily; an item larger
  than a whole page is refused by kind and id (`item_over_budget`) on the page where it falls, never truncated. Every page states the
  true count per kind of the whole selection.
- [B24-D2 review, 2026-10-09] The sizes are measured on the text the model receives: the loop sends every string through the
  model-bound sanitizer, which lengthens a URL-credential shape (`a://@` becomes `[redacted]`), so each item, the frame and a refusal
  count as the larger of their raw JSON and their model-bound JSON (`measured`, `board-pages.ts:260`). A refusal lists as many of
  the first 64 known names as fit a page, in their own order, beside the true count (`boundedRefusal`, `:265`); no name is cut.
  **CONFIRMED** red first (`d2fix-red-1`: footprint names made of that shape gave a 55,902-character page) and green (case 10).
- The closed refusals, answered to the model as a read (nothing guessed): `selector_missing`, `selector_doubled`,
  `region_incomplete`, `region_inverted`, `unknown_layer` and `unknown_net` (with at most 64 known names and their true count),
  `cursor_invalid`, `stale_cursor`.
- Through the real loop (`runAgentLoop`, the gateway and the registry; b18-e-via-facts' harness), on both recorded routed boards
  (`e2e/fixtures/blinker-route-fixture.json`): board-inspect is refused `output_too_large_for_model`, and a scripted model following
  `nextCursor` reads every layer and every net, each page's result text within the constant and the pages joined equal to the
  selection; the same on a deterministic synthetic board with ten times the routed blinker's tracks, and on a flat region
  (`b24-d2-board-read` 1, 3, 4). The same board and arguments give the same bytes (8).
- B11's evaluation discovers it wherever via-inspect is: the one reviewed line in `ALL_READS` (`evaluation-cases.ts:58`), B21's
  `SCANNED_AT_HEAD` sha256 for that file moved in place (`6637099755e2d0a9...` -> `2b392c0ac18c4f37...`), and every replay capsule's
  `discoveredTools` regenerated by `generate-b11-artifacts` (19 of 19 cases, 62 of 62 checks).
- The counts: 48 descriptors, 37 agent-exposed, 9 MCP, 28 agent-only (47 / 36 / 9 / 27 at `3d5f225`). MCP withholds eight: the read is
  a third withheld category, servable from durable state and withheld by choice (OD-48, OD-54; `mcp-exposure-review.ts:40`). The
  B09.1 fixture context renders 13 declarations (12 at `3d5f225`). The route census stays 168 / 165 / 3 / 0.

**The numbers.** MEASURED, deterministic (character counts, not timings), on the working tree (`3d5f225` plus B24-D2), 2026-10-09,
by a scratch probe kept outside the repository (`d2-probe-board-pages`), over every layer and every net of each board:

| board | tracks | vias | footprints | board-inspect result (chars) | selections | pages | most pages of one selection | largest page object (chars) | items refused |
|---|---|---|---|---|---|---|---|---|---|
| `pcb2-4a5fcf0e62b99bef` (routed) | 61 | 4 | 9 | 70,382 | 9 (2 layers, 7 nets) | 9 | 1 | 30,951 | 0 |
| `pcb2-b2d4a6209fb553f5` (routed) | 80 | 2 | 9 | 72,663 | 9 (2 layers, 7 nets) | 9 | 1 | 33,200 | 0 |
| synthetic: the first board's tracks ten times | 610 | 4 | 9 | 922,020 | 9 (2 layers, 7 nets) | 11 | 3 | 46,932 | 0 |

The page object's own budget is 47,000 characters (`BOARD_PAGE_OUTPUT_CHARS`: the constant less 1,000 left for the binding's and
the loop's envelope, about 160 characters in practice). `b24-d2-board-read` asserts the loop's own result text, not this probe's
object. A browser figure for a routed board: NOT MEASURED (LB-8). [B24-D2 review] The probe re-run after the measurement change
(2026-10-10, `d2fix-probe-board-pages`) gives the same pages and page sizes; board-inspect's own result differs by a few characters
from run to run (72,661 for the second board), because its snapshot carries `generatedInMs`, a timing (**CONFIRMED**,
`d2fix-probe-snapshot-diff`); the paged read selects items and never carries it, so its bytes are stable (case 8).

**BLOCKED.** The routed-board browser journey (LB-8): the browser boards are placed, and vias exist only after routing.

**Stated limits.**
- [B24-D2 review, 2026-10-09] **A recorded defect, CONFIRMED** (was INFERRED): a provider in strict mode must send every optional
  property, `null` where unset (`provider-tools.ts` renders optional properties required and nullable), and B05's argument
  validation (`validateAgainstSchema`, `tool-io-validation.ts`) refuses `null` for a property typed string or number before the
  builder runs. `b24-d2-board-read` 9 sends that shape through the real loop and gateway: `invalid_input`
  (`args.netName: must be a string`, `args.xMinMm: must be a finite number`, ...), and via-inspect's `{"netName":null}` the same;
  without the nulls both answer. Every strict-shaped call of this read carries nulls (at least five), so no strict-mode provider can
  use it, and D24-29 is not closed for them. The fix is a reviewed change to B05 argument validation, under its own decision
  (OD-236, proposed: a `null` for a property the descriptor leaves optional is read as absent); case 9 pins the refusal until then.
- The specialist rows and the coordinator prompt are unchanged: no specialist gains the read; `b21-c-least-privilege` records the
  coordinator's row and holds the read as the only difference from a registry without it.

## 17. Memory (D24-29, OD-212's memory half)

**What is proven.** `b24-d2-memory` is a non-live gate (`SIRKIT_B24_BENCHMARK` exactly `1`) in the `benchmark-latency` job's one
vitest step, which passes `--no-file-parallelism` and `--expose-gc` to its workers, the flag named twice (`benchmark.yml:93-95`,
`:113`): vitest's command line hands one value to the forks pool as a string, which the pool spreads into characters, and the worker
hangs (measured locally, `d2-probe-gc-1`); two make the array the pool expects (`d2-probe-gc-2`). Its positive control: `gc` reached
the worker, a collection moves heapUsed, and the six metrics are catalogued. Each sample runs `global.gc()` first, keeps the result
alive until it is measured, is correctness-checked, and yields between samples. Without `gc`, or with the directory unset, relative
or in the repository, the block fails NOT MEASURED before any case and writes nothing. The results go through B24-D1's one writer
(`latency-results-writer.ts`) beside D1's; the suite names no write primitive. The gate census is 22 gates in 19 files (21 in 18
at `3d5f225`), and its non-live kind 4 in 4 (3 in 3); `b24-b3-live-suite-honesty` pins both.

**The metrics** (`latency-policy.ts:66-101`): family `memory`, unit `MiB` (D1's entries are `ms`; `LATENCY_UNITS` and the `unit` and
`floor` fields added in place); 2 warm-ups and 30 samples each; floors 1 MiB (heap) and 8 MiB (rss). `evaluateLatency` is unchanged:
p50 always, p95 at 20 samples or more, regression only, against the recorded baseline within its noise band; no absolute target.

**The numbers.** MEASURED locally, 2026-10-09, on the working tree (`3d5f225` plus B24-D2; the results' `commit` is `local`), win32
x64, Node v24.15.0, Intel Core Ultra 5 125U, 14 logical cores, one worker (`d2-green-memory-flagged`: 4 of 4 passed, 52.6 s):

| metric | samples | p50 (MiB) | p95 (MiB) | negative deltas recorded as 0 |
|---|---|---|---|---|
| `memory.board-inspect-routed-heap` | 30 | 13.743 | 16.835 | 0 |
| `memory.board-inspect-routed-rss` | 30 | 0.027 | 1.696 | 14 |
| `memory.board-pages-routed-heap` | 30 | 19.988 | 25.285 | 0 |
| `memory.board-pages-routed-rss` | 30 | 0.107 | 2.162 | 14 |
| `memory.board-inspect-placed-heap` | 30 | 12.665 | 12.827 | 0 |
| `memory.board-inspect-placed-rss` | 30 | 0.180 | 1.762 | 12 |

A negative rss delta means the process returned memory during the run; it is recorded as 0 and counted, so the clamp hides no
regression (a regression is a larger value). Every rss delta sits under the 8 MiB floor; the heap deltas carry the signal. A heap
delta counts what the run allocated and had not yet collected, not only what it keeps (**INFERRED** from the method: one gc before,
none after). The gate over this directory alone (`d2-latency-gate-memory`) writes the six memory rows BLOCKED (OD-212/OD-30: baseline
not recorded; Actions minutes not accepted), non-blocking (lead decision D3), and exits 1 only because B24-D1's 16 metrics have no
results in a memory-only directory (`unmeasured`, blocking); in the job both suites write into one directory. The stage-09 sample
type's `memoryMiB` (`app/lib/benchmark/types.ts:242`) stays unfilled: the memory metrics live in `sirkit.latency-results.v1`.

**BLOCKED.** The runner baseline (at least three `benchmark-latency` runs, then `--baseline`): until the owner accepts the Actions
minutes (OD-212, OD-30), the memory metrics' `baseline_missing` is the recorded, non-blocking BLOCKED state. A browser heap figure:
NOT MEASURED, and not claimed (LB-8).

## 18. Multi-tab (D24-30, OD-214)

**What is proven.**
- The defect, **CONFIRMED** at the unit level on `3d5f225` (`d2-red-working-copy`: 2 failed, 3 passed): the tabs of one browser
  profile share the project's working copy (localStorage), and tab B's save after tab A's returned `true` and replaced A's copy - no
  conflict record, nothing said (the task's INFERRED reading of `board-persistence.ts:188-192`).
- The fix, compare-before-write (`saveWorkingCopy`, `board-persistence.ts:188`; the helpers from `:216`): each tab (each module
  instance) remembers the write token of the copy it last loaded or saved (`writeId` on the copy, `lib/persistence.ts:53`; an older
  copy without one is known by its `updatedAt`). A save over a copy another tab wrote since is refused `WORKING_COPY_CONFLICT`, its
  board stored as the project's conflict record (the existing `pcbWorkingConflict`, the other tab's copy kept in place), and
  PcbEditor says so (`WORKING_COPY_CONFLICT_TOAST`, `PcbEditor.tsx:1100`). Writing the very board another tab wrote loses nothing and
  is no conflict (two idle tabs autosaving); a tab that never loaded a copy writes as before; a storage failure stays `false`. No
  cross-tab channel is used (no BroadcastChannel, storage listener or lock): the compare happens at the write. `b24-d2-working-copy`
  1-5 green; the project and editor suites green (section 22).
- [B24-D2 review, 2026-10-09] Two lockouts the review found, each **CONFIRMED** red first (`d2fix-red-1`: "expected 'conflict' to be
  true") and fixed:
  - an idle second tab locked the first out: every save minted a new token, so B's hydration autosave of the very board it loaded
    made A's remembered token stale, and A's next edit - every later autosave, and the AI tender's flush - was refused as "another
    tab". Now a write that changes no board keeps the stored copy's own token (`prepareWorkingCopyWrite`,
    `board-persistence.ts:247`): the stored board itself, or the very board the tab holds with nobody writing since (a load
    remembers the normalized board it hands the editor, `:181`); a legacy copy keeps its `legacy:` token the same way. A conflict
    still needs the token moved AND the stored board being neither this board nor the one the tab held (case 6); [B24-D4, 2026-10-10]
    superseded in part: when the token moved and the stored board is this board but not the one the tab held, nothing is written and
    the tab keeps the copy its board derives from as its base - the stored token was adopted as the tab's own before, CI's path of
    `multi-tab` case 2 (section 29; case 9); [B24-D4 review, 2026-10-10] a tab that holds no copy's board (it loaded none) still
    writes a stored copy of its very board under that copy's token and takes it for its own, as at `1fe719e` (`:255`; case 11);
  - a same-tab checkpoint restore: page.tsx persists the restored board with no token, and an edit before its first autosave was
    refused in a single tab. The editor's two checkpoint-restore adoptions now make the stored copy the tab's own
    (`rememberStoredWorkingCopy`, `:261`; `PcbEditor.tsx:602`, `:629`, in place; case 7). page.tsx is not edited. [B24-D4, 2026-10-10]
    Only the copy page.tsx persisted (it carries no write token) is adopted; a copy with one is another tab's, written since the
    restore (the load effect adopts after a board load), and is never taken for the tab's own (`:262`, in place; case 10).
    [B24-D4 review, 2026-10-10] Superseded: the adoption is told by the board, not the token - `rememberStoredWorkingCopy(projectId,
    restoredBoard)` takes the stored copy when it holds the very board restored (page.tsx's copy, or another tab's unchanged rewrite
    of it, case 12) and never another board (another tab's edit, case 10, or its own token-less restore, case 13); both adoptions
    pass the board they adopt (`PcbEditor.tsx:602`, `:629`, in place; case 7 reads them).
  - Case 4 now saves straight after the stash, with no reload, so it rests on the stash's own memory: deleting
    `rememberWorkingCopy(projectId, null)` from `stashWorkingConflict` turns it red (`d2fix-mutation-case4`; the file restored, its
    sha256 `82ecf8c6...` checked). Each of the eight cases carries a 30 s budget: each resets the module graph, and case 1 ran
    1.5-2.5 s locally (lead lesson 14).
- **A limit, CONFIRMED** (case 8, a recorded limit, not a claim): the conflict record is one slot. With two tabs, a refused save's
  record is replaced by a later load-time stash of the other tab's copy (PcbEditor's stash when the server moved past the copy's
  base), and the reverse; the third-tab variant too. "Preserved as a recoverable conflict record" holds until the next conflict on
  that project. A record per conflict is more than a compare-before-write (the task's limit): OD-214's open item.
- The durable write, the sync publication, already refuses a stale base on the server (`PS_SNAPSHOT_REVISION_CONFLICT` and the
  conflict dialog; scenario 12's evidence). The spec's case 1 drives it from two tabs; expected "not reproduced".

**PROPOSED (the lead's browser run).** `e2e/multi-tab.spec.ts` (uuid namespace `b24d2000`): one context, two pages on one
synchronized board. (1) Both edit the schematic and Sync: B is refused with the dialog, and the server's head stays A's. (2) A nudges
R3, then B, loaded before that edit, nudges it twice: B's save is refused with the toast, A's copy stays, and after both reload A's
board is the working copy and B's the conflict record. (3) An init script counts BroadcastChannel constructions, storage listeners
and `navigator.locks` requests on every document of the context: none. Not run here. Risks (**UNKNOWN** until run): case 1's edit
path (Go to on the sheet, the Value field), a hydration refresh between the two nudges, and a bundled library opening a
BroadcastChannel would fail case 3 for a reason outside the editor.

**The browser run ([B24-D2B, 2026-10-10]).** The lead's default run (2026-10-10: 56 passed, 2 failed, 2 did not run) failed case 1 at
`:143` in 925 ms, "B hydrated a snapshot head" (null); cases 2 and 3 did not run. Reproduced alone with the artifacts kept
(`d2b-multitab-1`: 1 failed, 2 did not run, exit 1, 26 s). **The spec was wrong, four times; the product never** - each premise read
from the run's trace (`trace.zip`, its network records and response bodies) and from the code:
1. The head. The editor's publication base is the manufacturing truth's `snapshot.revision`, which only the
   `GET /api/pcb-sync?boardId=...&include=manufacturing` load carries (`PcbEditor.tsx:1185-1196`); a plain board load carries the
   record only. The spec took `.at(-1)` of every load in the order the responses completed: in `d2b-multitab-1` B's three loads were
   plain (222 ms), plain (351 ms) and the manufacturing one (267 ms, `manufacturing.snapshot.revision` 1), so the last was a plain
   one. Fixed: `headLoad` (`multi-tab.spec.ts:251`; the spec's lines as they stand after the review round) takes the page's last
   manufacturing load, for B's head and for the replay of A's.
2. The control. `sync-schematic-to-pcb` is the empty state's button only (`PcbEditor.tsx:2444`); on a board, Sync is the toolbar's
   `SyncButton` ("Schematic to PCB"). `d2b-multitab-2` (1 failed, 2 did not run, exit 1, 157 s) waited the 90 s window for the test
   id. Fixed: the button by its role and name (`:99`).
3. The wire. The publication's body is `{ operation: "publish_demo_snapshot", request: { requestId: "publish:..." } }` and a new
   publication answers 201 (`app/api/pcb-sync/handler.ts:130`); the matcher read `requestId` at the top level and the case expected
   200. `d2b-multitab-3` (1 failed, 2 did not run, exit 1, 156 s): A's publication was created (201, revision 2) and never matched.
   Fixed: the matcher reads `request.requestId` (`:97`); A's answer must be 201 with `created: true` at revision hydratedB + 1
   (`:155`, stricter than 200, which an idempotent replay also answers).
4. Two tabs cannot both edit the schematic. `d2b-multitab-4` (1 failed, 2 did not run, exit 1, 47 s): A published revision 2 (201);
   B's edit, made on the schematic head it loaded before A's edit, was refused by the tabs' shared canonical store and rolled back,
   and B said so (`"Changed R1 value to 6.8k" could not be committed and was rolled back (STORE_HEAD_MISMATCH:1). The schematic is
   unchanged.`, `schematic-session.ts:1085`; the browser store's head check `browser-indexeddb-store.ts:24`); B's Sync then published its
   unchanged schematic under the idempotency key of the bootstrap's revision 1 and was answered as that publication's replay (200,
   `created: false`, `idempotent: true`, `snapshotRevision` 1) although the head was 2; B's preflight (05:11:29.272Z) answered
   `blocked_stale_snapshot`, and B showed "Sync blocked: ..." with the toolbar's "Apply sync plan" still offered. The run failed at
   the 409 check, before any apply and before any read of the head. [B24-D2B review, 2026-10-10] So "nothing was overwritten" on that
   path was an inference from the code when first written here, never a run (the review's finding, which holds). Fixed then: B's
   refused edit is asserted (the notice, a protection the spec did not claim, `:153`); B reloaded before A published, A published,
   B edited and Synced on the revision it hydrated: refused `PS_SNAPSHOT_REVISION_CONFLICT`. Every assertion of the contract was kept;
   `editValue` holds the field to the typed value only for an edit that commits. [B24-D2B review] But that fix dropped the fully
   stale tab's path - a tab that never reloaded and Syncs after the other tab's publication - which is restored below.

Green alone: `d2b-multitab-5`, 3 passed (1.2 m: case 1 25.7 s, case 2 22.7 s, case 3 25 ms), exit 0. Cases 2 and 3 passed on their
first run: the compare-before-write holds in the browser (B's save refused, its board kept as the conflict record, A's copy kept
across both reloads; "not reproduced") and no document of the context made a BroadcastChannel, a storage listener or a locks request.
In the whole default configuration (`d2b-default-final`): 60 passed (9.2 m), exit 0, the three cases 29.5 s, 23.4 s and 2 ms; the
orchestration configuration (`d2b-orch-final`): 4 passed (2.7 m), exit 0 ([B24-D2B review 2] its `testDir` is `./e2e-orchestration`:
it never runs this spec or the crash spec).

**The fully stale tab, restored ([B24-D2B review, 2026-10-10]).** Case 1 (`multi-tab.spec.ts:146`) now runs the original path first
and the conflict after it. A edits; B's edit is refused (the notice, `:153`); A publishes (201, revision 2, `:155`); B, never
reloaded, Syncs (`:164`). Asserted, each read back from the server and never inferred: the publication is not created - the replay
of the revision B hydrated (200, `created: false`, `idempotent: true`, `snapshotRevision` 1; `:165-166`); B's preflight is
`blocked_stale_snapshot` with `PS_SCHEMATIC_REVISION_MISMATCH` among its blockers, and B shows "Sync blocked: ..." (`:170-172`); any
apply B is offered is refused - a 4xx, `ok: false`, no board change, and B says "Apply failed: ..." (`:173-186`); the board record
(A's editor's own plain board load replayed, its revision and digest) and the server's head are unchanged (`:187-191`). Then A edits
again, B reloads (its head: revision 2, A's), A publishes (201, revision 3), B edits and Syncs on revision 2: 409
`PS_SNAPSHOT_REVISION_CONFLICT`, the dialog names revision 2 and revision 3, nothing was overwritten, the head is 3 (`:193-214`).
Every earlier assertion of the case is kept (the reload's head and the dialog's revisions are now those of B's reload).
- `d2b-multitab-6`: 3 passed (2.2 m; case 1 1.4 m), exit 0, on an earlier version of case 1 ([B24-D2B review 2] five lines fewer:
  that run lists cases 2 and 3 at `:212` and `:237`, and attaches no `stale-tab.json`); the server log shows the stale tab's
  publication 200, its preflight 200 and its apply 409, the annotation "offered for the blocked plan; clicked; refused".
- `d2b-multitab-7` (the record attached as `stale-tab.json`), the round-2 file alone: 3 passed (1.4 m; case 1 34.8 s, case 2 22.1 s,
  case 3 2 ms), exit 0.
  The record: the publication 200, `created: false`, `idempotent: true`, `snapshotRevision` 1; the preflight `blocked_stale_snapshot`
  (`PS_SCHEMATIC_REVISION_CURRENT`, `PS_SCHEMATIC_REVISION_MISMATCH`, `PS_RESOLVER_BATCH_COMPONENT_SET_MISMATCH` beside the component
  and net blockers of a superseded snapshot); the apply offered for the blocked plan and refused 409
  `PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH` (the stale plan's lifecycle is `validated`, never `applicable`: `app/lib/pcb-sync/service.ts:357`,
  `:394`); the board `pcb2-df5810b9fdbc2ad2` / `pb1-a7bd41f9...` before and after; the head 2, A's.

**CONFIRMED by these runs: a fully stale tab's Sync creates no publication, changes no board record and moves no head - the product
was right on what was tested.** [B24-D2B review 2, 2026-10-10] That is narrower than "overwrites nothing", as first written here: the
third observation below is a replacement of state the tabs share, read from the code and never from a run. Recorded (section 26), not
changed here:
- The stale tab is answered the replay (200, `created: false`, `idempotent: true`, `snapshotRevision` 1: **CONFIRMED**,
  `stale-tab.json`). Why, **INFERRED** from the code: the replay check compares the digest, the board and the actor, not the expected
  revision (`app/lib/pcb-sync/durable.ts:84`), and the editor's key is content-addressed (`publish:<digest>`, `PcbEditor.tsx:911`).
  What stops it is the preflight's stale gate and the apply's lifecycle check, both CONFIRMED above. The spec pins the replay
  (`multi-tab.spec.ts:166`) as today's behaviour under the open owner question (OD-214, `durable.ts:84`); the comment at that line
  says so, and the pin moves by review - to a 409 `PS_SNAPSHOT_REVISION_CONFLICT`, with the preflight and apply steps after it - if
  the owner chooses the conflict.
- The toolbar offers "Apply sync plan" for a blocked preflight's plan (**CONFIRMED**: offered, clicked and refused 409 in `-6` and
  `-7`, the annotation; the button renders for any preflight that carries a plan, `PcbEditor.tsx:2565`); the tab says "Apply failed:
  ...". A gap in what the tab offers, not in what the server allows. The refusal assertions run only when the button is visible at
  that moment (`isVisible()`, a check that does not wait, `:174`); it was visible in every run.
- **INFERRED** from the code (the spec reads no stored snapshot revision): the replay's revision is saved as the project's remembered
  snapshot revision (`savePcbSnapshotRevision`, `PcbEditor.tsx:923-924`, for every publication answered ok, `owned-operations.ts:230`;
  one localStorage key per project, `board-persistence.ts:69`),
  so B's stale Sync replaces the 2 that A's publication stored with 1 - itself an overwrite of state the tabs share; a load takes the
  server's head over it (`:1190-1196`). CONFIRMED only that B's reload hydrated 2 (its head load) and that its conflict named 2.

In the whole default configuration with these specs: `d2b2-default-final` - 57 passed, 1 failed, 2 did not run (9.0 m), exit 1: case
1 ended with "worker process exited unexpectedly (code=3221226505)" (0xC0000409) after its last server call (B's 409; the server log
shows every call of the case up to it, and no replay of the head after it), with no assertion failed, no JavaScript error and no V8
out-of-memory message in the log; cases 2 and 3 did not run. The spec was green alone once before it on the same bytes
(`d2b-multitab-7`; [B24-D2B review 2] `-6` ran an earlier case 1, as first written here "twice"). The whole configuration again,
with the node processes' memory sampled every 5 s (`d2b2-default-final-2`, `mem-default-final-2.csv`): 60 passed (9.5 m), exit 0 -
the three cases green; the Playwright worker's peak private memory 519 MB, `next dev`'s 2,125 MB. The crash's cause is **UNKNOWN**
(no memory pressure seen in the rerun; nothing in the log names it); it is recorded, never called a flake. The orchestration
configuration (`d2b2-orch-final`): 4 passed (2.6 m), exit 0 (it does not run this spec).

[B24-D2B review 2, 2026-10-10] This round's file (the header, and a comment appended to the replay pin's line `:166`; no line moved, no
assertion changed) ran in the whole default configuration, `d2b3-default-final`: 60 passed (9.5 m), exit 0; the three cases 42.2 s,
24.9 s and 24 ms. Not run alone on these bytes. The orchestration configuration (`d2b3-orch-final`): 4 passed (2.6 m), exit 0.

[B24-D2B review 3, 2026-10-10] The same file (unchanged this round, `bc3c38db...`) ran in the default configuration on this round's
code, `d2b4-default-final`: 60 passed (10.4 m), exit 0; the three cases 1.6 m, 25.9 s and 1 ms. Case 1's 1.6 m came with six browser
warnings "Maximum update depth exceeded" from the view-session bus (`useViewSession.ts:89`, `bus.ts:217`) after the reloaded tab's
refused publication; the same six, with a 1.4 m case 1, are in `d2b-multitab-6` on the review round's code, before this round's
changes, and in no other recorded run: cause **UNKNOWN**, recorded, never called a flake (section 19). Not run alone on these bytes.

[B24-D2B review 4, 2026-10-10] The same file (unchanged, `bc3c38db...`) ran in the default configuration on the fourth review round's
code, `d2b5-default-final`: 60 passed (10.4 m), exit 0; the three cases 1.4 m, 25.2 s and 25 ms. The same six "Maximum update depth
exceeded" warnings with the same stack (`useViewSession.ts:86`, `:89`, `bus.ts:217`) appear again: cause still **UNKNOWN**, recorded,
never called a flake. Not run alone on these bytes.

**The numbers.** The durations above are one local run's each (win32, `next dev`, the fixture runtime); no timing is gated.

**BLOCKED.** None live.

## 19. Crash (D24-30, OD-214)

**PROPOSED (the lead's browser run).** `e2e/crash-recovery.spec.ts` (uuid namespace `b24d2c00`; the fixture runtime's scripted
agent, "Move R3 2 mm to the right.", the confirmation card): (a) the tender (`POST /api/agent/execution-grant`) is held before it
reaches the server, the page closed without beforeunload and a new page of the same context opened: nothing applied, the entry not
committed, the grant not consumed; (b) the tender is forwarded (`route.fetch()`: the grant consumed) and the page closed before the
response: on reopen the change is never applied twice, and never lost without a notice (a recovery notice, or the entry's own
state). The outcomes found are attached to the run as `crash-outcome.json`. Expected "not reproduced" for both; a double apply or a
silent loss is a counterexample. B18's recovery contract has its unit proof (`b18-c-recovery-inflight`).

[B24-D2 review, 2026-10-09] (b) as first written passed a silent loss: its wait ended as soon as the entry existed, and a reloaded
entry is a static record of its pre-crash state (`issued`, `executing`), which "a notice, or the entry's own state" accepted
(**CONFIRMED** by reading `page.tsx:4390-4392`, "a reloaded entry is a static record", and `app/lib/project/chat-run-view.ts:519-520`,
which returns every entry not `committed` unchanged; the two rules tabulated in
`d2fix-crash-predicate`, a copy of the logic, not a browser run). Now: the wait ends only on the recovery notice naming the grant or
the entry in a settled state; if R3 did not move, the page must show that notice or the entry as `not_made`, `outcome_unknown` or
`landed_unverified` - a pre-crash state with no notice fails as the silent loss; and the positive control: the server's grant
records its consumption (else the tender never reached the server, and the run is (a) again). (a) now also checks that no
consumption is recorded. Still PROPOSED until the lead's run. A risk, **UNKNOWN** until run: if the change lands on reopen while the
reloaded entry keeps its pre-crash state, the unchanged landed branch (the entry `committed` or absent) fails although nothing is
lost; read such a failure with `crash-outcome.json` before calling it a counterexample.

**The outcomes found.** NOT MEASURED: the spec has not run. A risk for (b), **UNKNOWN** until run: the frozen fixture clock against
the commit window.

**The browser run ([B24-D2B, 2026-10-10]): (b) found a silent loss - a product defect, CONFIRMED, fixed test-first.** The lead's
default run (2026-10-10) failed (b) after 38.3 s at `:196`: R3 did not move, the entry still showed `executing` after the reopen, and
no recovery notice named the grant. Reproduced alone with the artifacts kept (`d2b-crash-1`: (a) passed 13.7 s, (b) failed 37.2 s at
`:196`, "no recovery notice names xg-b670cd464 and the entry shows executing"; 1 failed, 1 passed, exit 1, 91 s). The trace's network
records:
- 04:55:21.386Z the page's tender `POST /api/agent/execution-grant`, never answered (the page closed: -1); 04:55:21.389Z the same
  tender forwarded by the spec's `route.fetch()`, 200: `consumed`, attempt `eng1-52a281240a0b001f`, `consumedAt`
  2026-09-09T12:00:00.000Z, `commitDeadline` 12:01:00.000Z (the frozen fixture clock).
- 04:55:23.683Z the reopened page's recovery sweep read the grant: `consumed` by that same attempt, the journal's prepared one. The
  sweep marks it consumed and leaves it in flight ("the server consumed this attempt; the commit window is open",
  `granted-executions.ts:616-618`). The page then read no grant for 30.8 s (the next read, 04:55:54.470Z, is the spec's own
  positive control, `consumed`).
- The notices (`crash-outcome.json`): the only recovery notice named (a)'s grant, `xg-d19d43c11... abandoned-not-committed` (the
  server had retired it, superseded by (b)'s). For (b)'s grant: none; the reloaded entry read "Executing in the PCB editor - ... -
  awaiting the editor's result (interrupted by reload)" (`error-context.md`), its persisted pre-crash state.

**Product or spec: the product.** The spec's premise held (the grant consumed, its positive control) and its wait was not the cause:
the editor's notice named only the four settled actions (`PcbEditor.tsx:1691`, before this fix), the page skips `left-in-flight`
(`page.tsx:6460`), and the editor sweeps once per lifecycle (`PcbEditor.tsx:1684-1686`), so no wait inside the reopened page could
show a notice; in the fixture runtime the page's and the server's clocks are both frozen, so the commit window never closes either.
OD-214's contract - a reloaded entry in its pre-crash state with no recovery notice is a loss - was not delivered.

**The fix, test-first.** `b24-d2-crash-recovery` (new, one case, the B18-C harness: the real canonical session, journal, grant store
and consume and settle services; the dead page's tender reaches the server and its answer never returns; the reopened page is a fresh
editor over the same project with a fresh claim registry): red first with the notice moved verbatim out of PcbEditor into
`executionRecoveryNotice` (`d2b-red-crash-unit`: 1 failed of 1, "the reopened page names the consumed grant ...: expected null to be
'AI execution recovery: xg-e2227b9c1… …'", vitest's truncation; everything before it held: the grant consumed, the journal's attempt
prepared, the same page's sweep silent, the reopened sweep's `left-in-flight`, R3 unmoved). The fix (`granted-executions.ts`, in
place at `:578`, `:595`, `:597`; the function appended at `:674`; re-exported by the controller, `:54`; PcbEditor in place at `:65`
and `:1691-1692`): the sweep marks the one result an execution of THIS page's own ritual produces (`heldHere`, B18-C I10b's case),
and the notice names every other grant left in flight - the four settled actions' notice unchanged byte for byte. Green:
`d2b-green-crash-unit`, 4 files, 13 passed (the new case with `b18-c-recovery-inflight`, `b18-b-granted-executions`,
`b18-e-lost-settlement`); the same case asserts that a sweep after the commit window and its grace settles the grant not committed,
named, and that R3 never moved.

**Green.** Alone: `d2b-crash-2`, 2 passed (35.9 s: (a) 8.2 s, (b) 8.6 s), exit 0. `crash-outcome.json`: (b) R3 not moved
(50,000,000 nm before and after), the server's grant `consumed` (the positive control), the entry `executing` (the reloaded static
record) and the notice "AI execution recovery: xg-b44c0b0bf... abandoned-not-committed; xg-421382eda... left-in-flight." naming it;
(a) not moved, the grant `issued`, no consumption recorded. Never applied twice; never lost without a notice. In the whole default
configuration (`d2b-default-final`): 60 passed, exit 0, (a) 6.8 s and (b) 7.1 s; the orchestration configuration 4 passed, exit 0
(it does not run this spec).

**Recorded limits, not claims** (as first written; [B24-D2B review, 2026-10-10] the first two sentences are superseded by the review
round below). The notice is a toast; the reloaded entry stays a static record of its pre-crash state
(`page.tsx:4390-4392`), never updated by the sweep. The settlement itself waits for a sweep after the commit window and its grace
(B18-B's Crash C; `b24-d2-crash-recovery` with the clock advanced), and the editor sweeps once per lifecycle: in a page left open
past the window the grant is settled at the next reopen, and in the fixture runtime, whose clocks are frozen, never. A re-sweep
scheduled for the commit deadline is not built (a proposal for the lead, section 26).

**The review round ([B24-D2B review, 2026-10-10]): the notice was transient and misleading - CONFIRMED, fixed test-first.** The review
found that the fix met (b)'s check but only weakly OD-214's substance ("never lost without a notice"). It holds, by reading and by run:
- The only notice was the editor's single-slot toast, cleared after 6 s (`PcbEditor.tsx:712`), naming the grant with the sweep's raw
  word `left-in-flight`, which B18's vocabulary renders "Still in progress — the change's own execution finishes it."
  (`execution-display.ts:235`): false once the page running it is gone.
- The reloaded entry kept "Executing in the PCB editor - ... - awaiting the editor's result (interrupted by reload)". A reloaded entry
  is a static log record the page holds no live entry for (`executionEntriesRef` starts empty; `fromStoredChat`, `page.tsx:2959-2967`),
  so NO sweep result ever reached it after a reload, whatever the action: in `d2b-crash-3` (a)'s grant, `abandoned-not-committed` at
  (b)'s reopen, also kept "Executing ... (interrupted by reload)" (`error-context.md`). The spec's notice log records any transient
  text, so `d2b-crash-2` proved that a toast rendered, not that the person stays told the change did not land.

Red first. `b24-d2-crash-recovery` case 1 now pins the truthful notice; cases 2 and 3 pin the durable entry, with the page's rule moved
verbatim into `recoveryDisplayAction` and `restoredEntryRecovery` (`chat-run-view.ts`: `left-in-flight` never shown, a restored record
unchanged) and `page.tsx:6460` rewired to them in place: `d2b2-red-crash-unit`, 3 of 3 failed, exit 1 ("expected 'AI execution
recovery: xg-4674dec17… …' to be ...", vitest's truncation; "a grant left in flight that no ritual of this page holds is shown as
interrupted: expected null to be 'interrupted-in-flight'"; "abandoned-not-committed: expected 'executing' to be 'not_made'"); then,
with the never-started case added, `d2b2-red-crash-unit-2`, 1 of 3 failed, exit 1 ("expected 'executing' to be 'not_made'"). The spec
strengthened - (b): the notice names the grant and never calls it in progress, and once the transient notice is gone the entry itself
is `not_made`, `outcome_unknown` or `landed_unverified` and never reads "awaiting the editor's result" (`crash-recovery.spec.ts:207-218`).
(b) was red in the browser in `d2b-crash-3`: failed at `:204` of that run's spec (now `:211`), "the notice never calls the crashed
execution in progress", received "AI execution recovery: xg-ffabcf712… abandoned-not-committed; xg-9cba534e8… left-in-flight."; (a)
passed (12.6 s); 1 failed, 1 passed, exit 1, 59 s. [B24-D2B review 2, 2026-10-10] Two precisions the second review found, both
holding. (a)'s requirement on the reopened entry (`:169-174`) was not in the spec `d2b-crash-3` ran - it was added after
`d2b-crash-4` - so as first written here "red in the browser" held for (b) only, and (a)'s only red was the unit run
`d2b2-red-crash-unit-2`. And `d2b-crash-3` did not run the old code as kept: `page.tsx` was already rewired to a first stub of
`recoveryDisplayAction` and `restoredEntryRecovery` (written with a heredoc, then replaced; its bytes cannot be inspected). Both
are now shown in the browser on exact bytes (the second review round, below).

The fix:
- the notice names such a grant `interrupted (not running in this page; no change from it is recorded on this board)`
  (`granted-executions.ts:676`, the item at `:682`); the four settled actions' notice is unchanged;
- `recoveryDisplayAction` (`chat-run-view.ts:676`): a grant left in flight that no ritual of this page holds is `interrupted-in-flight`,
  one this page's own ritual holds is never shown (B18-C I10b); its sentence (`execution-display.ts:235`, in place): "Interrupted — the
  server started this change, but no execution of it is running in this page and no change from it is recorded on this board. Unless
  another open tab of this project is still making it, it is closed as not made once its commit window has passed, the next time the
  editor loads this project." A live entry takes it as `outcome_unknown` with the next step "Check the board; ask again if you still
  want the change." (`entryRecovery`, `chat-run-view.ts:313`, in place); B18's own `left-in-flight` for a live entry is unchanged;
- `restoredEntryRecovery` (`chat-run-view.ts:702`): a record restored after a reload takes what a live entry takes, written as
  `entryToLogMessage` writes it (interrupted: `outcome_unknown`; `abandoned-not-committed`: not made; adopted: committed, with a hint a
  reloaded record keeps; poisoned: landed unverified), and two cases only a reload has: a grant the server still holds issued
  (`left-issued`) was made a terminal not made - "Not made — the page closed before the server started this change, and its
  confirmation card does not survive a reload. Nothing was changed." (B18's live "confirm or cancel it" is false after a reload: the
  card is the page's in-memory state; [B24-D2B review 2] superseded: false while another open tab holds the card, see the second
  review round) - and an unreadable one (`unavailable`) is of unknown outcome. A restored record is never shown as running; it is
  persisted with the chat (the messages' autosave). That it survives a further reload is shown only through `storedAndRestored`,
  the unit test's replica of the page's store-and-restore closures (`page.tsx:2952-2967`): **INFERRED** for the page itself, since no
  browser run reloads after the entry settles ([B24-D2B review 2]; as first written here, stated as fact). Every other row is kept;
- `page.tsx:6460`, in place: a live entry as before, a restored one through `restoredEntryRecovery` (no line of page.tsx moved; B18-D's
  wire `onExecutionRecovery=...entryRecovery(` kept).

Green: `d2b2-green-crash-unit` (3 of 3, before the never-started case) and `d2b2-green-crash-unit-2`, 3 of 3, exit 0. The spec alone:
`d2b-crash-4` (2 passed, 40 s, exit 0; [B24-D2B review 2] a spec without (a)'s requirement, on the code before the never-started
case: its `crash-outcome.json` records (a)'s entry `executing`) and `d2b-crash-5`, the only run of the round-2 spec and code: 2
passed (40.1 s: (a) 8.5 s, (b) 12.7 s), exit 0. Its `crash-outcome.json`: (a) R3 not moved, the grant `issued`, no consumption, the
entry `not_made` ([B24-D2B review 2] the state superseded below); (b) R3 not moved (50,000,000 nm before and after), the grant
`consumed` (the positive control), the notice "AI execution recovery: xg-e7a264e06… abandoned-not-committed; xg-317bfab57…
interrupted (not running in this page; no change from it is recorded on this board).", and, after that notice was gone, the entry
`outcome_unknown`, reading "Interrupted — the server started this change, ...". Never applied twice; never lost without a notice,
now one the entry keeps. The default configuration: section 18 (`d2b2-default-final-2`, 60 passed); the orchestration configuration
(`d2b2-orch-final`, 4 passed) does not run this spec.

**Recorded limits after the review, not claims.** The settlement still waits for a sweep after the commit window and its grace, and
the editor sweeps once per lifecycle: the entry says so ("the next time the editor loads this project"); a re-sweep at the commit
deadline is not built (section 26). The interrupted sentence cannot tell a page that crashed from another open tab still making the
change (the claim registry is per page), so it names both. The transient notice still uses the sweep's terse words for the four
settled actions (`abandoned-not-committed` and the rest); the entry carries their sentences.

**The second review round ([B24-D2B review 2, 2026-10-10]): a restored, still-issued grant shown as "not made" - fixed test-first;
every claim made exact.** The review found eight problems: one in the product, seven in what this page and the specs claimed. Each
run below ran the bytes it is cited for: the older code states' sha256 are in the swap records, the red unit run's code is the
round's start (its snapshot), and since the green runs no file they used has changed except this page.

*The product.* `left-issued` is a journal attempt still `prepared` whose grant the server still holds `issued`
(`granted-executions.ts:615`). The journal is the profile's (IndexedDB, `PcbEditor.tsx:1541-1542`, shared by its tabs), the claim
registry the page's (memory), and the tab that holds a card keeps it after a tender that got no answer (`refusalKeepsPreviewCard`,
`granted-executions.ts:79`). So a second tab's sweep reads `prepared` + `issued` while the first tab can still confirm and commit -
and the restored entry was made a terminal "Not made ... Nothing was changed.", which no later result can move (`TERMINAL`,
`chat-run-view.ts:190`). **CONFIRMED** at the unit level: `b24-d2-crash-recovery` case 4 (the B18-C harness) holds tab A's Confirm
before the server, opens tab B as its own editor over the same durable store (`reloadEditor`) with its own claim registry and the
chat A saved, and B's sweep answers `left-issued`; A's tender then reaches the server and commits (R3 moved once, the server's grant
settled committed), and no later sweep of B names the grant. Its other ending: a page closed between its prepare and the server, the
reopened page's sweep `left-issued`, then - with the clock past the grant's 10-minute life, the server's lazy expiry retiring it -
`abandoned-not-committed`, which the restored entry takes. Red first on the round-2 code: `d2b3-red-crash-unit`, 2 of 4 failed,
exit 1 (case 3 at `:204` and case 4 at `:255`, "expected 'not_made' to be 'outcome_unknown'"; everything before held: the prepared
attempt, the issued grant, B's `left-issued`). The fix (`chat-run-view.ts:686-689`, `:697-698`, `:728`, in place; no line moved): such
an entry is `outcome_unknown`, reading "Not started — when the editor loaded this project, the server still held this change's grant
unused, so nothing had been changed by it. A reload keeps no confirmation card and no execution, so it cannot be started from this
page. Unless another open tab of this project still starts it, the grant expires unused and the change is closed as not made the next
time the editor loads this project after that.", next step "Check your other open tabs of this project; ask again if you still want
the change." Green: `d2b3-green-crash-unit`, 4 of 4, exit 0. "Cannot be started from this page" is **INFERRED** from the code (the
card is the page's in-memory state, and a resumed run replays its first answer as text only, `replayFirstTurn` in
`app/api/chat/orchestration-runtime.ts`); "closed as not made" is shown by case 4 and, for a grant the server retired otherwise, in
the browser below ([B24-D2B review 3] superseded: that sentence predicted one end of an issued grant and is replaced, and the browser
record below does not show which record was closed - see the third review round). A live entry's `left-issued` (the page that holds
the card) keeps B18's "Waiting — ... confirm or cancel it."

*The crash spec, as it stood after this round, in the browser* ([B24-D2B review 3] its assertions are unchanged since: this round's
file differs in two comment lines only, section 19's third review round). (a)'s requirement moved with the fix: if the reopened page shows the entry, it turns
`outcome_unknown`, reads "Not started — ..." and never "awaiting the editor's result", "Not made" or "Nothing was changed"
(`crash-recovery.spec.ts:169-174`, inside the existing `if (await entry.count())`: an entry the page lost is not judged by (a), as
the header now says). Each older code state was put over the working files for one run - built in the scratchpad, every file checked
by sha256: the round-2 `chat-run-view.ts` (`45dee83c...`, by reversing this round's three edits), and the round-2 start's four files
(`chat-run-view.ts`, `execution-display.ts` and `page.tsx` as at `HEAD`; `granted-executions.ts` rebuilt to its recorded
`3d82839b...`) - each working file's sha256 recorded before and after, and restored byte-identical after the run:
- `d2b3-crash-4-pre2code` (the code before the review round): (a) failed at `:172` after its 30 s poll, "Expected: outcome_unknown,
  Received: executing", the entry "Executing in the PCB editor — ... — awaiting the editor's result (interrupted by reload)"
  (`error-context.md`); (b) did not run (the file is serial); exit 1, 73 s.
- `d2b3-crash-5-pre2code-b` (the same code, (b) alone, `--grep "after the server"`): failed at `:211`, received "AI execution
  recovery: xg-6ae818493… left-in-flight."; the entry still "Executing ... (interrupted by reload)"; 1 failed, exit 1, 33 s.
- `d2b3-crash-3-round2code` (the round-2 code): (a) failed at `:172`, "Received: not_made", the entry "Not made — the page closed
  before the server started this change, ... Nothing was changed."; (b) did not run; exit 1, 71 s.
- Green alone on the final bytes: `d2b3-crash-2`, 2 passed (56.9 s: (a) 11.9 s, (b) 12.9 s), exit 0. (`d2b3-crash-1` ran no test:
  the browser did not launch when the lock script was started through the Store Python launcher - "Executable doesn't exist" for a
  file that exists; **INFERRED**: that launcher's `AppData\Local` virtualization. Rerun directly, as every other run.) Its
  `crash-outcome.json`: (a) R3 not moved, the grant `issued`, no consumption, the entry `outcome_unknown`; (b) R3 not moved
  (50,000,000 nm), the grant `consumed`, the notice "AI execution recovery: xg-f06b570b4… abandoned-not-committed; xg-6b868acec…
  interrupted (not running in this page; no change from it is recorded on this board).", after it was gone the entry
  `outcome_unknown` reading "Interrupted — the server started this change, ..."; and a record, never an assertion (`:222`, the helper
  appended at `:225-234`): in the page reopened for (b), (a)'s entry `not_made`, "Recovered: an AI change that never landed was
  closed. Nothing was changed.", its grant `retired` on the server. [B24-D2B review 3] As first written here: "a not-started entry
  closed by a later sweep, seen in the browser" - more than the record shows: it does not show whether the record restored there was
  the not-started one or (a)'s pre-crash `executing` one, which the sweep's result closes alike; and the grant was retired by (b)'s
  newer grant (minting retires every earlier issued grant of the same principal and editor, `app/lib/execution-grant/store.ts:109-127`;
  INFERRED from the code: the run read the state, not the reason), never by its expiry.
- The default configuration on these bytes: `d2b3-default-final`, 60 passed (9.5 m), exit 0, (a) 8.1 s and (b) 12.9 s; the
  orchestration configuration (`d2b3-orch-final`, 4 passed, 2.6 m, exit 0), run because the chat page it shares changed, does not
  run this spec. The 32 evidence PNGs the two configurations rewrote were restored from `HEAD` and checked with `git hash-object`:
  0 mismatched.

*The claims (R2-P1 to P3, P5 to P8).* Now stated as run: `d2b-multitab-6` ran an earlier case 1, so the round-2 file ran alone once
(`-7`); the two specs run in the default configuration only (the orchestration configuration's `testDir` is `./e2e-orchestration`);
a fully stale tab's Sync creates no publication and moves no board record or head (CONFIRMED), while the stored replayed revision is
INFERRED and replaces state the tabs share (section 18); the entry's survival of a further reload is shown through the unit test's
replica, INFERRED for the page; `d2b-crash-3` showed (b) red only, on code with a stub that was not kept; the crash header says what
(a) found and that (a) judges a shown entry only; and `d2b2-tsc-1`'s log is empty (tsc prints nothing when clean), so its exit 0 was
reported, never recorded (this round's tsc ran with `--extendedDiagnostics`: its log is not empty and its exit is recorded,
`d2b3-tsc-1`). The multi-tab spec's replay pin (`:166`) says at that line that it records today's behaviour under the open owner
question and moves by review (section 18).

**Recorded limits after the second review, not claims.** A restored entry cannot tell whether another open tab holds a still-issued
grant's card, or is making an interrupted change (no cross-tab channel; the claim registry is per page): both sentences name the
other tab. The cross-tab case is shown at the unit level only; no browser spec opens two tabs on one grant. A restored not-started
entry is closed only by a sweep after its grant leaves `issued` (expiry: 10 minutes for a preview grant, 60 s for an explicit one,
`execution-grant.ts:79-80`), at the editor's next load. [B24-D2B review 3] Superseded in part: an issued grant also leaves `issued`
when a newer grant is minted for the same principal and editor, when it is cancelled, or when another tab commits it, and a grant
another tab finished was never named again by any sweep - every editor load now re-derives the entry (the third review round, below).

**The third review round ([B24-D2B review 3, 2026-10-10]): a restored entry kept a sentence an earlier load wrote - CONFIRMED at
the unit level, fixed test-first; a load's sentences say only what held at that load.** The review found one product problem
(R3-P1) and four texts to make exact (R3-P2 to P5). Every run below ran the bytes it is cited for (`scratchpad/b24/d2b4/`: the start
snapshot, the sha256 of each run's files in `logs/d2b4-console-records.txt`).

*The product (R3-P1).* Each tab's autosave writes the whole project record, its chat included (`persistProject`, `page.tsx:2970-3007`):
the last writer wins, and `fromStoredChat` (`page.tsx:2959-2967`) changes only rows still `running`. The sweep's work list is the
journal's unfinished entries only (`pending()`, `app/lib/engineering/agent-execution-journal.ts:345-350`). So in case 4's scenario -
tab B's sweep reads `left-issued`, then tab A commits - A's journal entry is `settled`, no sweep names the grant again, and every
later load of B restored B's "Not started — ..." and its "ask again if you still want the change" for a change that had landed. The
round-2 check after A's commit was vacuous (it re-read the entry computed before the commit). **CONFIRMED** at the unit level:
`b24-d2-crash-recovery` 4 now reloads B after A's commit (the record as B saved it, through `storedAndRestored`, the replica of the
page's store-and-restore; a fresh editor, `reloadEditor`) and requires the entry `committed`; its other ending reloads the still-open
record after the expiry closed the grant and requires `not_made`. Case 5 (new) drives the other records: a commit the journal could
not verify (`poisoned`), no record any more, an unreadable journal, and which entries the page asks about.
- Red first on the round's start code (every product file byte-identical to the start snapshot by sha256; only the suite changed):
  `d2b4-red-crash-unit`, 2 of 5 failed, exit 1 - case 4 at `:280`, "B reloads after A's commit: the change that landed reads
  committed: expected 'outcome_unknown' to be 'committed'"; case 5 at `:336`, "the poisoned entry is finished: only the journal's
  record names it: expected [] to deeply equal [ ObjectContaining{…} ]"; cases 1-3 passed.
- The fix - every editor load re-derives each restored, unsettled entry from durable truth; no new route, schema or server call (the
  journal is the browser profile's own, read in the browser):
  - the page names the grants of its restored execution entries that are not settled and that it holds no live entry for, each once
    (`restoredEntryGrants`, appended at `chat-run-view.ts:756`; passed as `restoredExecutionGrants` at `page.tsx:6460` and imported
    at `:62`, in place, no page.tsx line moved), and the editor hands them to its sweep (`PcbEditor.tsx:322`, `:371`, `:1688`,
    `:1695`, in place);
  - the sweep answers each asked grant its work list did not hold with the journal's record of it (`recordedEnds`, appended at
    `granted-executions.ts:695`; in place `:576`, `:578`, `:593`, `:660`), read-only - `lookupByGrant`, no claim, no journal write,
    no server call: `settled` is `recorded-committed`, `abandoned` `recorded-not-committed`, `poisoned` `recorded-unverified`, no
    entry `unrecorded`, an unreadable journal `unavailable` (a sweep that cannot read the journal at all answers `unavailable` for
    every asked grant). A grant its work list holds is answered as before, from the journal and the server;
  - the entry takes the result through the page's existing rule (`recoveryDisplayAction`, `restoredEntryRecovery`; in place
    `chat-run-view.ts:685`, `:710`, `:718`, `:734`; `recordedEnd` and `writtenAtALoad` appended): a recorded commit is written as the
    adopted path writes it - "AI change committed by your editor (one canonical transaction)", the recovery row "Recorded: this
    browser's execution journal for this project records this change as committed and reported to the server." and the undo hint a
    reloaded record keeps; a recorded close is not made, "Not made — this browser's execution journal for this project records this
    change as closed without a commit. Nothing was changed by it.", next step "Ask again."; a recorded unverifiable commit is landed
    unverified ("The change LANDED but could not be verified — the board MAY have changed.", next step "Check the board and the
    revision history.", recovery row "Recorded: ... records this change's commit as one that could not be verified."); and where no
    record names the grant any more, only a sentence a load wrote from the records (not started, interrupted, unreadable, or this
    one) is withdrawn - "Outcome not known — when the editor loaded this project, no record this page can read named this change any
    more, so this entry cannot say whether it was made." - while B18's own pre-crash records ("(interrupted by reload)") are kept. A
    settled entry is never asked about (INFERRED that what it says stays true: its grant was settled, retired or refused in the one
    page that held its card). No re-derivation is a recovery event: no toast.
- Green: `d2b4-green-crash-unit`, 5 of 5, exit 0.

*A load's sentences (R3-P2).* The not-started sentence predicted one end ("the grant expires unused and the change is closed as not
made the next time the editor loads this project after that"). An issued grant also ends when a newer grant is minted for the same
principal and editor (minting retires every earlier issued one, `superseded_by_new_grant`, `app/lib/execution-grant/store.ts:109-127`),
when it is cancelled, and when another tab commits it. The interrupted sentence predicted "it is closed as not made once its commit
window has passed", which does not hold where the canonical lineage the grant was prepared under has been reopened: the sweep then
leaves it pending as `unavailable` (`granted-executions.ts:644-646`; INFERRED from the code, no run). Both now say only what held at
that load, nothing predictive, and every editor load re-derives them:
- "Not started — when the editor loaded this project, the server still held this change's grant unused, so nothing had been changed
  by it. This page cannot start it: a reload keeps no confirmation card. Another open tab of this project may still start it."
  (`chat-run-view.ts:689`, in place; its next step unchanged);
- "Interrupted — when the editor loaded this project, the server had started this change, but no execution of it was running in this
  page and no change from it was recorded on this board. Another open tab of this project may still be making it."
  (`execution-display.ts:235`, in place; a live entry takes it too).
Red first on the round's fixed code with the sentences as they were: `d2b4-red2-crash-unit`, 4 of 5 failed, exit 1 (the pinned
sentences at `:157`, `:205` and `:256`; and `:394`, "a load's sentence predicts no later close: expected 'Not started — when the
editor loaded …' not to match /expire|closed as not made|commit win…/i"). Green: `d2b4-green2-crash-unit`, 5 of 5, exit 0.

*(a)'s record at (b)'s reopen (R3-P2).* What `d2b3-crash-2` and `d2b4-crash-1` recorded is (a)'s entry `not_made` and its grant
`retired` at (b)'s reopen - by (b)'s newer grant (INFERRED from `store.ts:109-127`: the run read the state, not the reason). It does
not show whether the record restored there was the not-started one (a)'s page had saved or its pre-crash `executing` one: the sweep's
result closes both alike. The texts that said "a not-started entry closed by a later sweep" are corrected where they stand.

*Which code each red browser run used (R3-P3).* The spec's assertions are the round-3 file's (`cffbd9cf...`); this round changed two
comment lines (the header's sections and the record helper's comment: reversing exactly those two edits gives `cffbd9cf...` again,
by sha256), so the file is now `bb1f8916...`. Under those assertions: `d2b3-crash-4-pre2code` ran the code before the review round
(the first fix, the notice, in place; a reloaded entry never updated): (a) red at `:172`, (b) did not run (the file is serial);
`d2b3-crash-5-pre2code-b` ran the same code with (b) alone: red at `:211`, so its durable-entry assertions (`:212-218`) were never
reached; `d2b3-crash-3-round2code` ran the round-2 code: (a) red at `:172`, (b) did not run. No run put B24-D2's code before the first
fix under these assertions (its browser reds, the lead's run and `d2b-crash-1`, (b) at `:196`, ran B24-D2's own spec), (b)'s
durable-entry assertions have never been red in a browser, and no browser run reloads a tab after another tab's commit.

*Every run of the crash spec (R3-P4)*, each log in `scratchpad/b24/logs/`:

| run | spec | product code | result |
|---|---|---|---|
| the lead's default run, 2026-10-10 (`d2-browser-default`) | B24-D2's | B24-D2's | (a) passed (7.7 s); (b) failed at `:196` (38.3 s); the configuration 56 passed, 2 failed, 2 did not run |
| `d2b-crash-1` | B24-D2's | B24-D2's | (a) passed (13.7 s); (b) failed at `:196` (37.2 s); exit 1 |
| `d2b-crash-2` | B24-D2's | B24-D2B's first fix (the notice) | 2 passed (35.9 s); exit 0 |
| `d2b-default-final` | B24-D2's | the first fix | the configuration 60 passed; (a) 6.8 s, (b) 7.1 s; exit 0 |
| `d2b-crash-3` | the review round's (b), without (a)'s requirement | a first stub of the review round's fix, not kept | (a) passed (12.6 s); (b) failed at `:204` of that spec; exit 1 |
| `d2b-crash-4` | the review round's, without (a)'s requirement | the review round's, before its never-started case | 2 passed (39.8 s); exit 0 |
| `d2b-crash-5` | the review round's | the review round's | 2 passed (40.1 s); exit 0 |
| `d2b2-default-final` | the review round's | the review round's | (a) passed (8.5 s), (b) passed (13.0 s); the configuration 57 passed, 1 failed (a multi-tab worker crash, section 18), 2 did not run; exit 1 |
| `d2b2-default-final-2` | the review round's | the review round's | the configuration 60 passed; (a) 8.1 s, (b) 12.4 s; exit 0 |
| `d2b3-crash-1` | round 3's (`cffbd9cf...`) | round 3's | no test ran (the browser did not launch); exit 1 |
| `d2b3-crash-2` | round 3's | round 3's | 2 passed (56.9 s); exit 0 |
| `d2b3-crash-3-round2code` | round 3's | the review round's `chat-run-view.ts` | (a) failed at `:172`; (b) did not run; exit 1 |
| `d2b3-crash-4-pre2code` | round 3's | the code before the review round | (a) failed at `:172`; (b) did not run; exit 1 |
| `d2b3-crash-5-pre2code-b` | round 3's, (b) alone | the code before the review round | (b) failed at `:211`; exit 1 |
| `d2b3-default-final` | round 3's | round 3's | the configuration 60 passed; (a) 8.1 s, (b) 12.9 s; exit 0 |
| `d2b4-crash-1` | the third review round's (`bb1f8916...`) | the third review round's | 2 passed (59.4 s: (a) 14.6 s, (b) 13.0 s); exit 0 |
| `d2b4-default-final` | the third review round's | the third review round's | the configuration 60 passed (10.4 m); (a) 7.8 s, (b) 12.9 s; exit 0 |
| `d2b5-crash-1` | the fourth review round's (`3d11502b...`: one header comment changed, no assertion) | the fourth review round's | 2 passed (1.0 m: (a) 14.1 s, (b) 13.6 s); exit 0 |
| `d2b5-default-final` | the fourth review round's | the fourth review round's | the configuration 60 passed (10.4 m); (a) 8.4 s, (b) 12.8 s; exit 0 |

*The browser, this round.* `d2b4-crash-1`'s `crash-outcome.json`: (a) R3 not moved, the grant `issued`, no consumption, the entry
`outcome_unknown` (its "Not started — " asserted at `:173`; the record keeps the state); (b) R3 not moved (50,000,000 nm), the grant
`consumed`, the notice "AI execution recovery: xg-b7b792ef2… abandoned-not-committed; xg-611d5dbe5… interrupted (not running in this
page; no change from it is recorded on this board).", and after it was gone the entry `outcome_unknown` reading "Interrupted — when
the editor loaded this project, the server had started this change, ..."; the record of (a) at (b)'s reopen: `not_made`, its grant
`retired`. In both reopens every restored entry's grant was still in the journal's work list, so `recordedEnds` answered nothing
there: the re-derivation from a finished journal entry is shown at the unit level only (the B18-C harness, the page's
store-and-restore through `storedAndRestored` and its rule through `atPageLoad`, both replicas) and is INFERRED for the page; that the
page hands the sweep its restored entries' grants rests on `tsc` and on reading `page.tsx:6460` and `PcbEditor.tsx:1688`.
`d2b4-default-final`, the default configuration once on the same bytes: 60 passed (10.4 m), exit 0; crash (a) 7.8 s and (b) 12.9 s,
its `crash-outcome.json` as `d2b4-crash-1`'s (the entry `outcome_unknown` with the interrupted sentence above; (a) at (b)'s reopen
`not_made`, its grant `retired`); multi-tab 1.6 m, 25.9 s and 1 ms. Case 1 was slower than round 3's 42.2 s, with six browser warnings
"Maximum update depth exceeded" from the view-session bus (`ViewSessionOwner.notify`, `app/components/view-session/useViewSession.ts:89`,
through `ViewSessionBus.execute`, `app/lib/view-session/bus.ts:217`) after the reloaded tab's refused publication (409). The same six
warnings with the same stack, and a 1.4 m case 1, are in `d2b-multitab-6`, which ran the review round's code before any of this
round's changes, and in no other recorded run: they arise without this round's code; their cause is UNKNOWN; recorded, not changed.
`d2b4-orch-final`, the orchestration configuration once (run because the page and the editor it shares changed; it runs neither new
spec): 4 passed (2.7 m), exit 0. The two runs rewrote 31 evidence PNGs (24 the default run, 7 the orchestration run), restored by the
lead's close procedure and checked with `git hash-object`: 0 mismatched; all 32 evidence PNGs equal `HEAD`.

*The PNG restore (R3-P5).* The default configuration rewrites 32 evidence PNGs. B24-D2B's browser close and its review round restored
them from `HEAD`'s blobs (`git cat-file blob`); the second review round (`d2b3-*`) used `git checkout HEAD -- <png>`, the lead's close
procedure (`scratchpad/b24/lead-close.sh`), and section 27 said it did so "as the lead's task names it" - which task-D2B.md does not:
its rules forbid a checkout and name no exception. For this round the lead sanctioned that restore in its instruction, as its close
procedure, each PNG verified by `git hash-object` against `HEAD`; this round's restore is that procedure. Every round: 0 mismatched.

**Recorded limits after the third review, not claims.** The re-derivation from a finished journal entry has run at the unit level
only; no browser spec opens two tabs on one grant. An entry is re-derived when the PCB editor's sweep runs (once per editor
lifecycle, `PcbEditor.tsx:1684-1686`): a page that never opens the PCB editor shows the chat as last saved (INFERRED from the code).
The journal is the profile's and bounded (32 entries per project branch, finished ones dropped first,
`agent-execution-journal.ts:98`, `:371-375`): an entry whose record aged out, or one restored in another profile or branch, has no
record, and a sentence a load wrote is then withdrawn as of unknown outcome, never kept. If the sweep itself throws (the journal
and the transport return their failures instead), no entry is re-derived at that load (INFERRED). The settlement of a consumed grant
still waits for a sweep after its commit window (once per lifecycle; section 26).

**The fourth review round ([B24-D2B review 4, 2026-10-10]): what a load writes could still be false on four paths - each CONFIRMED
at the unit level and fixed test-first; the texts made exact.** The review found two medium problems (N1, N2), two low ones in the
product (N3, N6), texts broader than the code (N4, R3-P3-REST) and a page left unscanned after its last edit (N5). The round
started on round 3's end snapshot
(`scratchpad/b24/d2b4/end-hashes.txt`: `sha256sum -c` passed and `git status` matched before any edit); the sha256 of every file a run
read is in `logs/d2b5-console-records.txt`.

*A restored entry's next step (N1).* A restored entry whose grant the sweep poisons was written with the live entry's next step,
"Check the board and the revision history; the editor's Undo restores the previous board." (`restoredEntryRecovery`, then
`chat-run-view.ts:733`), and case 3 pinned it (the restored tail equal to the live one); a landed-unverified record restored from
storage kept the same step (`restoredEntryLog` rewrote committed records only). After a reload the editor's one-step Undo no longer
applies (`RESTORED_UNDO_HINTS`). Case 3 moved by review: the restored entry's next step is "Next: Check the board and the revision
history." - the step the recorded-unverifiable path already writes (`CHECK_RECORDS_NEXT`) - while its live twin keeps the Undo its
live editor offers, and no restored entry names the editor's Undo. Case 6 (new) restores the two live landed-unverified records (the
ritual's refusal with `changed`, the sweep's poison) through `storedAndRestored`, the replica of the page's store-and-restore, and
requires the restored step, every other row kept, every other record returned as stored. Red first on the round's start code: case 3
at `:191`, case 6 at `:443` (`d2b5-red-crash-unit`). The fix: `chat-run-view.ts:733` in place; `:520` in place (`restoredEntryLog`
hands a landed-unverified record to `restoredLandedNext`, appended at `:803`). That the page's own restore (`page.tsx:2965`, which
calls `restoredEntryLog`) takes it rests on reading that line: INFERRED for the page.

*The sweep's writes on an entry another tab moved (N2).* The sweep acts on one reading of the journal (`pending()`); the journal is the
browser profile's, shared by its tabs, and the claim registry the page's. Three races, each driven deterministically at the unit
level (two editors over one durable store, one shared journal, a tab held at a chosen point through a wrapped view of that journal,
`withJournal`), each **CONFIRMED** on the round's start code:
- tab B read the entry `prepared` and found no commit; tab A then tendered, committed and settled; B's server read said `settled`,
  B's close (`abandon`) was refused and the refusal ignored, and B reported `abandoned-not-committed` - its reloaded entry `not_made`,
  "Recovered: an AI change that never landed was closed. Nothing was changed.", and a toast saying the same, for a change that landed;
- the same from a `grant-consumed` reading (B also sent a `not-committed` settlement first, which the server refused because A had
  settled);
- B read `prepared`; A's change then landed and A was held before recording it; B found the commit for a `prepared` entry, poisoned A's
  entry (from `grant-consumed`, a transition the journal allows) and settled the grant `poisoned` on the server.
Case 7 (both readings) red at `:475` and `:480-483` - `abandoned-not-committed`, the entry `not_made`, a toast
(`d2b5-red-crash-unit-2`); case 8 red at `:507-511` - `refused-poisoned`, A's journal entry `poisoned`, the server's grant `settled`,
B's entry `landed_unverified` (`d2b5-red-crash-unit-3`; soft assertions let one run show each). The fix, in place in the sweep with
helpers appended beside it (no journal, route or schema change): before each write the sweep reads the entry again and writes only
while it holds the state the sweep read (`stillAsRead`, `granted-executions.ts:725`; `sweepWrite`, `:734`; used at `:603`, `:608`,
`:613`, `:617`, `:620`, `:623`, `:626`, `:635`, `:651-652`, and a server settlement goes out only after that read); a write it does not
make, or one the journal refuses, is answered with what holds (`heldNow`, `:749`): an end the journal records as `recordedEnds`
reports it (settled: `recorded-committed`, written as the adopted path writes it; closed; unverifiable; gone), an entry that did not
move left pending (`unavailable`), an entry another page moved and has not finished `in-flight-elsewhere`, unless the server already
holds its committed report. Never a terminal "not made" the records contradict. The new result's restored entry (`outcome_unknown`):
"In progress in another tab — when the editor loaded this project, another open tab of this project was carrying this change forward
(its execution record moved while this page read it), so this page left it to that tab.", next step "Check your other open tabs of
this project, or the board and the revision history." (`execution-display.ts:238`, `chat-run-view.ts:735`, `:795`); no toast (the page
changed nothing). Green (`d2b5-green-crash-unit`): case 7 reports `recorded-committed` and B's reloaded entry reads committed, the
server and the journal keeping A's commit; case 8 writes and settles nothing, A's commit completes, and B's next load reads it
committed.

*The project a sweep answers for (N3).* The page switches projects by remounting the editor (`page.tsx:6433` keys it by the project
id), but a sweep in flight ran on, and the page's callbacks read the chat the page shows then: a stale sweep asked the old project's
journal about the new project's restored entries. Case 9 (new): a sweep whose page switches project while it waits on the server, or
while it reads a restored grant's record, or as it fails to read the journal at all, returns nothing and asks nothing; the project's
own records stay as they were; a page that stays, or a caller that names no page project, is answered as before. Red first at `:550`:
the old sweep returned the old project's results (`d2b5-red-crash-unit`). The fix: the sweep reads the page's project when it starts
and drops its results once the page shows another (`pageProject`, `granted-executions.ts:576`; `projectKeptBy`, `:773`, used at
`:590`, `:593`, `:660`); PcbEditor passes the page's (`PcbEditor.tsx:322`, `:371`, `:1688`, `:1695`, in place) and the page names its
own (`page.tsx:6460`, `pageProject={() => projectRef.current?.id ?? null}`, in place; the page sets that ref in the same tick as the
new project, `page.tsx:3221-3222`). That the page then wrote the stale answers into the new project's chat is INFERRED from
`page.tsx:6460`; the sweep's part is CONFIRMED. The browser runs below show the guard passes a page that stays (the reloaded entries
took the sweep's results).

*The cause of a lasting unknown (N6).* An entry the sweep cannot settle because the canonical lineage was reopened after its grant
(`granted-executions.ts:644-646`) read "Recovery could not read the records right now; it retries on the next load.": the sweep did
read them, the condition lasts, and every later load wrote the same. The sweep now marks that result `cause: "lineage-reopened"`
(`:645`, in place; B18-E's `unavailable` action and detail kept, so `b18-e-lost-settlement` is unchanged), the page shows it as
`lineage-reopened` (`recoveryDisplayAction`, `chat-run-view.ts:676-678`, in place) and the entry reads "Outcome not known — when the
editor loaded this project, the board's canonical history had been reopened since this change was started, so its records could
neither prove nor disprove that the change was made." (`execution-display.ts:238`); an unreadable journal keeps B18's retry sentence;
a later load that finds no record withdraws either new sentence as any a load wrote (`writtenAtALoad`, `chat-run-view.ts:788`). Case 10
(new) red first at `:590` on the start code, with a first setup through the agent loop as B18-E's (`d2b5-red-crash-unit`). That setup
needed a 60,000 ms budget, which the threshold census counts: the reader run on the fixed code failed one case, its byte pin
(`b24-d1-threshold-census` 5, `d2b5-gate-readers`: 1 failed, 205 passed, 3 skipped), and the census generated into a scratch folder
held exactly one row more, that budget (`d2b5-gen-census-probe`, 303 rows). The setup was rewritten to reach the same state without
the loop (a held ritual, the lineage reopened by a legacy edit and a canonical commit, a reloaded editor), so no budget and no census
row is added; the rewritten case is red on a mutation that drops the cause (`d2b5-mutation-case10`, at `:593`; the source restored,
sha256 `5047c037...` matched) and green (`d2b5-green-crash-unit-2`, 10 of 10, the file's cases 1.3 s).

*The texts (N4, R3-P3-REST, N5).* "Every load re-derives" claimed more than the code does: the re-derivation runs when the PCB
editor's sweep runs (`PcbEditor.tsx:1684-1695`), so a page that never opens the editor shows the chat as last saved. It now reads
"every editor load" on this page (sections 19, 26, 27's discovery line and README row) and in the code comments (`chat-run-view.ts:689`,
`:749`, `:753`, `execution-display.ts:235`, `PcbEditor.tsx:1688`, `page.tsx:6460`). The D24-30 clause said a reloaded entry never reads
"awaiting the editor's result"; case 5 pins that a restored B18 pre-crash entry no record names keeps "Executing … awaiting the
editor's result (interrupted by reload)" - reachable when the page closes after the entry turns executing and before the journal's
prepare (`PcbEditor.tsx:1601`, `granted-executions.ts:381`), or for an imported or aged-out record; the clause now says exactly that.
Section 27's browser-run record said the second review ran the spec "on the code before each fix"; it now names the two older code
states (R3-P3-REST). The crash spec's header named section 26 among the sections citing its runs; section 26 cites none
(`e2e/crash-recovery.spec.ts:3`, a comment, in place). Round 3's report counted 18 runs in this section's table; it held 17 (19 with
this round's two). N5: the three closeout scanners (`b21-`, `b22-`, `b23-closeout-statements`, each over every `artifacts/*.md`) ran
on this page's final bytes after its last edit; that run is recorded in this round's report to the lead, never here, since a record
here would change the bytes it scanned.

*The browser, the fourth review round.* `d2b5-crash-1`, the crash spec alone on the final bytes: 2 passed (1.0 m; (a) 14.1 s, (b)
13.6 s), exit 0. Its `crash-outcome.json` is round 3's in every field but the grant ids: (a) R3 not moved, the grant `issued`, no
consumption, the entry `outcome_unknown`; (b) R3 not moved (50,000,000 nm), the grant `consumed`, the notice "AI execution recovery:
xg-da312c3d1… abandoned-not-committed; xg-561df0a77… interrupted (not running in this page; no change from it is recorded on this
board).", the entry `outcome_unknown` reading "Interrupted — when the editor loaded this project, ..."; (a)'s record at (b)'s reopen
`not_made`, its grant `retired`. The reloaded entries took the sweep's results with the project guard in place: CONFIRMED that the
guard passes a page that stays on its project; a project switched during a sweep has run at the unit level only. `d2b5-default-final`,
the default configuration once on the same bytes: 60 passed (10.4 m), exit 0; crash (a) 8.4 s and (b) 12.8 s, its
`crash-outcome.json` as `d2b5-crash-1`'s; multi-tab 1.4 m, 25.2 s and 25 ms, with the six warnings of section 18. The run rewrote 25
evidence PNGs, restored by the lead's sanctioned close procedure (`git checkout HEAD -- <png>`) and checked with `git hash-object`:
all 32 equal `HEAD`, 0 mismatched. The orchestration configuration was not run this round (it runs neither spec; the lead's
instruction named the default configuration).

**Recorded limits after the fourth review, not claims.** The sweep's re-read and its write are two steps, and the journal allows some
transitions from a moved state, so a window stays (INFERRED from the code; no run exercised it): a sweep that read `grant-consumed`
and finds the commit adopts it while the committing tab has not yet recorded it (both write the same records; the committing tab's
receipt can then be refused and it reports "recovery required" for a change that landed); and past the commit window a sweep settles
`not-committed` on the server before its close, so a tab committing after its own deadline in that window would be reported not
committed by the server. A cross-tab lock is not built. A write refused on an entry that did not move (the store failed) is reported
with B18's transient sentence, which names a read. The project guard is display-only: a sweep whose page left its project still
finishes that project's journal and server work, and that project's next editor load re-derives its entries. Every cross-tab path is
shown at the unit level only; no browser spec opens two tabs on one grant.

**BLOCKED.** None live. A server crash with a real store is LB-14's.

## 20. Restart (D24-30)

**What is proven.** `b24-d2-restart-pglite` (one case in four parts; PGlite in process, migrated, nothing on disk; the B23-B2
precedent): "process 1" publishes twice through the durable workflow repository's process singleton and `DurablePcbSyncRepository`;
the restart is `vi.resetModules()` (the singleton dropped, the database kept); "process 2" (1) reloads the head with the same
revision and digest and re-verifies both, (2) refuses a publish on the pre-restart revision (`PS_DURABLE_PUBLICATION_REVISION_CONFLICT`)
with the head unchanged, (3) replays a retried idempotency key without a second record, and (4) a commit that throws partway leaves
no head, no record and no replay row. A characterization: green on its first run (`d2-restart-pglite-1`, 1 of 1, 2.4 s), recorded
"not reproduced"; the guard stays. It runs in database-delivery by an explicit entry (`deterministic-manufacturing.yml:384`).

**The numbers.** NOT MEASURED (no timing is gated; 2.4 s is one local run's).

**BLOCKED.** A real server restart, failover and point-in-time recovery (LB-14). The fixture e2e server keeps its stores in memory,
so there is no server-restart browser case.

## 21. Process cleanup (D24-31's remainder, OD-145)

**What is proven.**
- `app/lib/pcb/process-tree.ts` (`killProcessTree`, `:51`): on win32, `taskkill.exe` under the checked Windows directory with the
  fixed argv `/PID <pid> /T /F`, only `SystemRoot` in its environment, `windowsHide` and no shell, then the direct child once taskkill
  ends (or at once when it cannot start); on POSIX, SIGKILL to the process group the detached child leads, the direct child only when
  the group is gone; a child with no pid gets the direct kill only. A Windows directory that is not absolute under B22-A3's rule
  (unset, relative, or holding `%`, `;` or a double quote) leaves the direct kill only and starts nothing. Each runner passes its own
  `spawn`, so the module names no process module and no new spawner exists.
- kicad-cli on timeout (`kicad-cli-runner.ts:83-119`) and FreeRouting on timeout and on abort (`autoroute/runner.ts:148-196`): the
  tree kill, the child spawned detached except on win32, and the run settled only after `close` (`killConfirmed: true`) or after
  exactly `TREE_KILL_CONFIRM_MS` = 5,000 ms (`killConfirmed: false`); FreeRouting's temporary files are removed only after the run
  settles.
- The two legacy profiles go to revision 2 (`runtime-profile.ts:440`, `:501`): the kill text names the tree kill and the confirm
  wait, and the deviations drop `direct-child-kill` and `terminal-before-exit` (`b22-a2-runtime-profile` 13, moved in place).
- One real process tree, with no Java and no kicad-cli (case 7): `runKicadCli` with the node binary as `cliPath`, its script starting a
  grandchild and writing both pids; the positive control, both alive before the timeout (else NOT MEASURED); after the result, both
  gone within the confirm wait (signal 0); `afterAll` kills any survivor. [B24-D2 review, 2026-10-09] A pid confirmed gone is struck
  off at once (red first: `afterAll` still held both and would have signalled them; a freed pid may be another process's by then),
  and `afterAll` signals only a pid still alive. The scratch removal spells its primitive, admitted by `b11-5-capture-exactness`
  case 12's justified entry while every write line is rooted at the case's temporary root (red first without the entry, and red
  again with a line not rooted, `d2fix-mutation-b11-5`; restored, sha256 checked); the child script's write stays assembled at run
  time.
- [B24-D2 review, 2026-10-09] An unconfirmed kill is reported past the runner (case 8, red first: every consumer dropped it): the
  route's pass executor and the production router carry `killConfirmed` into each attempt's evidence
  (`freerouting-pass-executor.ts:186`, `production-router.ts:62`; the evidence type, `completion.ts:60`), and kicad-cli's
  `KicadCliError` carries it (`fab/types.ts:88`, `build-bundle.ts:45`) into the gerbers route's 500 answer (`route.ts:280`; pinned
  in `app/api/pcb/export/gerbers/__tests__/route.test.ts`). A run that was not killed carries no field. Each edit is in place.

**The numbers.** MEASURED on win32 only, locally, 2026-10-09, on the working tree (`d2-process-gates-3`): case 7's child and
grandchild gone after the `taskkill /T` kill, `killConfirmed` true; the suite's seven cases in 8.6 s (after the review: eight cases
in 9.8 s, case 7 in 8.2 s, 2026-10-10, `d2fix-green-1`). The POSIX branch (the group
kill) runs in CI on ubuntu in prompt-to-gerber: NOT MEASURED here.

**A finding (CONFIRMED on win32).** At `3d5f225` a node grandchild started without `detached` died with its parent under the direct
kill: libuv runs a node child in a job object that ends its children when it closes, so the orphan could not appear
(`d2-red-process-cleanup-2`). Case 7 starts its grandchild detached on win32 only, which is the orphan the direct kill leaves
(`d2-red-process-cleanup-3`: "alive: child false, grandchild true"). This answers discovery 9.5 item 33 for a node process tree only;
the reach of `/T` into ngspice's own descendants stays INFERRED (B22's record).

**Stated limits.**
- kicad-cli takes no abort signal (`RunKicadCliInput`): a cancelled request does not stop it; only its timeout does.
- On POSIX each child now leads its own process group, so a server stopped by a terminal's Ctrl-C (SIGINT to the foreground group) no
  longer takes a running FreeRouting or kicad-cli child with it: the child runs on until it exits by itself (**INFERRED**; no POSIX run
  here).

**BLOCKED.** The live FreeRouting (Java) orphan run (LB-3: the bundled runtime is local-only) and the live kicad-cli orphan run
(LB-17); OCI cleanup (LB-10).

## 22. Test-first record and gates

| suite | red on `3d5f225` (log) | green (log) |
|---|---|---|
| `b24-d2-board-read` (8) | 8 of 8 failed: case 1, board-inspect `output_too_large_for_model`, then `unknown_tool` for the paged calls; 2-8, the module absent (`d2-red-board-read-2`) | 8 of 8, 18.1 s (`d2-board-read-1`) |
| B11 (the read registered, `ALL_READS` unmoved) | 5 failed, 74 passed in 5 files: B11.1's R5 capsule replay, the trace-replay evaluation's committed pins, no-provider and permanent cases, `b21-f-evaluation` 15 (`d2-red-b11`) | the agent gate below |
| `b24-d2-memory` (4, flag set) | 4 of 4 failed: case 1, no memory metric catalogued; 2-4, `LATENCY_METRIC_UNKNOWN`; nothing written (`d2-red-memory-2`) | 4 of 4 (`d2-green-memory-flagged`) |
| `b24-d2-process-cleanup` (7) | the helper absent, 7 of 7 failed (`d2-red-process-cleanup`); the helper present with the runners of `3d5f225`, 4 failed and 3 passed: no taskkill or group kill, `killConfirmed` absent, `runner.ts` still kills the direct child (`d2-red-process-cleanup-2`); the orphan, "alive: child false, grandchild true" (`d2-red-process-cleanup-3`) | 7 of 7 (`d2-process-gates-3`) |
| `b24-d2-working-copy` (5) | 2 failed, 3 passed: B's save `true`, A's copy replaced (`d2-red-working-copy`) | 5 of 5 (`d2-working-copy-2`) |
| `b24-d2-restart-pglite` (1) | green on its first run: "not reproduced" (`d2-restart-pglite-1`) | the same |
| `e2e/multi-tab.spec.ts` (3), `e2e/crash-recovery.spec.ts` (2) | PROPOSED: not run here; [B24-D2B, 2026-10-10] the lead's run failed one case of each (multi-tab 1 at `:143`, crash (b) at `:196`), each reproduced alone (`d2b-multitab-1`, `d2b-crash-1`) | [B24-D2B] multi-tab 3 of 3 (`d2b-multitab-5`, after four spec fixes: `-2`, `-3`, `-4` each red on the next premise; section 18); crash 2 of 2 (`d2b-crash-2`, after the product fix; section 19); the default configuration green (`d2b-default-final` 60 passed; the orchestration configuration, `d2b-orch-final` 4 passed, runs neither spec); [B24-D2B review, 2026-10-10] multi-tab 3 of 3 with the fully stale tab restored (`d2b-multitab-7`; `-6` on an earlier case 1); crash 2 of 2 strengthened (`d2b-crash-3` red for (b) only, on code with a stub not kept; green `d2b-crash-4`, on a spec without (a)'s requirement, and `-5`); the default configuration 57 passed, 1 failed (a worker-process crash, cause UNKNOWN), 2 did not run (`d2b2-default-final`, exit 1), then 60 passed (`d2b2-default-final-2`, exit 0); orchestration 4 passed (`d2b2-orch-final`); [B24-D2B review 2, 2026-10-10] the crash spec's round-3 assertions red in the browser on two older code states ([B24-D2B review 3] as first written, "on the code before each fix": no run put the code before the first fix under them, and (b)'s durable-entry assertions were never reached) - the code before the review round (`d2b3-crash-4-pre2code`: (a) at `:172`, `executing`; `d2b3-crash-5-pre2code-b`: (b) alone at `:211`, the raw `left-in-flight`) and the round-2 code (`d2b3-crash-3-round2code`: (a) at `:172`, `not_made`) - green alone (`d2b3-crash-2`, 2 of 2); the default configuration `d2b3-default-final` (60 passed, exit 0); orchestration `d2b3-orch-final` (4 passed, exit 0); [B24-D2B review 3, 2026-10-10] the crash spec (two comment lines changed) green alone on the final bytes (`d2b4-crash-1`, 2 of 2) and in the default configuration (`d2b4-default-final`, 60 passed, exit 0); orchestration `d2b4-orch-final` (4 passed, exit 0); every run of the crash spec in section 19's last table; [B24-D2B review 4, 2026-10-10] the crash spec (one header comment changed) green alone on the final bytes (`d2b5-crash-1`, 2 of 2, exit 0) and in the default configuration (`d2b5-default-final`, 60 passed, exit 0) |
| [B24-D2B, 2026-10-10] `b24-d2-crash-recovery` (1; [B24-D2B review] 3; [B24-D2B review 2] 4; [B24-D2B review 3] 5) | 1 of 1 failed: the reopened page's notice null for a grant the server consumed (`d2b-red-crash-unit`); [B24-D2B review] 3 of 3 failed: the notice's raw `left-in-flight`, the interrupted grant not shown as interrupted, a restored entry never updated (`d2b2-red-crash-unit`); then 1 of 3: a never-started grant's restored entry kept `executing` (`d2b2-red-crash-unit-2`); [B24-D2B review 2] 2 of 4 failed: a still-issued grant's restored entry `not_made`, "expected 'not_made' to be 'outcome_unknown'" (case 3 at `:204`, case 4 at `:255`; `d2b3-red-crash-unit`); [B24-D2B review 3] 2 of 5 failed on the round's start code: B's entry reloaded after A's commit still `outcome_unknown`, "expected 'outcome_unknown' to be 'committed'" (case 4 at `:280`), and a poisoned grant's record never read, "expected [] to deeply equal [ ObjectContaining{…} ]" (case 5 at `:336`; `d2b4-red-crash-unit`); then, with a load's sentences pinned without a prediction, 4 of 5 failed on the fixed code (`:157`, `:205`, `:256`, `:394`; `d2b4-red2-crash-unit`); [B24-D2B review 4] 6 of 10 failed on the round's start code: a restored poisoned entry's next step names the editor's Undo (case 3 at `:191`), so does a restored landed-unverified record (case 6 at `:443`), a refused close reported not made (case 7 at `:475`, both readings), a stale snapshot poisons another tab's execution (case 8 at `:507`), a sweep answers for a project the page left (case 9 at `:550`), a reopened lineage has no cause (case 10 at `:590`) (`d2b5-red-crash-unit`; soft assertions, `-2`, `-3`); the rewritten case 10 on a mutation dropping the cause (`d2b5-mutation-case10`, at `:593`) | 1 of 1, with the B18 recovery suites 4 files, 13 passed (`d2b-green-crash-unit`); [B24-D2B review] 3 of 3 (`d2b2-green-crash-unit`, `-2`); [B24-D2B review 2] 4 of 4 (`d2b3-green-crash-unit`); [B24-D2B review 3] 5 of 5 (`d2b4-green-crash-unit`, `d2b4-green2-crash-unit`); [B24-D2B review 4] 10 of 10 (`d2b5-green-crash-unit`, `d2b5-green-crash-unit-2`) |

The gates on the final tree, each set under the lock with its exit code:

| set (log) | result | exit |
|---|---|---|
| `app/lib/engineering` (`d2-gate-engineering`) | 99 files, 1107 passed | 0 |
| `app/lib/agent`, with orchestration (`d2-gate-agent`, `d2-gate-agent-2`) | first 1 failed: B09.1's fixture-context count is 13, not 12 (a pin moved in place, section 23); then 85 files, 875 passed | 1, then 0 |
| `app/lib/mcp`, `app/api/mcp` (`d2-gate-mcp`, `d2-gate-mcp-2`) | first 1 failed: `b20-a5-connector-tripwires` T6, red at `3d5f225` (section 24); then 52 files, 920 passed | 1, then 0 |
| `app/lib/computation` (`d2-gate-computation`) | 26 files passed, 2 skipped (the opt-in live suites); 300 passed, 18 skipped | 0 |
| `app/lib/pcb`, the three Java-capable suites excluded (`d2-gate-pcb`) | 127 files passed, 1 skipped; 977 passed, 4 skipped | 0 |
| `app/lib/pcb-sync`, `app/lib/durable-workflow`, `app/api/pcb`, `app/api/pcb-sync` (`d2-gate-sync-durable`) | 20 files passed, 2 skipped; 193 passed, 7 skipped | 0 |
| `app/components/pcb`, `app/lib/project` (with the B14.4 AST gates), `app/lib/atomic`, `app/lib/power` (`d2-gate-components-project`) | 87 files; 822 passed, 1 skipped | 0 |
| `app/lib/workflow/prompt-to-gerber` (`d2-gate-p2g`) | 5 files, 34 passed | 0 |
| `app/lib/acquisition`, `app/lib/auth`, `app/api/__tests__` (`d2-gate-acq-auth-api`) | 82 files passed, 1 skipped; 1753 passed, 11 skipped | 0 |
| `app/lib/manufacturing-providers` (`d2-gate-manufacturing`) | 30 files, 392 passed | 0 |
| `app/lib/qualification` with `database`, `app/lib/evaluation`, `app/lib/deployment`, `app/lib/observability` (`d2-gate-qualification`, `d2-gate-qualification-2`) | first 1 failed: B24-D0's C21 (`scenario-map.ts:402`) after an inserted evidence line; the evidence was folded onto an existing line instead, so no line moves; then 47 files passed, 3 skipped; 461 passed, 15 skipped | 1, then 0 |
| the runner and B22 process suites (`d2-process-gates-3`) | 15 files, 155 passed | 0 |
| the scenario map, the catalog, the score separation, the live-suite honesty (`d2-scenario-catalog-1`) | 4 files, 32 passed | 0 |
| the B21, B22 and B23 closeout tripwires and the page-reading suites on the final pages (`b20-a5-connector-tripwires`, `b20-b1-mcp-exposure`, `b20-b3-mcp-subset-move`, `b20-b4-withhold-proposals`, `b20-b4-process-gate`, `b20-c1-three-way-parity`, `b21-f-page`, `b24-d0-ci-split`, `b24-b3-scenario-map`; `d2-final-closeouts`) | 12 files, 132 passed | 0 |
| `tsc --noEmit` (`d2-final-tsc`, `d2-final-tsc-2`) | one TS2322 in `e2e/multi-tab.spec.ts` (LockManager's overloads), fixed; then clean | 2, then 0 |
| `eslint` on the 49 changed or new TS files (`d2-final-eslint`) | 1 error: `PcbEditor.tsx:1422` `react-hooks/purity` (`Date.now()` during render), a line B24-D2 did not touch (identical at `3d5f225`; B23's closeout lint recorded the same error at `:1422:54`, `closeout2fix-lead-eslint`) | 1 |
| the generators, each twice (`d2-final-gen-*`; the scenario map `d2-gen-scenario-map-3`, `-4`) | tool-registry, read-invocation, agent, b10, b11, b20 manifest, b20 parity, b20 server registry, b21, eval catalog, threshold census, action-toolability, b17 control inventory, scenario map: every second pass zero drift (the diff digest unchanged) | 0 |

The generated hashes: `eval-catalog.csv` `6e847734` and `.json` `c621ca27` (unchanged); `scenario-map.csv` `2c5f46a8` -> `9159165b`,
`.json` `a0c0f6bf` -> `bcaab4f1` (`mapDigest` `eng1-dee4eaa7c1343196` -> `eng1-ef4d20dc3c42e205`); `threshold-census.csv` `586cb9fc`
-> `239bbbdd` (296 -> 301 rows: a budget row each for board-read, process-cleanup and restart-pglite, and a yield and a wait row for
process-cleanup); the registry digest `eng1-a0270c5feaa2c1c4`, the listing `eng1-8a3159295efd1508`.

**The review round** ([B24-D2 review, 2026-10-09]; an adversarial review CONFIRMED fifteen findings; each fixed test-first on the D2
tree, or recorded where the fix is not D2's). Red first, then green:

| finding | the test that reproduces it | red (log) | the fix | green (log) |
|---|---|---|---|---|
| an idle tab's unchanged rewrite locks the first tab out (high) | `b24-d2-working-copy` 6 | "the stored board: A's edit after B's unchanged rewrite is not refused: expected 'conflict' to be true" (`d2fix-red-1`) | an unchanged board keeps the copy's token (section 18) | 8 of 8 (`d2fix-green-1`) |
| a same-tab checkpoint restore refused as another tab | `b24-d2-working-copy` 7 | "the restoring tab's own next edit: expected 'conflict' to be true" (`d2fix-red-1`) | the editor's restore adoption remembers the stored copy | the same |
| case 4 never exercised the stash's own memory | `b24-d2-working-copy` 4, saving straight after the stash | the strengthened case red on a deliberate deletion of that line (`d2fix-mutation-case4`); the source restored, sha256 `82ecf8c6...` matched | (a test-strength fix) | the same |
| no explicit budget on the module-resetting cases (case 1: 1.5-2.5 s) | (a flakiness risk: the measured timings are the evidence) | - | `{ timeout: 30_000 }` on all eight; the census reads them (one budget row, 8 x 30,000 ms) | the same |
| the conflict record's one slot (two tabs suffice) | `b24-d2-working-copy` 8, a recorded limit | - (a characterization: green as written) | recorded (section 18, OD-214's open item) | the same |
| strict-mode providers cannot call the read (high) | `b24-d2-board-read` 9 | written as "the strict call answers as the plain one": `invalid_input`, "args.netName: must be a string", "args.xMinMm: must be a finite number" (`d2fix-red-1`) | not D2's: a reviewed B05 change (OD-236, proposed); the case pins the refusal and D24-29 stays open for strict providers | 10 of 10 (`d2fix-green-1`) |
| the page bound ignored the sanitizer's growth and refusals were unbounded | `b24-d2-board-read` 10 | "layer copperTop page 1: 55902 characters as handed: expected 55902 to be less than or equal to 48000" (`d2fix-red-1`) | sizes measured on the model-bound text; refusals list a prefix that fits | the same |
| `killConfirmed` dropped by every consumer (two findings) | `b24-d2-process-cleanup` 8; the gerbers `route.test.ts` case | the pass executor (timeout, cancelled), the production router and the bundle error each lacked it (`d2fix-red-2-case8`, soft assertions); the route answer too (`d2fix-red-1`) | carried into the attempt evidence, `KicadCliError` and the gerbers answer | 8 of 8; the route 8 of 8 (`d2fix-green-1`) |
| `afterAll` signalled pids confirmed gone (two findings) | `b24-d2-process-cleanup` 7: the survivors list empty once both are confirmed gone | "expected [ 18504, 7900 ] to deeply equal []" (`d2fix-red-1`) | a confirmed pid is struck off; `afterAll` signals only a live one | the same |
| the scratch removal hidden from the write gate | `b11-5-capture-exactness` 12 | with the primitive spelled: "b24-d2-process-cleanup.test.ts: rmSync" (`d2fix-red-b11-5`) | a justified entry, every write line rooted; red again on a line not rooted (`d2fix-mutation-b11-5`; restored, sha256 `bb6873e4...` matched) | 18 of 18 (`d2fix-green-1`) |
| crash (b) passed a silent loss (two findings) | `e2e/crash-recovery.spec.ts` (b) | not runnable here (the lead's browser run); the old and new rules tabulated over every entry state (`d2fix-crash-predicate`, a copy of the logic): the old passes `issued` and `executing` with no notice | the wait ends only on a settlement; a pre-crash state with no notice fails; the consumption is the positive control | PROPOSED |
| the page's record format and two misstatements | (text) | - | the LB notes one heading each; the gate census 22 in 19 (non-live 4 in 4); "no minimum above its maximum" | - |

My first draft of case 8 hung for 60 s before its first line (`d2fix-red-1`, `d2fix-probe-case8`): five dynamic imports of one graph
at once, straight after `vi.resetModules()`, waited on each other; one import at a time fixed it (a test defect, never the product).

The gates on the final tree after the review, each set under the lock with its exit code:

| set (log) | result | exit |
|---|---|---|
| `app/lib/qualification` with `database`, `app/lib/evaluation`, `app/lib/deployment`, `app/lib/observability` (`d2fix-gate-qualification`) | 47 files passed, 3 skipped; 467 passed, 15 skipped | 0 |
| `app/lib/engineering` (`d2fix-gate-engineering`) | 99 files, 1107 passed | 0 |
| `app/lib/agent`, with orchestration (`d2fix-gate-agent`) | 85 files, 875 passed | 0 |
| `app/lib/mcp`, `app/api/mcp` (`d2fix-gate-mcp`) | 52 files, 920 passed | 0 |
| `app/lib/computation` (`d2fix-gate-computation`) | 26 files passed, 2 skipped; 300 passed, 18 skipped | 0 |
| `app/lib/pcb`, the three Java-capable suites excluded (`d2fix-gate-pcb`) | 127 files passed, 1 skipped; 977 passed, 4 skipped | 0 |
| `app/lib/pcb-sync`, `app/lib/durable-workflow`, `app/api/pcb`, `app/api/pcb-sync` (`d2fix-gate-sync-durable`) | 20 files passed, 2 skipped; 194 passed, 7 skipped | 0 |
| `app/components/pcb`, `app/lib/project` (with the B14.4 AST gates), `app/lib/atomic`, `app/lib/power` (`d2fix-gate-components-project`) | 87 files; 822 passed, 1 skipped | 0 |
| `app/lib/workflow/prompt-to-gerber` (`d2fix-gate-p2g`) | 5 files, 34 passed | 0 |
| `app/lib/acquisition`, `app/lib/auth`, `app/api/__tests__` (`d2fix-gate-acq-auth-api`) | 82 files passed, 1 skipped; 1753 passed, 11 skipped | 0 |
| `app/lib/manufacturing-providers` (`d2fix-gate-manufacturing`; the B23 closeout tripwires on these pages among them) | 30 files, 392 passed | 0 |
| the B21, B22 and B23 closeout tripwires and the page-reading suites on the final pages (`b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements`, `b20-a5-connector-tripwires`, `b20-b1-mcp-exposure`, `b20-b3-mcp-subset-move`, `b20-b4-withhold-proposals`, `b20-b4-process-gate`, `b20-c1-three-way-parity`, `b21-f-page`, `b24-d0-ci-split`, `b24-b3-scenario-map`, `b24-b3-live-suite-honesty`, `b24-b3-model-in-loop`; `d2fix-closeouts-1`, `-2`; the three tripwires once more after the last edit of this page, `-3`) | 14 files, 151 passed, twice; then 3 files, 27 passed | 0, 0, 0 |
| `tsc --noEmit` (`d2fix-tsc-1`, `d2fix-tsc-2`) | clean, twice (after the source fixes; after the last test edit) | 0, 0 |
| `eslint` on the 57 changed or new TS files (`d2fix-eslint`) | 1 error, the same `PcbEditor.tsx:1422` `react-hooks/purity` (a line neither round touched) | 1 |
| the generators, each twice (`d2fix-gen-*`, `d2fix-gen-census-literal-*`) | the threshold census and the scenario map moved on their first pass; tool-registry, read-invocation, agent, b10, b11, b20 manifest, b20 parity, b20 server registry, b21, eval catalog, action-toolability and b17 control inventory did not; every second pass zero drift (the tree digest unchanged) | 0 |

The generated hashes after the review: `threshold-census.csv` `239bbbdd` -> `71a35e00` (301 -> 302 rows: the working copy's budget row,
8 at 30,000 ms; board-read's budgets 7 -> 9, process-cleanup's 3 -> 4); `scenario-map.csv` `9159165b` -> `6c5cca36`, `.json`
`bcaab4f1` -> `01933861` (`mapDigest` `eng1-ef4d20dc3c42e205` -> `eng1-e05a2d382b5321d1`: scenario 12's evidence + case 8); the
eval catalog, the registry (`eng1-a0270c5feaa2c1c4`) and every other generated file unchanged.

The gates after the browser close's review round ([B24-D2B review, 2026-10-10]), each under the lock with its exit code (the first
browser close ran the directory gates `d2b-gate-*` on the tree before this round, every one exit 0 after one pin moved; this round's
set is every suite that reads what this round changed):

| set (log) | result | exit |
|---|---|---|
| every suite that imports or reads a file this round changed - `chat-run-view.ts`, `execution-display.ts`, `granted-executions.ts`, the controller, `page.tsx`, the two specs (89 files, found by grep; `d2b2-gate-readers`) | 87 files passed, 2 skipped (the flag-gated `b24-d1-latency`, `b24-d2-memory`); 880 passed, 11 skipped | 0 |
| `tsc --noEmit` (`d2b2-tsc-1`) | clean ([B24-D2B review 2] as reported: the log is empty, since tsc prints nothing when clean, and the exit code was seen on the console only, never written to a file) | 0, not recorded |
| `eslint` on the seven changed files (`d2b2-eslint-1`) | 14 errors, every one in `app/page.tsx` (`react-hooks` refs and set-state-in-effect at lines this round did not touch); `HEAD`'s page.tsx linted under its own name gives the same 14 (`d2b2-eslint-page-head`); the other six files clean | 1 |
| the generators into a scratch directory (`d2b2-gen-*`) | the B17-A control inventory (631 controls, 63 surfaces), the threshold census (865 files, 302 rows), the scenario map and the eval catalog: byte-identical to the committed files | 0 |
| the browser (section 18's last paragraph, section 19) | `d2b-multitab-6` (an earlier case 1), `-7`; `d2b-crash-3` (red for (b) only), `-4`, `-5`; `d2b2-default-final` (exit 1, a worker crash), `d2b2-default-final-2` (60 passed); `d2b2-orch-final` (4 passed) | 0 except `d2b-crash-3` and `d2b2-default-final` (1) |

The 32 evidence PNGs the two configurations rewrite were restored from `HEAD`'s blobs (`git cat-file blob`, never a checkout) and
checked with `git hash-object`: 0 mismatched.

The gates after the second review round ([B24-D2B review 2, 2026-10-10]), each under the lock, its exit code written to a file beside
its log (`.out`) where the tool prints nothing on success:

| set (log) | result | exit |
|---|---|---|
| `b24-d2-crash-recovery`, red then green (`d2b3-red-crash-unit`, `d2b3-green-crash-unit`) | 2 of 4 failed (case 3 at `:204`, case 4 at `:255`), then 4 of 4 | 1, then 0 |
| every suite that imports or reads a file this round changed - `chat-run-view.ts`, `b24-d2-crash-recovery`, the two specs, this page (as it stood before this table) - with the directory scanners over `app/lib/project` and `app/lib/qualification` and `b11-5-capture-exactness` (139 files, found by grep; `d2b3-gate-readers`) | 136 files passed, 3 skipped (the flag-gated `b24-d1-latency`, `b24-d1-latency-workflow`, `b24-d2-memory`); 1227 passed, 15 skipped | 0 |
| `tsc --noEmit --extendedDiagnostics` (`d2b3-tsc-1`) | no error (5,913 files checked; the log holds the diagnostics) | 0 |
| `eslint` on the four changed files (`d2b3-eslint-1`; again as JSON, `d2b3-eslint-2`) | 0 errors, 0 warnings in each | 0, 0 |
| the generators into a scratch directory (`d2b3-gen-*`) | the B17-A control inventory (631 controls, 63 surfaces), the threshold census (865 files, 302 rows), the scenario map and the eval catalog: byte-identical to the committed files | 0 each |
| the browser (sections 18 and 19) | `d2b3-crash-1` (no test ran: the browser did not launch, section 19); `d2b3-crash-2` (2 passed); `d2b3-crash-3-round2code`, `-4-pre2code`, `-5-pre2code-b` (red, on the older code); `d2b3-default-final` (60 passed); `d2b3-orch-final` (4 passed) | 1; 0; 1, 1, 1; 0; 0 |

The suites that read this page were run again on its final text after this table was written; that run is recorded in this round's
report to the lead (`d2b3-page-readers`), never here.

The gates after the third review round ([B24-D2B review 3, 2026-10-10]), each under the lock, its exit code in a file beside its log
(`.out`) or, for a browser run started from the shell, in `logs/d2b4-console-records.txt`:

| set (log) | result | exit |
|---|---|---|
| `b24-d2-crash-recovery`, red, green, red, green (`d2b4-red-crash-unit`, `d2b4-green-crash-unit`, `d2b4-red2-crash-unit`, `d2b4-green2-crash-unit`) | 2 of 5 failed (case 4 at `:280`, case 5 at `:336`); 5 of 5; 4 of 5 failed (`:157`, `:205`, `:256`, `:394`); 5 of 5 | 1, 0, 1, 0 |
| `tsc --noEmit --extendedDiagnostics` (`d2b4-tsc-1`; again on the final bytes, `d2b4-tsc-2`) | no error (5,913 files), twice (the second after the crash spec's two comment lines) | 0, 0 |
| `eslint` on the seven changed code files (`d2b4-eslint-1`) | 15 errors, none on a line this round touched: `PcbEditor.tsx:1422` `react-hooks/purity` (section 22's first table) and the 14 of `app/page.tsx` that `d2b2-eslint-1` recorded, at the same lines with the same rules; `chat-run-view.ts`, `granted-executions.ts`, `execution-display.ts`, the suite and the crash spec clean | 1 |
| every suite that imports or reads a file this round changed - `chat-run-view.ts`, `execution-display.ts`, `granted-executions.ts`, `PcbEditor.tsx`, `page.tsx`, `b24-d2-crash-recovery`, the crash spec, this page (as it stood before this table) - with the directory scanners, joined with the second review round's list (209 files, found by grep; `d2b4-gate-readers`, on the final code and suite bytes) | 206 files passed, 3 skipped (the flag-gated `b24-d1-latency`, `b24-d1-latency-workflow`, `b24-d2-memory`); 2043 passed, 16 skipped; `b24-d2-crash-recovery` 5 of 5 | 0 |
| the browser (section 19) | `d2b4-crash-1` (2 passed); `d2b4-default-final` (60 passed, exit 0); `d2b4-orch-final` (4 passed, exit 0) | 0; 0; 0 |
| the generators into a scratch directory (`d2b4-gen-*`) | the B17-A control inventory (631 controls, 63 surfaces), the threshold census (865 files, 302 rows), the scenario map and the eval catalog: byte-identical to the committed files (no control added or changed) | 0 each |

The suites that read this page were run again on its final text after this table was written; that run is recorded in this
round's report to the lead (`d2b4-page-readers`), never here.

The gates after the fourth review round ([B24-D2B review 4, 2026-10-10]), each under the lock, its console record (the sha256 of the
files it read, its exit code) in `logs/d2b5-console-records.txt`:

| set (log) | result | exit |
|---|---|---|
| `b24-d2-crash-recovery`, red then green (`d2b5-red-crash-unit`, `-2`, `-3`; `d2b5-green-crash-unit`; case 10 rewritten, `d2b5-mutation-case10`, `d2b5-green-crash-unit-2`) | 6 of 10 failed, three times (each run showing more of the same failures); 10 of 10; the rewritten case 10 red on the mutation; 10 of 10 | 1, 1, 1, 0, 1, 0 |
| `tsc --noEmit --extendedDiagnostics` (`d2b5-tsc-1`; again on the final code bytes, `d2b5-tsc-2`) | no error (5,913 files), twice | 0, 0 |
| `eslint` on the seven changed code files (`d2b5-eslint-1`; on the final bytes, `d2b5-eslint-2`) | 15 errors each time, none on a line this round touched: the same lines and rules as `d2b4-eslint-1` (`PcbEditor.tsx:1422` and 14 in `app/page.tsx`); `chat-run-view.ts`, `granted-executions.ts`, `execution-display.ts`, the suite and the crash spec clean | 1, 1 |
| every suite that imports or reads a file this round changed, with the directory scanners, joined with the earlier rounds' lists (209 files, found by grep; `d2b5-gate-readers` on the first fixed code, `d2b5-gate-readers-2` on the final code bytes) | first 205 passed, 3 skipped, 1 failed: the threshold census's byte pin (case 10's first setup carried a 60,000 ms budget; section 19); then 206 files passed, 3 skipped (the flag-gated `b24-d1-latency`, `b24-d1-latency-workflow`, `b24-d2-memory`); 2048 passed, 16 skipped | 1, then 0 |
| the census into a scratch folder (`d2b5-gen-census-probe`) | 303 rows, one more than the committed 302: case 10's first budget; after the rewrite no row is added (the byte pin green in `d2b5-gate-readers-2`) | 0 |
| the browser (section 19) | `d2b5-crash-1` (2 passed); `d2b5-default-final` (60 passed) | 0; 0 |

No UI control was added or changed (one prop and one sweep input in place), so the B17-A control inventory, scenario map and eval
catalog generators were not rerun (the census only as the probe above). The suites that read
this page and the three closeout scanners were run again on its final text after this table was written; that run is recorded in
this round's report to the lead, never here.

## 23. Pins moved (each in place, with a dated `[B24-D2, 2026-10-09]` note)

- The tool counts (47 / 36 / 9 / 27 -> 48 / 37 / 9 / 28; seven withheld -> eight): `b22-b-exposure` (`:56-58`, `:61`, `:63-64`,
  `:110`), `b17-f-agent-exposure` `:92`, `b18-c-exposure-lift` `:58`, `b20-a4-observation-descriptor` `:88-89`, `b20-b1-mcp-exposure`
  (`:58`, `:73`, `:194`, `:199`, `:337`, `:502-503`, `:511`, `:524-525`), `b20-b3-mcp-subset-move` (`:32`, `:43`, `:94`, `:115`,
  `:126`, `:134`, `:136-137`, `:143-144`, `:166`), `b20-b4-withhold-proposals` (`:39`, `:57`, `:112`, `:143-144`, `:148-149`,
  `:224-226`, `:233`), `b21-a-contracts` `:251`, `:287`, `b21-c-least-privilege` (`:19`, `:42`, `:260-265`, `:275`),
  `b21-c-role-tools` `:63`, `:93`, `b21-e1-result-tool` `:54-55`, `b20-c1-three-way-parity` `:241`, `b20-c3-a2-cross-check` `:34`,
  `b20-c3-descriptor-text-gate` `:62`, `b23-a-tier3-vocabulary` `:271`, `b24-a1-readiness` `:295`, `:307`, `:309`, and
  `b09-1-boundary` `:286` (the fixture context's 12 -> 13 declarations).
- B11 and B21: `evaluation-cases.ts:58` (the one `ALL_READS` line), `b21-e2b-trace-attribution` `:49` (its sha256),
  `run-events-and-trace.md:382` (the hash note); `b18-e-board-inspect-budget` `:29` (a title note).
- Memory and the gate census: `b24-d1-latency-policy` (cases 1, 5 and 8: 22 metrics, the memory family's counts, the unit and floor,
  the step line and the memory gate), `b24-b3-live-suite-honesty` (`:253-254`, `:473`, `:475`, `:500`), `scenario-map.md` section 3
  (the `b24-d2-memory` row and the census note), `live-suites.ts` (the `NON_LIVE_GATES` entry), `threshold-census.ts` (the memory
  suite excluded as D1's latency suites are), `b24-d1-threshold-census` case 6.
- The workflow line (`deterministic-manufacturing.yml:384`, the restart suite in database-delivery): `environments-and-deployment.md`
  (one row), `evaluation-matrix.md` C49 417, C93 420, C94 429, `ci-split.md` C12 562, C13 616, C14 621, `ci-admission.md:185`,
  `b24-d0-ci-split` (`:85`, `:90`, `:289`, `:501`, `:542`, `:572`, `:587`).
- Process cleanup: `b22-a2-runtime-profile` `:573` (the two legacy profiles no longer carry `direct-child-kill`).
- Scenario 12 (`scenario-map.ts`, the row's evidence, `missing` and `blockers`; `scenario-map.md:43`, `:68`, `:380`), regenerated.
- [B24-D2 review, 2026-10-09] `b11-5-capture-exactness` case 12 (a `justified` entry for `b24-d2-process-cleanup`, appended to the
  map); scenario 12's evidence + case 8 (`scenario-map.ts`, in place; `scenario-map.md:43`, `:68`, in place; regenerated); the
  threshold census (302 rows; no pin in `b24-d1-threshold-census` moved: it counts no budget rows); the gerbers route suite (one case
  appended). Every source edit of the review is in place (no line of `board-persistence.ts`, `PcbEditor.tsx`, the runners, the pass
  executor, the production router, `fab/types.ts`, `build-bundle.ts` or the gerbers route moved; `board-pages.ts` keeps `:31`,
  `:153-154` and `:162`, its new helpers and import at the end).
- [B24-D2B, 2026-10-10] `b24-d0-ci-split` `:501` (prompt-to-gerber's selection 480 -> 481: `b24-d2-crash-recovery` joins the
  qualification filter's files; in place, with a dated note). No other pin moved: `granted-executions.ts` changed in place (`:578`,
  `:595`, `:597`) with its function appended (`:665-677`), the controller gained one export at its end, and PcbEditor's two notice
  lines and its import line changed in place (no line moved: `PcbEditor.tsx:60`, `:63` and `:602` keep their text). The B17-A control
  inventory, the threshold census (302 rows), the scenario map and the eval catalog regenerated into a scratch directory are byte-
  identical to the committed files (`d2b-gen-*`).
- [B24-D2B review, 2026-10-10] No pin moved. Every edit in place or appended: `page.tsx:62` (the import) and `:6460` (no page.tsx
  line moved; B18-D's wire kept); `execution-display.ts:235` (the one new vocabulary entry on that line); `chat-run-view.ts:313`, its
  new functions appended from `:666`; `granted-executions.ts:672` and `:676`, the notice item appended at `:682`. The generators
  regenerated into a scratch directory are byte-identical (`d2b2-gen-*`).
- [B24-D2B review 2, 2026-10-10] No pin moved outside this increment's own suite: `b24-d2-crash-recovery` case 3's two `left-issued`
  expectations (`not_made`, "Next: Ask again.") moved by review to `outcome_unknown` and the new next step, with case 4 added. Every
  edit in place: `chat-run-view.ts:686-689` (the constant and its next step on one line), `:697-698`, `:728` (no line moved: `:313`,
  `:676`, `:702` keep their text); `e2e/crash-recovery.spec.ts` lines 2-3, 9-10, 25-26 and `:170-173` (the line count kept), the
  outcome record on `:222` and its helper appended at `:225-234`; `e2e/multi-tab.spec.ts` lines 2-3 and a comment appended to `:166`.
  The generators regenerated into a scratch directory: section 22's last table.
- [B24-D2B review 3, 2026-10-10] No pin moved outside this increment's own suite. In `b24-d2-crash-recovery` case 4, the check after
  A's commit that re-read the entry computed before it (vacuous) is removed, and a reload of B's saved entry that must read `committed`
  takes its place; the pinned not-started and interrupted sentences moved by review to the sentences without a prediction; case 5
  added. Every edit in place or appended: `granted-executions.ts:576`, `:578`, `:593`, `:660`, `recordedEnds` appended from `:684`
  (`:79`, `:595`, `:597`, `:615`, `:674`, `:676`, `:682` keep their text); `chat-run-view.ts:685`, `:689`, `:710`, `:718`, `:734`,
  appended from `:745` (`:190`, `:313`, `:676`, `:702`, `:728` keep their text); `execution-display.ts:235`; `PcbEditor.tsx:322`,
  `:371`, `:1688`, `:1695` (`:602`, `:1542`, `:1691` keep their text); `page.tsx:62`, `:6460` (B18-D's wire `onExecutionRecovery=...
  entryRecovery(` kept); the suite's header (lines 37-39) and case 4's title in place (`:204`, `:255` keep their text); in
  `e2e/crash-recovery.spec.ts` the comment lines 3 and 227 only (the line count and every assertion kept).

## 24. Superseded statements (lead decision D5)

| file:line at `3d5f225` | statement | the dated `[B24-D2, 2026-10-09]` note it now carries |
|---|---|---|
| `artifacts/ai-control-plane-b22/runtime-profiles.md:38` | the revision row | `kicad-cli-local-diagnostic` and `freerouting-local-diagnostic` are 2 since B24-D2 (B22-C's wording kept) |
| `runtime-profiles.md:246-248`, `:282-284` | the legacy spawn paragraphs: direct-child kill, terminal before exit | superseded in part (revision 2): the tree kill and the confirm wait; the deviations drop two |
| `adversarial-matrix.md:186` | the reach of `taskkill /T` stays INFERRED | for a node process tree only, case 7 saw `/T` end a detached grandchild |
| `adversarial-matrix.md:187-189`, item 2 at `:242-247` | FreeRouting and kicad-cli keep a direct-child SIGKILL; the proposed follow-up | superseded; done by B24-D2 as proposed |
| `final-verdict.md:100-102` | D22-9's other half open | closed offline; the live orphan runs BLOCKED (LB-3, LB-17) |
| `app/lib/pcb/autoroute/runner.ts:3`, `app/lib/pcb/fab/kicad-cli-runner.ts:2` | the tree kill this runner does not share | the runner now has it (`process-tree.ts`) |
| `app/lib/agent/__tests__/b18-e-board-inspect-budget.test.ts:29` | every routed board leaves the model no board facts | board-inspect only: the paged read pages a routed board |
| `artifacts/ai-control-plane-b20/mcp-server-proposals.md:12`, `mcp-adversarial.md:240-252`, `mcp-exposure.md:23-26`, `:52`, `:71`, `:77-78`, `:168`, `mcp-server-reads.md:12`, `app/lib/engineering/mcp-exposure.ts:31` | seven withheld tools; 47 descriptors | eight since B24-D2 (the paged read, withheld by choice) |
| `artifacts/ai-control-plane-b21/run-events-and-trace.md:382` | `evaluation-cases.ts`'s hash | the B24-D2 hash |
| `scenario-map.md:68`, `:380`; `scenario-map.ts` scenario 12's `missing` | FreeRouting and kicad-cli kill only the direct child | closed offline; the row stays in part for the live orphan runs and the revoked membership |
| `artifacts/ai-control-plane-b20/mcp-provider-connectors.md:254` | the prompt-to-gerber filter line `:131`, twice | moved in place to `:132`: B24-D1's start step shifted it, and `b20-a5-connector-tripwires` T6 resolves both (red at `3d5f225`) |
| this page, `:316` (section 9's row) | "prose no suite resolves" | not so for `mcp-provider-connectors.md:254` |

## 25. What is not measured (never estimated)

- The ubuntu runner's memory figures and the POSIX group kill (the first `benchmark-latency` and prompt-to-gerber runs on the D2
  commit); the memory baseline (OD-212, OD-30).
- The two browser specs' outcomes and durations, and the CI durations of page-browser-e2e and prompt-to-gerber with them (D1's
  headroom steps report them on the D2 commit; section 27). [B24-D2B, 2026-10-10] The outcomes are now MEASURED locally (sections 18
  and 19, one win32 run each); the CI durations stay NOT MEASURED until the D2 commit's run. [B24-D4 lead, 2026-10-10] page-browser-e2e's CI duration with them is RECORDED since (section 29: 21 min 46 s on D2's run, 27 min 40 s on D3's); from B24-D4's commit on, CI runs the two specs in `page-browser-e2e-b24`, not page-browser-e2e (OD-30's split, the lead's option (b); `ci-split.md` section 11).
- A browser heap figure and a routed-board browser journey (LB-8); a real-store restart (LB-14); the live orphan runs (LB-3, LB-17).

## 26. What stays open

- **CONFIRMED, a recorded defect** (was INFERRED; [B24-D2 review, 2026-10-09]): a strict-mode provider's `null` for an unset optional
  property is refused by B05's validator, for this read and via-inspect alike (section 16; `b24-d2-board-read` 9). D24-29 stays
  open for strict-mode providers until OD-236 (proposed) is decided and applied.
- kicad-cli has no abort (section 21); the POSIX detach consequence (section 21, **INFERRED**).
- `PcbEditor.tsx:1422` fails `react-hooks/purity` in the file B24-D2 edited; the line is unchanged here and the error predates B24
  (B23's closeout lint recorded it); the lead's call: a fix belongs with the other react-hooks findings.
- The multi-tab and crash specs' risks (sections 18, 19), until the lead's run; crash (b)'s landed branch (section 19).
  [B24-D2B, 2026-10-10] Both specs ran green after the fixes (sections 18, 19); (b)'s landed branch never ran (the change never
  landed in any run: the dead page holds the only commit path). What stays open from them, recorded: a grant left in flight by a
  crash is named but settled only by a sweep after its commit window, and the editor sweeps once per lifecycle (section 19) - a
  re-sweep scheduled at the commit deadline (with the grace) would settle it in the reopened page; proposed, not built; and the
  reloaded entry is a static record that the sweep's result never updates (`page.tsx:6460`; page.tsx not edited). [B24-D2B review,
  2026-10-10] The last is fixed (section 19): the reloaded entry takes the sweep's result ([B24-D2B review 2] persisted with the
  chat; that it survives a further reload is shown through the unit test's replica only, INFERRED for the page). The re-sweep stays
  proposed.
- [B24-D2B review, 2026-10-10] From the fully stale tab's runs (section 18), recorded, not changed (none overwrites a board record,
  a publication or the head; [B24-D2B review 2] the third, INFERRED from the code, replaces state the tabs share; each is the owner's
  or a later increment's call): the publication's replay answers 200 to a request whose expected revision no longer matches the head
  when its content is an already-published revision (CONFIRMED; why, INFERRED: `app/lib/pcb-sync/durable.ts:84` compares the digest,
  the board and the actor), where a conflict would tell the stale tab more - the spec pins today's replay (`multi-tab.spec.ts:166`)
  and the pin moves by review if the owner chooses the conflict; the toolbar offers "Apply sync plan" for a blocked preflight's plan
  (`PcbEditor.tsx:2565`), which the server refuses (409 `PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH`); and the replay's revision is saved as
  the project's snapshot revision in shared browser storage (`PcbEditor.tsx:923-924`; INFERRED, no run read it), replacing the 2 A's
  publication stored with 1, which a load overrides with the server's head. A worker-process crash (0xC0000409) ended one whole
  default run in case 1, cause UNKNOWN; the rerun was green.
- [B24-D2B review 2, 2026-10-10] A restored entry cannot tell whether another open tab holds a still-issued grant's card or is making
  an interrupted change (no cross-tab channel; the claim registry is per page), so both of its sentences name the other tab; the
  cross-tab case is shown at the unit level only (`b24-d2-crash-recovery` 4), never with two browser tabs on one grant.
  [B24-D2B review 3, 2026-10-10] Those sentences now say only what held at that load, and every editor load re-derives the entry
  from the journal's record (section 19), still at the unit level only for a grant another tab finished. Recorded, not changed: the
  entry is re-derived when the PCB editor's sweep runs (a page that never opens the editor shows the chat as last saved); the journal
  is the profile's and bounded, so an entry restored without a record is withdrawn as of unknown outcome; and a restored entry whose
  grant the sweep poisons kept the live entry's next step, "Check the board and the revision history; the editor's Undo restores the
  previous board." (`restoredEntryRecovery`, pinned alike by case 3), although after a reload the editor's one-step Undo no longer
  applies (`RESTORED_UNDO_HINTS`). [B24-D2B review 4, 2026-10-10] That last is fixed test-first (section 19): a restored entry, re-derived
  or restored from storage, reads "Next: Check the board and the revision history." (`chat-run-view.ts:733`, `:520`; case 3 moved by
  review, case 6).
- [B24-D2B review 4, 2026-10-10] Recorded, not changed (section 19's last limits; INFERRED from the code, no run exercised them): the
  sweep's re-read and its write are two steps, so a cross-tab window stays - a sweep that read `grant-consumed` and finds the commit
  adopts it while the committing tab has not yet recorded it, and past the commit window a sweep sends its `not-committed` settlement
  before its close. A cross-tab lock (the browser's Web Locks) would close both and is not built: the owner's or a later increment's
  call. A write refused on an entry that did not move is reported with B18's transient sentence, which names a read for a write. The
  project guard is display-only (the stale sweep's own project work stands).
- The conflict record keeps one board ([B24-D2 review, 2026-10-09] **CONFIRMED**, `b24-d2-working-copy` 8, was INFERRED): with two
  tabs, a refused save's record and a load-time stash replace each other; a third tab's refused save replaces the second's.
  "Preserved as a recoverable conflict record" holds until the project's next conflict. OD-214's open item.
- [B24-D2 review, 2026-10-09] board-inspect's snapshot carries `generatedInMs`, a timing, so its result is not byte-stable from run
  to run (section 16); not D2's, recorded.
- [B24-D2 lead, 2026-10-10] The browser close's fifth review found the tree sound (no assertion weakened; no medium or high item) and five low items, recorded here and not changed (each INFERRED from the code; no run exercised them): (N7) the sweep's "In progress in another tab" sentence is also written when the other page that moved the journal entry was only another sweep (two tabs reloading together), where round 4 showed "Interrupted" - the entry stays `outcome_unknown` and the next editor load re-derives it; (N8) a committing tab stalled more than 120 s past the commit window plus grace is closed by a later tab's sweep as not made (a terminal entry, never re-derived) while the stalled tab's change still lands - B18's pre-existing path, OD-214's open item, and the reason every "never not made" statement on this page is qualified; (N9) a live entry given one of the sweep's new results (`recorded-*`, `unrecorded`, `in-flight-elsewhere`) reads B18's generic "Recovery reported an unknown result; check the revision history." - nothing false about whether its change landed; (N10) case 3 pins B18's live "the editor's Undo restores the previous board" for a live entry the load sweep poisoned, likely unreachable by Undo after a lifecycle adoption - B18's text, kept; (N11) the orchestration configuration was not re-run by the builder after the fourth review's editor and page edits - the lead ran it on the final bytes (recorded in the ledger), and the evidence PNGs were restored with `git checkout HEAD -- <png>`, the lead's own close procedure, sanctioned for these rounds.

## 27. For the lead

### Closure clauses (one line each, for discovery section 4)

- [B24-D2, 2026-10-09] D24-29: partly closed offline by B24-D2 (OD-213 applied; OD-212's memory half): the bounded paged read `sirkit.pcb.board-page-inspect` reads every recorded routed board, and a synthetic board with ten times their tracks, within 48,000 characters a page measured on the text the model receives, through the real loop with a scripted model (`b24-d2-board-read` 1-8, 10), and six memory metrics in MiB ride `benchmark-latency` (`b24-d2-memory`); it stays OPEN for strict-mode providers: the argument shape they must send (every unset optional property null) is refused `invalid_input` by B05's validation before the read runs (`b24-d2-board-read` 9, a recorded defect shared with via-inspect; D24-43 and OD-236, proposed); the routed-board browser journey is BLOCKED (LB-8), and the memory baseline waits on the owner's Actions minutes (OD-212, OD-30).
- [B24-D2, 2026-10-09; browser run B24-D2B, 2026-10-10] D24-30: closed by B24-D2 (OD-214 applied): the PCB working copy is compare-before-write across tabs, a write that changes no board keeping the copy's token and a checkpoint restore adopted as the tab's own (`b24-d2-working-copy` 1-7, red first), the conflict record one slot (case 8, a recorded limit and OD-214's open item), the durable head survives a restart on PGlite ("not reproduced", `b24-d2-restart-pglite`); in the browser (the default configuration green; the orchestration configuration runs neither spec), on the paths tested no tab overwrites another's board record, publication or head - a second tab's stale schematic edit is refused by the shared canonical store and said so; a tab that never reloaded creates no publication when it Syncs after the other's (the replay of its own revision, pinned as today's behaviour under an open owner question), its preflight is blocked as stale and said so, the apply it is offered is refused (409) and the board record and the head stay the other tab's; a reloaded tab's stale publication is refused `PS_SNAPSHOT_REVISION_CONFLICT`; a stale board save is kept as the conflict record; and no cross-tab channel is used (`e2e/multi-tab.spec.ts`, 3 of 3, after four fixes of the spec's own premises and, on review, the fully stale tab's path restored; the product right on what was tested; the replayed revision saved in the browser storage the tabs share, INFERRED from the code, recorded); and the crash spec found a product defect, CONFIRMED and fixed test-first: a grant the server consumed for a page that closed before the answer was left in flight on reopen with no notice, the entry showing its pre-crash `executing` (a silent loss); the editor's recovery notice now names every grant left in flight that no ritual of the page holds as interrupted, and every editor load re-derives each reloaded, unsettled chat entry from durable truth - the sweep's reading of the journal and the server, or the profile journal's record of the grant's end - saying only what held at that load: interrupted, not started while the server holds the grant issued (never "not made" while another open tab may hold its card), committed once a commit is recorded, not made once the grant is closed, in progress in another tab when another tab moved its journal entry while the sweep read it, of unknown outcome naming a reopened canonical lineage as the cause - never a terminal "not made" the records contradict within the commit window (one exception stays, INFERRED and not run: a committing tab stalled more than 120 s past it, which a later tab's sweep closes as not made while the stalled tab's change still lands - OD-214's open item), the sweep writing only on a journal entry as it read it and answering only for the project the page showed when it started; once a record names its grant a reloaded entry no longer reads "awaiting the editor's result" (one no record names keeps B18's pre-crash "... awaiting the editor's result (interrupted by reload)", case 5), and a restored entry never offers the editor's one-step Undo (`b24-d2-crash-recovery` 1-10, red first; the cross-tab paths at the unit level only, and a window between the sweep's re-read and its write recorded as OD-214's open item); `e2e/crash-recovery.spec.ts`, 2 of 2 (its assertions red in the browser on two older code states - (a), and (b) alone, on the code before the review round; (a) on the round-2 code - and green on the final bytes, alone and in the default configuration: never applied twice, never lost without a notice, the entry itself saying so once the toast is gone), its settlement still waiting for a sweep after the commit window (once per lifecycle; a recorded limit); a real-store restart is BLOCKED (LB-14).
- [B24-D2, 2026-10-09] D24-31: the FreeRouting and kicad-cli remainder is closed offline by B24-D2 (OD-145's method): both runners end the whole tree and settle on the child's exit or after the 5,000 ms confirm wait, and a kill whose exit was not observed is reported in each route attempt's evidence and in kicad-cli's bundle error and gerbers answer (`app/lib/pcb/process-tree.ts`; `b24-d2-process-cleanup` 1-8, with one real node process tree on win32). The live Java and kicad-cli orphan runs stay under LB-3 and LB-17, and OCI cleanup under LB-10.

### The discovery section 4 defect line (a new defect; D24-43 is the next free number at `3d5f225`, the lead assigns it)

- [B24-D2, 2026-10-09] **D24-43 - A strict-mode provider cannot call a read whose optional arguments it leaves unset.** Requirement: B09's strict rendering ("previously-optional fields become nullable ... so optionality survives strict mode without semantic drift", `app/lib/agent/provider-tools.ts:11-12`) and D24-29's paged read (OD-213). Finding (B24-D2 review, 2026-10-09; CONFIRMED by `b24-d2-board-read` 9 through the real loop and gateway): the strict renderer makes every optional property required and nullable (`provider-tools.ts` `convert`), the loop passes the arguments unchanged (`loop.ts:431-433`), and B05's `validateAgainstSchema` refuses `null` for a string or a number (`tool-io-validation.ts:118`, `:126`), so `sirkit.pcb.board-page-inspect` (at least five nulls in every strict call) and `sirkit.pcb.via-inspect` (`{"netName":null}`) answer `invalid_input` before their builders run; the MCP path already reads such a `null` as absent (`app/lib/mcp/server/read-arguments.ts:6-7`, `:139`); every other tool with an optional property on the agent path is INFERRED to share it. Severity high: D24-29's read is unusable by a real provider. Proposed fix: OD-236; owner: the increment the lead names.

### The discovery section 10 line

- [B24-D2, 2026-10-09] B24-D2 landed the paged board read and the memory metrics (D24-29 in part; OD-213, OD-212's memory half), the working-copy compare, the restart characterization and the two browser specs (D24-30; OD-214) and the FreeRouting and kicad-cli tree kill (D24-31's remainder; OD-145), with OD-235 for its stated choices; its review round fixed a two-tab lockout, a same-tab restore refusal, the page bound's blindness to the sanitizer and the dropped kill confirmation, strengthened four suites and the crash spec, and recorded D24-43 (OD-236, proposed); [B24-D2B, 2026-10-10] the lead's browser run found a silent loss after a crash (a consumed grant left in flight with no notice), fixed test-first in the editor's recovery notice and, after its review, in the reloaded chat entry - after its second review a still-issued grant's entry is not started and open, never "not made" while another tab may hold its card, and after its third every editor load re-derives a reloaded, unsettled entry from the journal's record, saying only what held at that load, and after its fourth a sweep writes only on a journal entry as it read it (never "not made" for a change another tab committed within the commit window (one exception stays, INFERRED and not run: a committing tab stalled more than 120 s past it, which a later tab's sweep closes as not made while the stalled tab's change still lands - OD-214's open item)), answers only for the project the page showed when it started and names a reopened lineage as a lasting cause, and a restored entry never offers the editor's one-step Undo - and four wrong premises in the multi-tab spec, fixed in the spec with the fully stale tab's path kept; one run, the lead's one commit (lead decision D21).

### OD entries

## OD-213 — the bounded paged board read, as applied (B24-D2, 2026-10-09)

- Question: how the agent reads a large board when board-inspect's whole snapshot is over the loop's 60,000-character result budget (D24-29; every recorded routed board, `b18-e-board-inspect-budget`).
- Default applied: a separate Tier 0 read, `sirkit.pcb.board-page-inspect` 1.0.0 (binding `read.board-page` 1.0.0): exactly one selector (a layer, a net name, or a flat region in mm), board-inspect's own projections selected by stated membership, whole items in a stable order, pages of at most 48,000 characters of loop result with a stated 12,000 margin, every size measured as the larger of its raw and its model-bound JSON, a cursor bound to the board revision and the selector, an item larger than a page refused by kind and id (`item_over_budget`), and closed refusals answered as a read, a refusal's known names a prefix that fits a page beside their true count. board-inspect itself is unchanged.
- Applied by B24-D2: `app/lib/pcb/ai/board-pages.ts`; in place `tool-catalog.ts`, `tool-bindings-readonly.ts`, `agent-exposure.ts`, `mcp-exposure-review.ts`, `evaluation-cases.ts`; `b24-d2-board-read` (10).
- Not yet met for strict-mode providers: their call shape is refused by B05's validation before the read runs (`b24-d2-board-read` 9; D24-43; OD-236, proposed).
- The owner may choose otherwise.

## OD-214 — two tabs, a crash and a restart, as applied (B24-D2, 2026-10-09)

- Question: what two tabs of one profile, a page closed mid-commit and a server restart may do to a project's state (D24-30).
- Default applied: the PCB working copy is compare-before-write (a write token per copy, kept when a write changes no board; a save over a different board another tab wrote since is refused and kept as the conflict record, and the tab says so; a checkpoint restore adopted as the restoring tab's own; no cross-tab channel); the durable publication's revision check stays the server's; a page closed mid-commit is settled by B18's recovery, never applied twice and never lost without a notice - a reloaded entry in its pre-crash state with no recovery notice counts as a loss ([B24-D2B, 2026-10-10] the browser run found exactly that loss and it is fixed: the editor's recovery notice names every grant left in flight that no ritual of the page holds as interrupted, and the reloaded chat entry takes the sweep's result - the page's own in-flight execution still never shown; [B24-D2B review 2] a reloaded entry whose grant the server still holds issued is not started and open, never "not made", since another open tab of the profile may still hold that grant's card; [B24-D2B review 3] and every editor load re-derives each reloaded, unsettled entry from durable truth - the sweep's reading of the journal and the server, or the profile journal's record of a grant outside its work list (committed, closed, unverifiable, or no record any more) - its sentences saying only what held at that load; [B24-D2B review 4] the sweep writes only on a journal entry as it read it and otherwise reports what holds, never "not made" for a change another tab committed within the commit window (one exception stays, INFERRED and not run: a committing tab stalled more than 120 s past it, which a later tab's sweep closes as not made while the stalled tab's change still lands - OD-214's open item) and never poisoning another tab's execution in flight, it answers only for the project the page showed when it started, a reopened canonical lineage is named as a lasting cause, and a restored entry never offers the editor's one-step Undo); a restart is proven on PGlite, a real store under LB-14.
- Open item: the conflict record is one slot - a refused save's record and a load-time stash replace each other, with two tabs (`b24-d2-working-copy` 8, a recorded limit); a record per conflict is more than a compare-before-write and is not built.
- [B24-D2B, 2026-10-10] Open item: a grant left in flight by a crash is named on reopen (the notice and its chat entry, which says so) but settled only by a sweep after its commit window and grace, and the editor sweeps once per lifecycle (the next reopen); a re-sweep scheduled at the commit deadline is proposed, not built.
- [B24-D2B review, 2026-10-10] Observed in the browser, not changed (no board record, publication or head is overwritten; the owner may choose otherwise): a tab that never reloaded and Syncs content that is an already-published revision is answered that revision's replay (200, nothing created) rather than `PS_SNAPSHOT_REVISION_CONFLICT` - why, INFERRED from the code: the publication's replay check does not compare the expected revision (`durable.ts:84`); its preflight is blocked as stale and the apply its toolbar still offers is refused 409. [B24-D2B review 2] `e2e/multi-tab.spec.ts:166` pins the replay as today's behaviour; if the owner chooses the conflict, it moves by review. INFERRED from the code, never read by a run: the replayed revision (1) is saved as the project's snapshot revision in the browser storage both tabs share, replacing the other tab's 2 until a load takes the server's head.
- [B24-D2B review 4, 2026-10-10] Open item: the sweep's re-read of a journal entry and its write are two steps, so a cross-tab window stays (a sweep that read `grant-consumed` adopting a commit the committing tab has not recorded yet; past the commit window, a `not-committed` settlement sent before the close; INFERRED from the code, no run exercised it); a cross-tab lock (the browser's Web Locks) would close it and is not built.
- Applied by B24-D2: in place `app/lib/pcb/board-persistence.ts`, `lib/persistence.ts`, `app/components/pcb/PcbEditor.tsx`; `b24-d2-working-copy` (8), `b24-d2-restart-pglite` (1), `e2e/multi-tab.spec.ts` (3), `e2e/crash-recovery.spec.ts` (2); [B24-D2B, 2026-10-10] `app/lib/engineering/granted-executions.ts` (in place, one function and one constant appended), `app/lib/project/granted-execution-controller.internal.ts` (one re-export), [B24-D2B review] in place `app/page.tsx` (`:62`, `:6460`), `app/lib/project/execution-display.ts` (`:235`), `app/lib/project/chat-run-view.ts` (`:313`; two functions appended; [B24-D2B review 2] in place `:686-689`, `:697-698`, `:728`), `b24-d2-crash-recovery` (4); [B24-D2B review 3] in place `app/components/pcb/PcbEditor.tsx` (`:322`, `:371`, `:1688`, `:1695`), `app/page.tsx:62` and `:6460`, `granted-executions.ts` (`:576`, `:578`, `:593`, `:660`; `recordedEnds` appended), `chat-run-view.ts` (`:685`, `:689`, `:710`, `:718`, `:734`; three functions appended), `execution-display.ts:235`; `b24-d2-crash-recovery` (5); [B24-D2B review 4] in place `granted-executions.ts` (`:576`, `:578`, `:590`, `:593`, `:603`, `:608`, `:613`, `:617`, `:620`, `:623`, `:625-626`, `:635`, `:645`, `:651-652`, `:660`; `stillAsRead`, `sweepWrite`, `heldNow`, `projectKeptBy` appended), `chat-run-view.ts` (`:520`, `:676`, `:678`, `:685`, `:718`, `:729`, `:733`, `:735`, `:788`; comments at `:689`, `:749`, `:753`; `restoredLandedNext` and one constant appended), `execution-display.ts:238` (and a comment at `:235`), `PcbEditor.tsx` (`:322`, `:371`, `:1688`, `:1695`), `page.tsx:6460`; `b24-d2-crash-recovery` (10).
- The owner may choose otherwise.

### OD-212 amendment

- [B24-D2, 2026-10-09] The memory half, as applied: six `LATENCY_METRICS` entries of family `memory` (unit MiB; 2 warm-ups, 30 samples; floors 1 MiB heap, 8 MiB rss) in `b24-d2-memory`, through B24-D1's writer, job and flag; `evaluateLatency` unchanged; while the latest baseline is the declared-without-values v1, their `baseline_missing` is the same recorded, non-blocking BLOCKED state (lead decision D3); the stage-09 `memoryMiB` field stays unfilled.

## OD-235 — B24-D2: stated choices beyond its task text, as applied (B24-D2, 2026-10-09)

- The tool id `sirkit.pcb.board-page-inspect`; the page constant 48,000 characters of loop result with a 12,000 margin under `MAX_RESULT_CHARS` (1,000 of it for the envelope); the cursor `bp1.<page>.<hash>` over the schema, the revision, the selector and the page.
- MCP withholds the read by choice although durable state can serve it (OD-48, OD-54): a third withheld category beside the two unservable reads and the five proposals; the counts 48 / 37 / 9 / 28.
- The B11 move: the one `ALL_READS` line (`evaluation-cases.ts:58`) and its sha256 `2b392c0ac18c4f37bfa35e7d8098cd2b67fdd7d949c6f954d3d2d7d257a6f4b9` in B21's `SCANNED_AT_HEAD` (was `6637099755e2d0a968a15e2b4bc73f12c27f026b721dd087c0acc25c3f1ecc16`); the capsules regenerated.
- The specialist rows and the coordinator prompt unchanged.
- The tree kill: the killer's `spawn` injected by each runner (no new spawner, no process module named); the Windows directory used only when absolute under B22-A3's rule (else the direct kill only); a child with no pid gets the direct kill only; `TREE_KILL_CONFIRM_MS` 5,000, B22-A3's confirm wait.
- The two legacy runtime profiles go from revision 1 to 2.
- On POSIX each runner's child leads its own process group (detached): a terminal's Ctrl-C no longer reaches it.
- kicad-cli takes no abort signal: a limit, recorded.
- The memory metrics: unit MiB, floors 1 and 8 MiB, 2 warm-ups and 30 samples; `--expose-gc` named twice in the job's step.
- The working-copy compare, built (not only proposed); [B24-D2 review] a write that changes no board keeps the stored copy's token (the stored board, or the very board the tab holds with nobody writing since), and the editor's two checkpoint-restore adoptions remember the stored copy (`rememberStoredWorkingCopy`); page.tsx is not edited.
- [B24-D2 review] The page bound measured on the model-bound text (the larger of the raw and the sanitized JSON, the redaction authority imported by `board-pages.ts`); a refusal's known names a prefix that fits.
- [B24-D2 review] `killConfirmed` carried, only when the runner reports it, into the route attempt evidence (the pass executor and the production router), `KicadCliError` and the gerbers route's 500 answer.
- [B24-D2 review] The process-cleanup suite spells its scratch removal, admitted by `b11-5-capture-exactness` case 12 while every write line is rooted at its temporary root; a pid confirmed gone is struck off the survivors.
- The crash outcomes found: none yet (the spec is PROPOSED until the lead's run); [B24-D2 review] its (b) takes the grant's recorded consumption as the positive control and counts a pre-crash entry state with no recovery notice as the silent loss. [B24-D2B, 2026-10-10] Found: (a) not applied, the grant issued, and its reopened entry left in its pre-crash "Executing ... awaiting the editor's result (interrupted by reload)"; (b) a silent loss before the fix, not applied and named after it (section 19). The own-ritual case is marked on the sweep's result (`heldHere`), not read from its detail text. [B24-D2B review, 2026-10-10] The notice names a grant left in flight that no ritual of the page holds `interrupted (not running in this page; no change from it is recorded on this board)`, never by the raw `left-in-flight`; the four settled actions keep the sweep's terse words; the chat entry's sentence for it is `interrupted-in-flight` (a display action of `chat-run-view.ts`, not a sweep action); a restored entry is never shown as running. [B24-D2B review 2, 2026-10-10] A restored entry whose grant the server still holds issued is `outcome_unknown`, with the next step "Check your other open tabs of this project; ask again if you still want the change." (it replaces a terminal "Not made — the page closed before the server started this change ... Nothing was changed."). [B24-D2B review 3, 2026-10-10] Its sentence and the interrupted one say only what held at that load, never a later close: "Not started — when the editor loaded this project, the server still held this change's grant unused, so nothing had been changed by it. This page cannot start it: a reload keeps no confirmation card. Another open tab of this project may still start it." and "Interrupted — when the editor loaded this project, the server had started this change, but no execution of it was running in this page and no change from it was recorded on this board. Another open tab of this project may still be making it." (their second-round wordings predicted one end each). Every editor load re-derives each reloaded, unsettled entry: the page names the grants (`restoredEntryGrants`), the sweep answers each one outside its work list from the journal (`recordedEnds`: `recorded-committed`, `recorded-not-committed`, `recorded-unverified`, `unrecorded`, read-only, no server call), a recorded commit is written as the adopted path writes it, and where no record names the grant any more only a sentence a load wrote is withdrawn ("Outcome not known — ..."), B18's pre-crash records kept; no re-derivation is a toast. The multi-tab spec's case 1 runs the fully stale tab first and the conflict after it (its dialog's revisions are B's reload's: 2 and 3); its replay pin records today's behaviour under OD-214's open question. [B24-D2B review 4, 2026-10-10] A restored landed-unverified entry's next step is "Next: Check the board and the revision history." (the recorded-unverifiable path's), re-derived or restored from storage. Before each journal write (and before a server settlement) the sweep reads the entry again and writes only while it holds the state the sweep read - one more journal read per write, no cross-tab lock; a write not made or refused is answered with what holds (`heldNow`: a recorded end as `recordedEnds` reports it; an unmoved entry `unavailable`; an entry another page moved and has not finished `in-flight-elsewhere`, unless the server already holds its committed report), the new result reading "In progress in another tab — when the editor loaded this project, another open tab of this project was carrying this change forward (its execution record moved while this page read it), so this page left it to that tab." with the next step "Check your other open tabs of this project, or the board and the revision history.", never a toast. A reopened lineage stays B18-E's `unavailable` result with `cause: "lineage-reopened"` (no new sweep action, so `b18-e-lost-settlement` is unchanged), shown as the display action `lineage-reopened`: "Outcome not known — when the editor loaded this project, the board's canonical history had been reopened since this change was started, so its records could neither prove nor disprove that the change was made." The sweep's input `pageProject` (the page passes its `projectRef`) is read when the sweep starts; once it names another project the sweep returns no result and asks about no restored grant.
- The owner may choose otherwise.

## OD-236 — a strict-mode provider's null for an optional argument (proposed by B24-D2's review, 2026-10-09)

- Question: should the agent path read a `null` for a property the descriptor leaves optional as absent before B05 validates the arguments, since B09's strict rendering makes every optional property required and nullable and a strict-mode provider must therefore send `null` for each one it leaves unset (D24-43)?
- Safe default (until decided): no change. D24-29 stays open for strict-mode providers; `b24-d2-board-read` 9 pins the refusal (`invalid_input`) for the paged read and via-inspect.
- Proposed: in the agent tool path, before validation, drop each `null` whose property the descriptor's schema leaves optional (top level and, following the schema, nested objects), never for a required property; the trace keeps the arguments as sent; the MCP path's reading (`read-arguments.ts:6-7`, `:139`) is the precedent. Its own increment: B05 and B09 pins and replay fixtures re-derived, `b24-d2-board-read` 9 moved by review to "answers as the plain call does".
- The owner may choose otherwise.

### The LB-14 note

- [B24-D2, 2026-10-09] LB-14 note: B24-D2's restart is PGlite in process (`b24-d2-restart-pglite`, "not reproduced"); a real server restart, failover and point-in-time recovery stay under LB-14.

### The LB-17 note

- [B24-D2, 2026-10-09] LB-17 note: the live kicad-cli orphan run stays under LB-17; offline, `b24-d2-process-cleanup` proves the tree kill with fakes and one real node tree, and that an unconfirmed kill is reported in the bundle error and the gerbers answer.

### The LB-3 note

- [B24-D2, 2026-10-09] LB-3 note: the live FreeRouting (Java) orphan run stays local-only (LB-3); the tree kill is proven offline, and an unconfirmed kill is reported in each route attempt's evidence.

### The LB-8 note

- [B24-D2, 2026-10-09] LB-8 note: no routed board in a browser journey, so no browser heap figure and no browser paged read; the paged read is proven through the real loop on the recorded routed boards, with a scripted model (a strict-mode provider's call is refused, D24-43).

### The LB-10 note

- [B24-D2, 2026-10-09] LB-10 note: OCI cleanup is untouched by B24-D2; the tree kill covers the local FreeRouting and kicad-cli runners only.

### The README row

| B24-D2 large boards, memory, multi-tab, crash, restart, process cleanup (D24-29 in part, D24-30, D24-31's remainder; OD-213, OD-214, OD-212 amended, OD-235; D24-43 and OD-236 proposed) | `performance-and-reliability.md` (part 2); code `app/lib/pcb/ai/board-pages.ts`, `app/lib/pcb/process-tree.ts`, in place `tool-catalog.ts`, `tool-bindings-readonly.ts`, `agent-exposure.ts`, `mcp-exposure-review.ts`, `evaluation-cases.ts`, `latency-policy.ts`, `threshold-census.ts`, `live-suites.ts`, `scenario-map.ts`, `runtime-profile.ts`, `autoroute/runner.ts`, `fab/kicad-cli-runner.ts`, `board-persistence.ts`, `lib/persistence.ts`, `PcbEditor.tsx`, `freerouting-pass-executor.ts`, `production-router.ts`, `autoroute/completion.ts`, `fab/types.ts`, `fab/build-bundle.ts`, `app/api/pcb/export/gerbers/route.ts`, `granted-executions.ts` and `granted-execution-controller.internal.ts` (B24-D2B), `page.tsx`, `execution-display.ts` and `chat-run-view.ts` (B24-D2B review); workflows `benchmark.yml` (`:93-95`, `:113`), `deterministic-manufacturing.yml:384`; suites `b24-d2-board-read` (10), `b24-d2-memory` (4), `b24-d2-process-cleanup` (8), `b24-d2-working-copy` (8), `b24-d2-restart-pglite` (1), `b24-d2-crash-recovery` (10, B24-D2B), one case appended to `app/api/pcb/export/gerbers/__tests__/route.test.ts`; specs `e2e/multi-tab.spec.ts` (3), `e2e/crash-recovery.spec.ts` (2), green in the default configuration (B24-D2B, 2026-10-10; the orchestration configuration runs neither) | done 2026-10-09 offline, review round 2026-10-10, browser close 2026-10-10 (the crash spec's silent loss fixed in the product, its notice carried into the reloaded chat entry on review, a still-issued grant's entry not started and open on the second review, every editor load re-deriving a reloaded entry from the journal's record on the third, and on the fourth a sweep writing only on a journal entry as it read it, answering only for the project the page showed when it started, naming a reopened lineage, and a restored entry never offering the editor's one-step Undo; the multi-tab spec's four premises fixed and the fully stale tab's path kept); D24-29 open for strict-mode providers (D24-43, OD-236 proposed); the memory baseline, the live orphan runs, a real-store restart and the routed browser board BLOCKED-LIVE-QUALIFICATION (OD-212, LB-3, LB-17, LB-14, LB-8); census 168 / 165 / 3 / 0, counts 48 / 37 / 9 / 28 |

### B24-D2 - Large boards, memory, multi-tab, crash, cleanup (2026-10-09 local; increment workflow + lead; this commit)

Test-first on `chapter/b24-production-qualification` from `3d5f225`, one run (D2a and D2b together, lead decision D21). Red first: the paged read refused `unknown_tool` with its module absent (`d2-red-board-read-2`, 8 of 8); B11 with the read registered and `ALL_READS` unmoved, 5 failed of 79 (`d2-red-b11`); the memory suite with no memory metric catalogued (`d2-red-memory-2`, 4 of 4); the process-cleanup suite with the helper absent (7 of 7), then with the runners of `3d5f225` (4 of 7: no tree kill, no `killConfirmed`), then the real orphan grandchild alive on win32 (`d2-red-process-cleanup`, `-2`, `-3`); the working copy silently replaced across two tabs (`d2-red-working-copy`, 2 of 5). Not reproduced: the restart on PGlite (`d2-restart-pglite-1`). The counts moved 47 / 36 / 9 / 27 -> 48 / 37 / 9 / 28 and the B09.1 fixture context 12 -> 13 declarations, each pin in place with a dated note; the B11 move is one `ALL_READS` line with B21's sha256 moved (`66370997...` -> `2b392c0a...`). The review round (an adversarial review CONFIRMED fifteen findings) fixed each test-first: 7 failed of 34 in 4 files on the D2 tree (`d2fix-red-1`: the two-tab lockout and the same-tab restore refusal, `b24-d2-working-copy` 6, 7; the strict-mode call refused, `b24-d2-board-read` 9; a 55,902-character page, 10; the survivors not struck off, `b24-d2-process-cleanup` 7; the kill confirmation dropped by the pass executor, the production router, the bundle error and the gerbers answer, 8 and `route.test.ts`), the scratch removal hidden from the write gate (`d2fix-red-b11-5`), and two mutation proofs (`d2fix-mutation-case4`, `d2fix-mutation-b11-5`, each source restored and its sha256 matched); then 52 of 52 (`d2fix-green-1`). The strict-mode refusal is not D2's to fix: D24-43 and OD-236 are proposed, `b24-d2-board-read` 9 pins it, and D24-29 stays open for those providers. Generators twice with zero drift (registry `eng1-a0270c5feaa2c1c4`; scenario map `eng1-e05a2d382b5321d1`; threshold census 302 rows). The memory figures are local (win32, Node v24.15.0); the baseline is BLOCKED (OD-212, OD-30). CI durations: NOT MEASURED at the time of writing (the D2 commit's run reports them through B24-D1's headroom steps). One red found at `3d5f225` and fixed in place: `b20-a5-connector-tripwires` T6 (B24-D1's start step shifted the filter line its page cites). [B24-D2B, 2026-10-10] The lead's browser run (56 passed, 2 failed, 2 did not run) failed one case of each new spec; each was reproduced alone with its trace kept and decided from the trace and the code. Crash (b) was a product defect, CONFIRMED: a grant the server consumed for a page that closed before the answer was left in flight on reopen with no notice (the sweep's `left-in-flight` was outside the editor's notice), the entry showing its pre-crash `executing` - fixed test-first (`b24-d2-crash-recovery` red, `d2b-red-crash-unit`; the sweep marks its own ritual's result `heldHere` and the notice names every other grant left in flight); the spec green alone (`d2b-crash-2`, 2 of 2). Multi-tab case 1 was the spec's, four premises in turn (the head read from a plain board load, the empty state's Sync test id, the publication's wire shape and 201, and two tabs both editing the schematic, which the shared canonical store refuses with a notice): fixed in the spec, every contract assertion kept; green alone (`d2b-multitab-5`, 3 of 3). Then both configurations: 60 passed (`d2b-default-final`) and 4 passed (`d2b-orch-final`), exit 0 each; one pin moved in place (`b24-d0-ci-split` `:501`, 480 -> 481). [B24-D2B review, 2026-10-10] Its review found two holes, each fixed: the multi-tab fix had dropped the fully stale tab (B never reloaded, Syncing after A's publication), now case 1's first path - no publication created (the replay of its own revision), its preflight blocked as stale, the apply its toolbar offers refused 409, the board record and the head unchanged, each read back from the server (`d2b-multitab-7`, 3 of 3, the round-2 file alone; `-6` ran an earlier case 1; the product right on what was tested); and the crash notice was a 6 s toast with the raw `left-in-flight` (B18's "still in progress") beside an entry still "awaiting the editor's result" - CONFIRMED, fixed test-first (`b24-d2-crash-recovery` 1-3 red, `d2b2-red-crash-unit`, `-2`): the notice says `interrupted`, and the reloaded chat entry takes the sweep's result (`chat-run-view.ts` `restoredEntryRecovery`, `page.tsx:6460` in place); the spec green alone (`d2b-crash-5`, 2 of 2). The default configuration then: 57 passed, 1 failed, 2 did not run (`d2b2-default-final`: a Playwright worker-process crash, 0xC0000409, in multi-tab case 1 after its last server call, no assertion failed, cause UNKNOWN), rerun with memory sampled: 60 passed (`d2b2-default-final-2`, exit 0; the worker's peak 519 MB); orchestration 4 passed (`d2b2-orch-final`, exit 0); no pin moved. [B24-D2B review 2, 2026-10-10] Its second review found one product defect and seven claims broader than the runs. The defect, CONFIRMED at the unit level and fixed test-first: a restored entry whose grant the server still holds issued was made a terminal "Not made ... Nothing was changed." although another open tab of the profile may still hold that grant's card and commit it (the journal is the profile's, the claim registry the page's); now not started and open (`outcome_unknown`), its sentence naming the other tab (`b24-d2-crash-recovery` 4 - the other tab commits, or the expired grant is closed by a later sweep - red first with case 3, `d2b3-red-crash-unit`, 2 of 4; green `d2b3-green-crash-unit`, 4 of 4; `chat-run-view.ts` in place). The crash spec's assertions as that round left them are red in the browser on two older code states, each put over the working files for one run and restored byte-identical by sha256 ((a) at `:172` and (b) alone at `:211` on the code before the review round, `d2b3-crash-4-pre2code`, `d2b3-crash-5-pre2code-b`; (a) at `:172` on the round-2 code, `d2b3-crash-3-round2code`; no run put the code before the first fix under them, and (b)'s durable-entry assertions were never reached) and green alone (`d2b3-crash-2`, 2 of 2, recording (a)'s entry `not_made` at (b)'s reopen, its grant retired - by (b)'s newer grant, INFERRED - without showing which record was restored there). The claims now match the runs: `d2b-crash-3` showed (b) red only, on code with a stub not kept; `d2b-multitab-6` ran an earlier case 1; the specs run in the default configuration only; the stored replayed revision and the entry's survival of a further reload are INFERRED; `d2b2-tsc-1`'s exit was never recorded; the replay pin says at its line that it records today's behaviour under OD-214's open question. The default configuration: 60 passed (`d2b3-default-final`, exit 0); orchestration 4 passed (`d2b3-orch-final`, exit 0); no pin moved outside `b24-d2-crash-recovery`. [B24-D2B review 3, 2026-10-10] Its third review found one product defect and four texts broader than the runs. The defect, CONFIRMED at the unit level and fixed test-first: a restored entry kept a sentence an earlier load wrote - once another tab committed the grant, the journal entry was finished, no sweep named the grant again, and the tab that saved its chat last restored "Not started ..." at every load for a change that had landed; now every editor load re-derives each restored, unsettled entry from durable truth (the page names the grants, `restoredEntryGrants`; the sweep answers each one outside its work list from the profile journal's record, `recordedEnds` - committed, closed, unverifiable, or no record any more - read-only, no server call), and a load's sentences say only what held at that load, never a later close (`b24-d2-crash-recovery` 4 extended and 5 added, red first on the round's start code, `d2b4-red-crash-unit`, 2 of 5, then on the fixed code with the sentences pinned, `d2b4-red2-crash-unit`, 4 of 5; green `d2b4-green-crash-unit`, `d2b4-green2-crash-unit`, 5 of 5; in place in `granted-executions.ts`, `chat-run-view.ts`, `execution-display.ts`, `PcbEditor.tsx` and `page.tsx`, appended functions; the cross-tab path at the unit level only). The texts: the not-started sentence predicted expiry only (a newer grant for the same principal and editor, a cancel or another tab's commit also end an issued grant), (a)'s record at (b)'s reopen does not show which record was closed, the crash spec's reds ran two older code states only, its header now names every section that records a run of it (section 19 lists them all), and the PNG restore by `git checkout HEAD` is the lead's close procedure, sanctioned for this round. The crash spec alone on the final bytes: 2 passed (`d2b4-crash-1`, exit 0); the default configuration 60 passed (`d2b4-default-final`, exit 0); orchestration 4 passed (`d2b4-orch-final`, exit 0); no pin moved outside `b24-d2-crash-recovery`. [B24-D2B review 4, 2026-10-10] Its fourth review found four paths on which what a load writes could still be false, each CONFIRMED at the unit level and fixed test-first, and texts broader than the code. The defects: a restored landed-unverified entry offered the editor's one-step Undo, which a reload no longer offers (now the restored next step, "Check the board and the revision history."); a sweep whose write met a journal entry another tab had moved since the sweep read it reported a change that landed as not made (its refused close ignored), or poisoned the other tab's execution in flight and settled the grant poisoned on the server (now the sweep reads the entry again before each write, writes only while it holds the state it read, and otherwise reports what holds - an end the journal records, or "In progress in another tab"); a sweep in flight answered for a project the page had left (now it answers only for the project the page showed when it started); and an entry the sweep cannot settle because the canonical lineage was reopened promised a retry (now it names that cause; B18-E's result kept, with a `cause`) (`b24-d2-crash-recovery` 3 moved by review and 6-10 added, red first on the round's start code, `d2b5-red-crash-unit`, 6 of 10, with `-2` and `-3` showing every failure; green `d2b5-green-crash-unit`, 10 of 10; case 10 rewritten without the agent loop so that no 60,000 ms budget reaches the threshold census, red on a mutation, `d2b5-mutation-case10`, green `d2b5-green-crash-unit-2`; in place in `granted-executions.ts`, `chat-run-view.ts`, `execution-display.ts`, `PcbEditor.tsx` and `page.tsx`, helpers appended; the cross-tab paths at the unit level only, and a cross-tab window between the sweep's re-read and its write recorded, INFERRED). The texts: "every load" now reads "every editor load"; the D24-30 clause no longer says a reloaded entry never reads "awaiting the editor's result" (one no record names keeps B18's pre-crash record, case 5); the second review's browser reds ran two older code states, not "the code before each fix"; the crash spec's header no longer names section 26. The 209 suites that read a changed file green on the final code bytes (`d2b5-gate-readers-2`; the first run, `d2b5-gate-readers`, red only on the census byte pin that case 10's first setup moved); the crash spec alone on the final bytes: 2 passed (`d2b5-crash-1`, exit 0); the default configuration 60 passed (`d2b5-default-final`, exit 0); no pin moved outside `b24-d2-crash-recovery`.

### `PROGRAM_STATE.json`

- next: the chapter's next increment; B24-D2's open items ([B24-D2B, 2026-10-10] the browser run of `e2e/multi-tab.spec.ts` and `e2e/crash-recovery.spec.ts` is done - the default configuration, which alone runs them, green after the product fixes and four spec fixes; the orchestration configuration green too): the memory baseline with D1's (OD-212, OD-30), D24-43 (OD-236, proposed: D24-29 open for strict-mode providers), and a crash's in-flight grant settled only at the next reopen after its commit window (OD-214's second open item; a scheduled re-sweep proposed); [B24-D2B review] the stale tab's publication answered as a replay rather than a conflict (pinned by `e2e/multi-tab.spec.ts:166` as today's behaviour; moved by review if the owner chooses the conflict), and the apply offered for a blocked plan (OD-214's observed item; the owner's call); [B24-D2B review 4] the cross-tab window a sweep's re-read leaves before its write (a sweep adopting a commit the committing tab has not recorded yet; a `not-committed` settlement sent before the close past the commit window; INFERRED, a cross-tab lock not built; section 26).

### The memory baseline (a records commit)

- By B24-D1's protocol (section 13 above): at least three `benchmark-latency` runs on the D2 commit, then `scripts/b24-latency-gate.ts --baseline` with each run's three results files (`b24-d1-latency`, `b24-d1-latency-workflow`, `b24-d2-memory`) under its run id. BLOCKED until the owner accepts the Actions minutes (OD-212, OD-30; section 8 item 11); until then the memory metrics' `baseline_missing` is the recorded, non-blocking BLOCKED state, and `benchmark-latency` is not red for it.

### The browser runs and the CI durations

- Run both Playwright configurations with the two new specs; record each spec's outcome (and `crash-outcome.json`), and read the page-browser-e2e and prompt-to-gerber durations from the D2 commit's run (B24-D1's headroom steps; `gh run view`, read-only). If either job's headroom is under five minutes (`OD30_SPLIT_REQUIRED`), the split is its own reviewed change (OD-30). Read a failure of crash (b)'s landed branch with `crash-outcome.json` first (section 19). [B24-D4 lead, 2026-10-10] Done for D2's commit (section 29); from B24-D4's commit on, CI runs the two specs in `page-browser-e2e-b24`, so their CI durations are that job's, not page-browser-e2e's (OD-30's split, the lead's option (b); `ci-split.md` section 11).
- The B17-A control inventory: no control was added or changed (`generate-b17-control-inventory` twice, zero drift); `PcbEditor.tsx` changed only in place (two restore adoptions, a toast branch, two `=== true` checks), so the browser control-inventory suite is the lead's to run with the specs.
- [B24-D2B, 2026-10-10] Done: both configurations, each under the lock with `pw2.sh` - default 60 passed (9.2 m, `d2b-default-final`), orchestration 4 passed (2.7 m, `d2b-orch-final`), exit 0 each; the new specs' outcomes in sections 18 and 19 and their `crash-outcome.json` there. The 32 evidence PNGs the default run rewrites were restored from `HEAD`'s blobs and verified by `git hash-object` (0 mismatched). The CI durations stay NOT MEASURED until the D2 commit's run. The B17-A inventory regenerated after the notice change: byte-identical (`d2b-gen-generate-b17-control-inventory`; PcbEditor's notice lines and import changed in place, no control). [B24-D2B review, 2026-10-10] Again after the review round: the specs alone (`d2b-multitab-6`, `-7`; `d2b-crash-3` red, `-4`, `-5`), the default configuration twice (`d2b2-default-final`: 57 passed, 1 failed - the worker-process crash, cause UNKNOWN - 2 did not run, exit 1; `d2b2-default-final-2`: 60 passed, 9.5 m, exit 0) and the orchestration configuration (`d2b2-orch-final`: 4 passed, 2.6 m, exit 0); the 32 evidence PNGs restored the same way (0 mismatched); the B17-A inventory, the census, the scenario map and the catalog byte-identical (`d2b2-gen-*`). [B24-D2B review 2, 2026-10-10] Again after the second review round: the crash spec alone on the final bytes (`d2b3-crash-2`, 2 passed) and on two older code states (the code before the review round, `d2b3-crash-4-pre2code` and `-5-pre2code-b`; the round-2 code, `d2b3-crash-3-round2code`; [B24-D2B review 4] as first written, "on the code before each fix", which no run did: none put the code before the first fix under these assertions), each red as section 19 records, each code state restored byte-identical, the default configuration once (`d2b3-default-final`: 60 passed, 9.5 m, exit 0) and the orchestration configuration once (`d2b3-orch-final`: 4 passed, 2.6 m, exit 0; it runs neither new spec); the 32 evidence PNGs restored from `HEAD` (`git checkout HEAD -- <png>`, the lead's close procedure; [B24-D2B review 3] as first written, "as the lead's task names it", which task-D2B.md does not - the lead sanctioned the procedure for the third review round, section 19) and checked with `git hash-object` (0 mismatched); the generators: section 22's last table. [B24-D2B review 3, 2026-10-10] Again after the third review round: the crash spec alone on the final bytes (`d2b4-crash-1`, 2 passed, exit 0), the default configuration once (`d2b4-default-final`: 60 passed, 10.4 m, exit 0) and the orchestration configuration once (`d2b4-orch-final`: 4 passed, 2.7 m, exit 0; it runs neither new spec, run because the page and the editor it shares changed); the evidence PNGs the runs rewrote restored by the lead's sanctioned close procedure (`git checkout HEAD -- <png>`), each checked with `git hash-object` against `HEAD` (31 rewritten, 0 mismatched; all 32 equal `HEAD`); the generators byte-identical (section 22's last table). [B24-D2B review 4, 2026-10-10] Again after the fourth review round: the crash spec alone on the final bytes (`d2b5-crash-1`, 2 passed, exit 0) and the default configuration once (`d2b5-default-final`: 60 passed, 10.4 m, exit 0); the 25 evidence PNGs it rewrote restored by the lead's sanctioned close procedure (`git checkout HEAD -- <png>`), checked with `git hash-object` (all 32 equal `HEAD`, 0 mismatched); the orchestration configuration not run this round (it runs neither spec).

### No local production-mode step

- B24-D2 changes `PcbEditor.tsx` (a toast branch, two `=== true` checks and two checkpoint-restore adoptions; [B24-D2B] the recovery notice from `executionRecoveryNotice`), `board-persistence.ts`, `granted-executions.ts`, [B24-D2B review] `page.tsx` (one import line and the recovery callback, in place; [B24-D2B review 3] and one prop on that line, with PcbEditor's sweep input in place; [B24-D2B review 4] one more prop there, `pageProject`, and PcbEditor's prop and sweep input in place), `chat-run-view.ts`, `execution-display.ts` and the gerbers route's error answer, which a `next build` compiles; no local production-mode run was made here (`next build`, `next start` and `next dev` are the lead's; `pw2.sh`'s `next dev` ran the browser specs); the browser specs exercise them in the fixture runtime.

### LB rows

- None new. LB-14, LB-17, LB-3, LB-8 and LB-10 take the dated notes above.

### Catalog and scenario map

- The catalog (B1): no row added or changed; `b24-b1-catalog` requires no row per `b24-` suite (`eval-catalog.csv` and `.json` unchanged).
- Scenario 12 (B3): stays `in part`; process-failure cleanup now covers FreeRouting and kicad-cli offline (`b24-d2-process-cleanup` 1, 2, 4, 5, 7 and, since the review, 8 as evidence), its blockers LB-3 and LB-17 (the live orphan runs), and the revoked membership is still proven in integration only (OD-27).

## 28. Citations (part 2)

| id | file | line | anchor |
|---|---|---|---|
| D2-C1 | `app/lib/agent/loop.ts` | 54 | `export const MAX_RESULT_CHARS = 60_000;` |
| D2-C2 | `app/lib/pcb/ai/board-pages.ts` | 31 | `export const BOARD_PAGE_MAX_RESULT_CHARS = 48_000;` |
| D2-C3 | `app/lib/pcb/ai/board-pages.ts` | 162 | `export function buildBoardPage(` |
| D2-C4 | `app/lib/engineering/tool-catalog.ts` | 1081 | `function boardPageInspectDescriptor(): ToolDescriptor {` |
| D2-C5 | `app/lib/engineering/mcp-exposure-review.ts` | 40 | `"sirkit.pcb.board-page-inspect",` |
| D2-C6 | `app/lib/agent/evaluation-cases.ts` | 58 | `"sirkit.pcb.board-page-inspect",` |
| D2-C7 | `app/lib/qualification/latency-policy.ts` | 67 | `export const MEMORY_SAMPLES = 30;` |
| D2-C8 | `app/lib/pcb/process-tree.ts` | 20 | `export const TREE_KILL_CONFIRM_MS = 5_000;` |
| D2-C9 | `app/lib/pcb/process-tree.ts` | 51 | `export function killProcessTree(` |
| D2-C10 | `app/lib/pcb/board-persistence.ts` | 216 | `export const WORKING_COPY_CONFLICT = "conflict" as const;` |
| D2-C11 | `lib/persistence.ts` | 53 | `writeId?: string;` |
| D2-C12 | `.github/workflows/deterministic-manufacturing.yml` | 384 | `app/lib/qualification/database/__tests__/b24-d2-restart-pglite.test.ts` |
| D2-C13 | `app/lib/benchmark/types.ts` | 242 | `memoryMiB?: number;` |
| D2-C14 | `app/lib/pcb/board-persistence.ts` | 247 | `function prepareWorkingCopyWrite(projectId: string, board: PcbBoard)` |
| D2-C15 | `app/lib/pcb/board-persistence.ts` | 261 | `export function rememberStoredWorkingCopy(projectId: string): void {` |
| D2-C16 | `app/components/pcb/PcbEditor.tsx` | 602 | `if (board) { if (init.scope) rememberStoredWorkingCopy(init.scope.projectId);` |
| D2-C17 | `app/lib/pcb/ai/board-pages.ts` | 260 | `function measured(value: unknown): number {` |
| D2-C18 | `app/lib/pcb/ai/board-pages.ts` | 265 | `function boundedRefusal(` |
| D2-C19 | `app/lib/pcb/autoroute/freerouting-pass-executor.ts` | 186 | `processStatus: result.processStatus, ...(!result.ok && result.killConfirmed !== undefined` |
| D2-C20 | `app/lib/pcb/autonomous/production-router.ts` | 62 | `...(routed.killConfirmed !== undefined ? { killConfirmed: routed.killConfirmed } : {})` |
| D2-C21 | `app/lib/pcb/fab/types.ts` | 88 | `readonly killConfirmed?: boolean;` |
| D2-C22 | `app/api/pcb/export/gerbers/route.ts` | 280 | `...(e.killConfirmed !== undefined ? { killConfirmed: e.killConfirmed } : {})` |
| D2-C23 | `app/lib/engineering/tool-io-validation.ts` | 118 | `if (typeof value !== "string") return fail("must be a string");` |
| D2-C24 | `app/lib/engineering/granted-executions.ts` | 674 | `export function executionRecoveryNotice(results: readonly GrantedExecutionRecoveryResult[]): string \| null {` |
| D2-C25 | `app/lib/engineering/granted-executions.ts` | 597 | `if (!claim.ok && claim.code === "already-in-flight") { push("left-in-flight", "this page is executing the grant right now; its own ritual settles it", true); continue; }` |
| D2-C26 | `app/components/pcb/PcbEditor.tsx` | 1691 | `const notice = executionRecoveryNotice(results);` |
| D2-C27 | `e2e/multi-tab.spec.ts` | 251 | `function headLoad(page: Page): { request: Request; body: unknown } \| undefined {` |
| D2-C28 | `app/lib/project/chat-run-view.ts` | 676 | `export function recoveryDisplayAction(result: { action: unknown; heldHere?: unknown; cause?: unknown }): string \| null {` |
| D2-C29 | `app/lib/project/chat-run-view.ts` | 702 | `export function restoredEntryRecovery<M extends { id: string }>(messages: M[], grantId: string, action: string): M[] {` |
| D2-C30 | `app/lib/project/chat-run-view.ts` | 313 | `return action === "interrupted-in-flight" ? { ...entry, recovery: null, state: "outcome_unknown",` |
| D2-C31 | `app/lib/project/execution-display.ts` | 235 | `"interrupted-in-flight": "Interrupted — when the editor loaded this project, the server had started this change,` |
| D2-C32 | `app/page.tsx` | 6460 | `onExecutionRecovery={(results) => { for (const result of results) { const action = recoveryDisplayAction(result);` |
| D2-C33 | `app/lib/engineering/granted-executions.ts` | 682 | `const INTERRUPTED_NOTICE_ITEM = "interrupted (not running in this page; no change from it is recorded on this board)";` |
| D2-C34 | `e2e/multi-tab.spec.ts` | 164 | `const stale = await syncAndPublish(pageB);` |
| D2-C35 | `app/lib/pcb-sync/durable.ts` | 84 | `if (replay.result.snapshotDigest !== digest \|\| replay.result.boardId !== boardId \|\| replay.result.actorId !== actorId) throw new Error("PS_SNAPSHOT_IDEMPOTENCY_CONFLICT");` |
| D2-C36 | `app/lib/pcb-sync/service.ts` | 394 | `if (plan.planDigest !== request.planDigest \|\| !this.applyLifecycleEligible(plan)) throw new Error("PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH");` |
| D2-C37 | `app/components/pcb/PcbEditor.tsx` | 2565 | `{pendingPreflight?.plan && <button type="button" data-testid="apply-sync-plan-toolbar"` |
| D2-C38 | `e2e/crash-recovery.spec.ts` | 211 | `expect(recovered.join(" \| "), "the notice never calls the crashed execution in progress").not.toMatch(/left-in-flight\|in progress/i);` |
| D2-C39 | `app/lib/project/chat-run-view.ts` | 689 | `const RESTORED_NOT_STARTED = "Not started — when the editor loaded this project, the server still held this change's grant unused` |
| D2-C40 | `app/lib/project/chat-run-view.ts` | 728 | `settled = { state: "outcome_unknown", text: RESTORED_NOT_STARTED, tail: [row("next",` |
| D2-C41 | `app/lib/engineering/granted-executions.ts` | 615 | `if (status === "issued") { push("left-issued", "the grant is still issued; re-tender or cancel it"); continue; }` |
| D2-C42 | `app/lib/engineering/granted-executions.ts` | 79 | `!outcome.changed && outcome.grantConsumed !== true && (outcome.code === "recovery-required"` |
| D2-C43 | `app/components/pcb/PcbEditor.tsx` | 1542 | `executionJournalStoreRef.current = new IndexedDbAgentExecutionJournalStore();` |
| D2-C44 | `e2e/crash-recovery.spec.ts` | 172 | `await expect.poll(async () => entry.getAttribute("data-state"), { timeout: 30_000 }).toBe("outcome_unknown");` |
| D2-C45 | `e2e/multi-tab.spec.ts` | 166 | `this pin records TODAY's behaviour (a replay, not a conflict) under an open owner question (durable.ts:84, OD-214)` |
| D2-C46 | `app/lib/pcb/lifecycle/owned-operations.ts` | 230 | `ports.persistSnapshotRevision(published.value);` |
| D2-C47 | `app/lib/pcb/board-persistence.ts` | 69 | `export function savePcbSnapshotRevision(projectId: string, revision: number): void {` |
| D2-C48 | `app/lib/engineering/granted-executions.ts` | 660 | `input.restoredGrants ? [...results, ...await recordedEnds(input.journal, input.restoredGrants(), results)] : results;` |
| D2-C49 | `app/lib/engineering/granted-executions.ts` | 695 | `async function recordedEnds(journal: AgentExecutionJournal, asked: readonly string[], named: readonly GrantedExecutionRecoveryResult[])` |
| D2-C50 | `app/lib/engineering/granted-executions.ts` | 593 | `...[...new Set(input.restoredGrants?.() ?? [])].map((grantId): GrantedExecutionRecoveryResult => ({ grantId, state: null, action: "unavailable",` |
| D2-C51 | `app/lib/project/chat-run-view.ts` | 756 | `export function restoredEntryGrants(messages: ReadonlyArray<{ id: string; entries?: ReadonlyArray<{ id: string }> }>, isLive: (grantId: string) => boolean): string[] {` |
| D2-C52 | `app/lib/project/chat-run-view.ts` | 710 | `if (state === null \|\| (action === "unrecorded" && !writtenAtALoad(rows[0]!.text))) return messages;` |
| D2-C53 | `app/lib/project/chat-run-view.ts` | 734 | `} else if (RECORDED_END_ACTIONS.has(action)) { settled = recordedEnd(action, row);` |
| D2-C54 | `app/components/pcb/PcbEditor.tsx` | 1688 | `restoredGrants: restoredExecutionGrants })` |
| D2-C55 | `app/page.tsx` | 6460 | `restoredExecutionGrants={() => restoredEntryGrants(liveStateRef.current.messages, (grantId) => executionEntriesRef.current.has(grantId))}` |
| D2-C56 | `app/lib/engineering/agent-execution-journal.ts` | 349 | `const entries = (loaded.document?.entries ?? []).filter((entry) => STATE_ORDER[entry.state] < 5).map((entry) => structuredClone(entry));` |
| D2-C57 | `app/page.tsx` | 3001 | `chat: toStoredChat(live.messages),` |
| D2-C58 | `app/lib/execution-grant/store.ts` | 123 | `const retired = transitionGrant(live.record.state, { type: "retire", retirement: { reason: "superseded_by_new_grant",` |
| D2-C59 | `app/lib/engineering/granted-executions.ts` | 725 | `async function stillAsRead(input: GrantedExecutionRecoveryInput, entry: AgentExecutionJournalEntry, results: GrantedExecutionRecoveryResult[]): Promise<boolean> {` |
| D2-C60 | `app/lib/engineering/granted-executions.ts` | 734 | `async function sweepWrite(input: GrantedExecutionRecoveryInput, entry: AgentExecutionJournalEntry, write: () => Promise<JournalWrite>,` |
| D2-C61 | `app/lib/engineering/granted-executions.ts` | 749 | `async function heldNow(input: GrantedExecutionRecoveryInput, entry: AgentExecutionJournalEntry, fresh: JournalLookup, why: string, pendingIfOpen = false)` |
| D2-C62 | `app/lib/engineering/granted-executions.ts` | 773 | `function projectKeptBy(pageProject: (() => string \| null) \| undefined): () => boolean {` |
| D2-C63 | `app/lib/engineering/granted-executions.ts` | 620 | `if (await sweepWrite(input, entry, () => input.journal.abandon(entry.identityKey, ` |
| D2-C64 | `app/lib/engineering/granted-executions.ts` | 645 | `so the ledger can neither prove nor disprove its commit; left pending", cause: "lineage-reopened" });` |
| D2-C65 | `app/lib/engineering/granted-executions.ts` | 590 | `const onProject = projectKeptBy(input.pageProject);` |
| D2-C66 | `app/lib/project/chat-run-view.ts` | 733 | `settled = { state: "landed_unverified", text: refusal.headline, tail: [row("next", CHECK_RECORDS_NEXT, "error"), row("recovery", sentence)] };` |
| D2-C67 | `app/lib/project/chat-run-view.ts` | 520 | `return entryStateOfLogMessage(message) === "landed_unverified" ? restoredLandedNext(message) : message;` |
| D2-C68 | `app/lib/project/chat-run-view.ts` | 803 | `function restoredLandedNext<M extends { id: string; entries: ReadonlyArray<{ id: string; text: string }> }>(message: M): M {` |
| D2-C69 | `app/lib/project/chat-run-view.ts` | 678 | `return result.action === "unavailable" && result.cause === "lineage-reopened" ? "lineage-reopened" : result.action;` |
| D2-C70 | `app/lib/project/execution-display.ts` | 238 | `"lineage-reopened": "Outcome not known — when the editor loaded this project, the board's canonical history had been reopened since this change was started,` |
| D2-C71 | `app/lib/project/execution-display.ts` | 238 | `"in-flight-elsewhere": "In progress in another tab — when the editor loaded this project, another open tab of this project was carrying this change forward` |
| D2-C72 | `app/page.tsx` | 6460 | `pageProject={() => projectRef.current?.id ?? null}` |
| D2-C73 | `app/components/pcb/PcbEditor.tsx` | 1688 | `pageProject, restoredGrants: restoredExecutionGrants })` |

## 29. B24-D2's CI record (the lead, in B24-D3's commit)

- [B24-D2 CI fix, 2026-10-10] CI run 38049453257 on `3773c6a` (page-browser-e2e, 21 min 46 s of 30; its headroom step 8 min 23 s):
  56 passed, 2 failed, 2 did not run. Every other job was green.
- `crash-recovery` (a) failed "it says not started": the reopened entry read "Interrupted" because the server HAD consumed the grant.
  The server log shows the tender (`POST /api/agent/execution-grant 200`) 105 ms before the reopened page's first request: the route
  handler that never answered did not hold the request past the page's close on CI's runner (no such request in (a)'s local server
  logs). The product answered truthfully; the spec's premise failed. Fixed in the spec, every assertion kept: the tender now goes to a
  local sink that accepts the connection and never answers (`sinkTender`, appended; the hold's line edited in place), so nothing a
  close releases reaches the server. Green alone (`d2ci-crash-1`, 2 of 2, no tender in (a)'s server log) and in the default
  configuration on B24-D3's tree.
- `multi-tab` case 2 failed: B's conflict notice was not visible within 30 s; no later assertion ran and the run kept no state the log
  shows. Not reproduced: green in every local run (alone, in the default configuration, and once with both pages' CPU throttled 4x,
  `d2ci-multitab-throttle4`, the spec restored byte-identical). Cause UNKNOWN; never called a flake. The expectation is unchanged; on
  its failure the spec now prints B's selection, focus, save status and texts, the stored copy's R3 and token, and the conflict
  record's R3 before rethrowing (`explainNoConflict`, appended), so CI's next failure says which cause held.
- A Playwright worker-process crash (0xC0000409, no assertion failed) ended `multi-tab` case 1 once more in B24-D3's final default
  run on this machine (the third in that case); the spec alone passed 3 of 3 after it (B24-D3's ledger entry).
- [B24-D4, 2026-10-10] CI run 38061798204 on `1fe719e` (B24-D3's tree; page-browser-e2e 27 min 40 s of 30, its headroom step
  2 min 20 s, `split_required` - B24-D4's split answers it, `ci-split.md` section 11): 64 passed, 2 failed, 2 did not run. Both
  failures are functional and B24-D4 fixes both, test-first; neither is called a flake.
- `multi-tab` case 2 failed again, and `explainNoConflict` printed the state: `xa` 50.5 mm (A's nudge, stored), the stored working
  copy's R3 at 51.0 mm with token `b24d2000-e2e0-4000-8000-000000002714`, no conflict record, B "Saved" with no notice, B's selection
  R3 (a footprint), focus on `body`; no server request was logged during the case. 51.0 = 50.0 + 2 x 0.5: B's board, derived from
  the copy B loaded before A's edit, replaced A's copy.
- The path, by reading and a unit reproduction. B's two arrow-key nudges are two serialized canonical commits
  (`select-move.ts:641`), and the working-copy autosave is debounced 600 ms (`PcbEditor.tsx:1113`); when B's second commit lands more
  than 600 ms after its first (CI's runner ran `agent-execution.spec.ts` 4.4 times slower than this machine), B saves its first nudge
  alone. That board is the very board A had stored (50.0 + 0.5), so `prepareWorkingCopyWrite` found no conflict ("the stored board is
  this board") and kept the stored copy's token - and B's save remembered A's token as B's own. B's second nudge was then judged
  untouched and replaced A's copy, with no record and no notice. Locally the two nudges fall in one 600 ms window: one save of
  51.0, refused, so every local run passed. **CONFIRMED** at the unit level: `b24-d2-working-copy` 9, red first on `1fe719e`
  (`d4r2-02-red-working-copy`: B's second save returned `true`). That this path held on CI's run is **INFERRED**: it fits every field
  of the line, and the log has no timing of B's saves.
- A second path the same module allowed, found by reading: the checkpoint-restore adoption in the editor's load effect, which runs
  after a board load (`PcbEditor.tsx:629`), took whatever copy was stored then for the tab's own, another tab's newer copy included.
  `b24-d2-working-copy` 10, red first on `1fe719e` (A's edit of the restored board returned `true` over B's copy).
- The fix, in place in `app/lib/pcb/board-persistence.ts` (no line added; every cited line keeps its anchor). When another tab wrote
  since and its board is this board but not the board this tab held, the save writes nothing, returns `true` (the board is stored)
  and the tab keeps the copy its board derives from as its base (`:189`, `:245`, `:255-256`), so its next edit is refused: the
  conflict record and the toast, as on a local run. The restore adoption takes only the copy page.tsx persisted, which carries no
  write token (`:262`). A tab's save is refused whenever another tab wrote the stored copy after the copy its board derives from, by
  either path. `b24-d2-working-copy` 1-10 green (`d4r2-03-green-working-copy`), with the project-state, sync-authority, activation
  and scenario-2 suites. The spec is unchanged; the browser proof is the lead's CI run (PROPOSED until then). [B24-D4 lead, 2026-10-10] That CI run is `page-browser-e2e-b24`'s: since OD-30's split (the lead's option (b)) that job runs `multi-tab` and `crash-recovery`, not page-browser-e2e (`ci-split.md` section 11).
- [B24-D4 review, 2026-10-10] The review round (three findings, each red first: `b24-d2-working-copy` 11-13 in
  `d4fix-01-red-working-copy`; case 9's whole-copy comparison red under a planted write of the skip, `d4fix-02-mutation-skip-writes`,
  the source restored by sha256). The previous bullet's last two claims are superseded. (1) The skip held a tab that loaded no copy
  out of every later save once another tab had saved its very board (two tabs hydrating one server board): such a tab now writes it
  under the copy's token and takes it for its own, as at `1fe719e` (`:255`, `known.boardJson !== null`; case 11). (2) The restore
  adoption told page.tsx's copy by its missing token, so another tab's unchanged rewrite of it (a "legacy:" token) made the restoring
  tab's edits refused, and another tab's own token-less restore was taken for the tab's own: it is now told by the board the editor
  hands it (`rememberStoredWorkingCopy(projectId, restoredBoard)`, `:261-262`; `PcbEditor.tsx:602`, `:629`, in place; cases 12, 13,
  7). What holds now: a tab's save is refused whenever another tab wrote the stored copy after the copy this tab's board derives from
  and the stored board is not this tab's board - by a load, a save or a restore. One exception, recorded open (INFERRED, low): a tab
  that loaded no copy, whose first save is an edit reproducing another tab's newer copy exactly, takes that copy for its own, as at
  `1fe719e` (the module cannot tell that edit from the tab's hydration autosave, which normally comes first). `b24-d2-working-copy`
  1-13 green (`d4fix-07-green-part1`, with the project-state, sync-authority, activation, scenario-2 and B18-C/D card suites).
- Paths ruled out by reading: a board load re-running `loadWorkingCopy` in B after A's write (it runs only in the load effect, after
  `client.loadBoard`, a network request, and none was logged during the case); `app/page.tsx:4093` (a checkpoint restore; none in the
  case); a whole-record writer re-writing a stale `pcbWorking` (`saveProject` and `trySaveProject` are reached only by create,
  duplicate, rename and import, and every writer re-reads the stored record in the same task); the deterministic uuid sequence shared
  through localStorage (`e2e/fixture-journey.ts:24-35`) minting B's remembered token again as A's (B's token was minted in case 1, A's
  in case 2, from one advancing sequence). Not ruled out: a delay in localStorage's propagation between the two tabs' renderers, so
  that B's read had not yet seen A's write - **INFERRED** unlikely (it would have to outlast the second or more between A's stored
  write and B's save); localStorage offers no compare-and-set across tabs, and OD-214 forbids a cross-tab channel. Recorded open.
- `keyboard-and-focus` case 4 failed at `:235` with focus on `body` after Escape (the entry did read cancelled): `accessibility.md`
  sections 4, 7 and 12 (D24-32).
