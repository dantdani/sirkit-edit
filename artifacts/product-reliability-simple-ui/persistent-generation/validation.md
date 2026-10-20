# Validation — section L increments 5-7, section M2 and M4, and the live run LR-3

[PR-L7, 2026-10-20] The actual commands, results and exit codes, copied from the builders' and integration runners' reports of each
commit (nothing here was re-run for this page). Labels: **fake-backed** = vitest over fake model / catalog ports and in-memory or PGlite
stores; **fixture browser** = Playwright on the real app under `SIRKIT_FIXTURE_RUNTIME=blinker` (scripted provider and agent, committed
catalog, no database, no network; provider calls in the server log are `missing_credentials` refusals made before any request);
**live** = the owner's real key and database. Every vitest run used `--maxWorkers=4` unless the row says otherwise, and ran with no other
vitest process. Machine load: another agent's TTS and video renders loaded this machine through the increment 6 runs (32-100 % CPU,
0.65-5 GB free RAM); every timing number below was measured under the load stated. A timing-only failure is listed with its numbers and
its green run alone; no functional failure was closed as a flake. Increments 0-4: `progress.md` rows and their commits.

## Increment 5

Chat on the durable generation task (`00d03430`, builders' checkpoint; combined-tree verification on `00d03430` with the one-line fix
`ada0b194`; review fixes `7bf0fa55`). Gates of the combined tree, increment 5 and M2 together:

| command | result | exit |
|---|---|---|
| `tasklist` / `netstat` precheck before every browser run | no node process, nothing on :3000 / :3100 / :3101 / :3200 | 1 (grep found nothing: the expected answer) |
| 30 generators `scripts/generate-*.ts`, pass 1 (b24-maps last) | 30/30 exit 0, no drift; b16-0-8 ratchet unchanged (3 entries) | 0 |
| `tsc --noEmit` (after deleting `.next/dev/types/validator.ts`), incremental / `--incremental false` | clean, 30 s / clean, 167 s | 0 |
| `eslint` over the 135 changed `.ts/.tsx/.mjs` files (`03d473f1..HEAD`) | 0 errors, 0 warnings | 0 |
| `scripts/scan-secrets.ts` tree / `--history 32b081e..HEAD` | 4549 entries, 0 hits, 11 allowlisted / 17 commits, 0 hits | 0 / 0 |
| prompt-to-gerber selection at vitest's default 13 workers | 338 files, 3644 tests: 15 failed, all "Test timed out" (12 files), plus 8 `onTaskUpdate` RPC timeouts | 1 |
| the 12 timed-out files alone (`run-alone.sh`) | all 12 green; numbers below | 0 |
| prompt-to-gerber selection | 338 files (332 passed, 6 skipped), 3644 tests (3608 passed, 36 skipped), 0 failed, 352 s | 0 |
| agent-boundary-suites selection | 177 files (175 passed, 2 live-gated skipped), 2221 tests (2203 passed), 256 s | 0 |
| database-delivery PGlite selection | 27 files (24 passed, 3 DB-opt-in skipped), 208 tests (196 passed), 124 s | 0 |
| `pnpm run benchmark:validate`; `stage-09-benchmark-core` | 63 packages, no diagnostics; 18 passed | 0 |
| `pnpm run stage10:test` | 112 files, 1285 passed, 47 s (the literal `--` defect of benchmark.yml found here, fixed in `7bf0fa55`) | 0 |
| the L / M suites no CI job ran (`component-resolution`, `generation-task`, `api/generation-tasks`, `l5-`, `l3-`, `l6-`, `acquisition`, `project`) | 86 files (85 passed, 1 live-gated skipped), 811 tests (809 passed), 126 s; the m2 PGlite suites ran | 0 |
| chunk api_components (31 filters), run 1 / run 2 | 86 files, 1371 tests, 0 failures but 1 `onTaskUpdate` RPC error / 85 passed, 1 skipped, 0 errors | 1 / 0 |
| chunks pcb / auth_llm_agent / domains | 116 files 858 passed; 73 files 730 passed; 80 files 898 passed | 0 |
| coverage: junit files against `git ls-files` | 962 of 962 test files ran at least once | 0 |
| Playwright `e2e/m2-acquire-missing-part.spec.ts` alone (fixture browser) | 1 passed (27.1 s) | 0 |
| Playwright full default config (fixture browser, all 17 specs) | 82 passed, 21.2 min | 0 |
| Playwright `-c playwright.orchestration.config.ts`, before the fix | 2 passed, 1 failed, 1 did not run: F12 waited for the old "Stopped by you — the assistant's run was cancelled." line that L.5 renamed (a real defect, not a flake) | 1 |
| the same, after `ada0b194` (spec text updated, dated note) | 4 passed (3.7 min) | 0 |
| Playwright B24 split (multi-tab, crash-recovery, keyboard-and-focus, minimum-width) | 13 passed (8.8 min) | 0 |
| final tree: `tsc --incremental false`; generators pass 2; tree scan; agent-boundary; prompt-to-gerber | clean 138 s; 30/30, only the fix changed; 0 hits; 177 files 0 failed (375 s); 338 files 0 failed (562 s) | 0 |

Timing-only failures at 13 workers (loaded -> alone, seconds; 5 s default unless stated): b16-1c tripwires 6.93 -> 1.22; b19-d
injection-route 6.34 -> 1.31; b20-b3 mcp reads 5.35 -> 1.18; b20-a4 observation 5.48 -> 1.55; b19-d kicad-export 5.22 -> 1.75; b19-d
kicad-hostile 7.83 -> 1.60; b19-e no-purchase 6.04 -> 0.70 and 5.72 -> 0.52; b23-b exchange-route 5.04 -> 1.21; b23-c order-contract
test 7 120.72 -> 18.86 (120 s limit), test 9 8.27 -> 0.03, test 12 8.36 -> 0.07; b23-c purchase-authorization test 7 124.70 -> 24.68
(120 s limit); b24-f generator-inventory 5.46 -> 0.93; b24-f verdict-lines 5.78 -> 0.99. The whole selection passed twice at 4 workers.

Review fixes (`7bf0fa55`, three adversarial reviews; each fix has a permanent test that is red without it): terminal acquisition tasks
refuse record-applied and Send for review before any governance write; the pin table attaches only to its own MPN; CAD egress keeps a
BOM, never reads 4xx/5xx bodies, honours a 429's Retry-After; agent-share and bundled-source meters enforced; the generic effects
dispatcher never claims the component-resolution slice topic; the fixture Build Library loads from the committed catalog (the routes
answered 500); the chat task's activity entry id survives reloads; the attach note matches the task state; the review report uses the
task's base recipe; `benchmark.yml`'s stage10 steps no longer pass a literal `--`. New suites: `m2-acquisitions-route`,
`pr-lm-fixture-catalog-routes`, `m2-acquisition-panels`. Its commit records the same combined gates green (962/962 files, 82/82 browser,
orchestration 4/4, B24 13/13, 30 generators without drift, secret scans).

Fake-backed / fixture browser only: increment 5's proofs (`l5-generation-task-tool`, `e2e/l5-chat-task.spec.ts`) use the scripted agent
and the scripted generation provider. No live chat start was made.

## M2

CAD acquisition to a reviewed library candidate (`00d03430`, `7bf0fa55`). Its gates are the combined run under Increment 5 (the m2 PGlite
suites ran there, not skipped; `e2e/m2-acquire-missing-part.spec.ts` passed alone and inside the full run). Its permanent suites:
`m2-1-schematic-acquisition-discovery`, `m2-2-cad-egress`, `m2-2-cad-source-registry`, `m2-3-acquisition-pipeline-pglite`,
`m2-3-cad-validation`, `m2-3-object-store`, `m2-4-handoff-boundaries`, `m2-5-resolution-after-acquisition-pglite`,
`m2-6-acquisition-refusals-pglite`, `m2-6-reuse-isolation-pglite`, `m2-acquisitions-route`, `m2-acquisition-panels`, and (with M4)
`m2-7-existing-board-acquired-binding`. Evidence class: the fixture CAD source's committed KiCad bytes through the production egress path,
and the bundled KiCad library at the pinned `90c39c38` (zero network). No live CAD source was contacted: `kicad-gitlab` is refused
whatever the environment (OD-M2-3); no manufacturer datasheet was fetched.

## Increment 6

Engine and fixture slices (`2240363a`), the board-impact work (`e03c532f`, under M4), the integration (`9a42c36b`, `0f1c446b`) and the
post-approval input bound (`2a0e3079`).

Engine builder (`2240363a`):

| command | result | exit |
|---|---|---|
| `tsc --noEmit -p tsconfig.json` (validator.ts deleted) | 0 errors (an earlier run showed only the board builder's in-progress errors) | 0 |
| `eslint` on the 43 changed or added files | 0 errors, 0 warnings | 0 |
| vitest `generation-task`, `schematic/__tests__`, `api/generation-tasks`, `l4-task-client`, `l5-generation-task-tool`, `l6-*`, `fixture-runtime`, b24 census / call-record / maps / principal limits / accessible names, `b16-1b-auth-composition`, `b17-a-control-inventory`, `pr-d-tool-manuals` | 48 files passed (incl. the PGlite and spawned-process suites) | 0 |
| `b21-a-import-gates`, `b23-a-route-vocabulary`, `b24-a3-embedding-admission`, `b24-a1-configuration` | passed | 0 |
| Playwright `e2e/l4-generation-task.spec.ts e2e/l5-chat-task.spec.ts` (fixture browser) | 7 passed (1.4 min) | 0 |

Fixture builder (`2240363a`):

| command | result | exit |
|---|---|---|
| vitest `l7-generation-catalog`, `l7-scripted-policy`, `l7-fixture-vertical-slice` | 3 files, 38 tests passed | 0 |
| vitest `fixture-runtime`, `api/generation-tasks`, `l5-generation-task-tool`, `pr-lm-fixture-catalog-routes`, `l6-search-stall-repro` | 9 files, 96 tests passed | 0 |
| vitest `component-resolution/__tests__` | 18 of 19 files, 153 of 154 tests: `m1-page-intake-fixture` case 11 `ReferenceError: sealed is not defined`, in a file the board builder was editing at that moment | 1 |
| the same file rerun | 12 passed | 0 |
| vitest `b24-c1-llm-call-record`, `b19-d-external-text-injection-route`, `b21-a-import-gates`, `b24-d4-browser-split`, `b24-a3-principal-limits` | 5 files, 67 tests (closure pins unchanged) | 0 |
| vitest, the 21 other suites that read the fixture catalog | 21 files, 310 tests | 0 |
| `tsc` first / final | 3 errors, all in the board builder's in-progress files / clean | 2 / 0 |
| `eslint` on the 9 changed or new files | clean | 0 |
| Playwright `l7-drone-vertical-slice` + `l7-second-circuit` (fixture browser) | 3 passed, 1.3 min: drone 43.5 s (the owner's sentence verbatim, 202, b1-b4 saved, the assumptions list, review, Approve, reload 41/41 instances with a published revision, Missing parts 0, binding review, sync and apply to awaiting qualification, Request release disabled, 0 qualify, 0 build-multi, 0 off-origin requests); dimmer 20.6 s (14 instances); blinker 6.9 s | 0 |
| Playwright prompt-to-gerber, l4, l5, pr-g-agent-generation, journey-contract, simple-workspace, m1, m2 | 14 passed (3.3 min); the 12 rewritten evidence PNGs restored | 0 |

Measured by the fixture builder (fake-backed): four-motor 41 instances, 9 model calls, cache hits > 0, shared-net findings [] over 10
checked nets, ERC passed with 0 critical and 2 warnings (ADC6 / ADC7); LED dimmer 14 instances, 3 calls.

Integration, first gate run (`9a42c36b`'s tree before its fixes):

| command | result | exit |
|---|---|---|
| prompt-to-gerber selection (261 positional filters, 58 excludes) | 340 files, 3676 tests, 12 failed + 1 RPC error: 5 functional, fixed (`b24-d0-ci-split` 1 and 7, `b24-d1-threshold-census` 5 and 6, `b24-d4-browser-split` 8), 7 timeouts | 1 |
| the same on the fixed tree | 3639 passed, 1 failed: `b19-d-external-text-injection-route` [B20 A4] chat closure, 5 s timeout at 7.67 s, + 1 RPC error | 1 |
| agent-boundary-suites selection | 177 files, 2221 tests: 4 failed, all timing (b11-4 G9/G11 5.97 s; b16-0-2 AST gate 5.51 s; b20-a2 schema bomb 10025 ms against 5000 ms; b20-a2 500 tools 5095 ms against 4000 ms), + 13 RPC errors | 1 |
| each timing-failed suite alone (10 suites) | all green; numbers below | 0 |
| `b19-d-external-text-injection-route` alone, 5 repetitions | red alone 4 times (5.76, 5.37, 5.13, 5.18 s), then green at 4.82 s; the import closure unchanged (375 files at `8b76793f` and HEAD) | 0 |
| database-delivery selection | 27 files: 196 passed, 12 skipped | 0 |
| `scripts/benchmark.ts validate`; `stage-09-benchmark-core` | 63 packages, 0 diagnostics; 18 passed | 0 |
| `pnpm run stage10:test` first / after regenerating the stale coverage CSV | 1286 tests, 1 failed (the `pr-d-coverage-matrix` drift gate) / 1286 passed | 1 / 0 |
| the L / M suites in no CI job | 59 files, 468 passed | 0 |
| chunks api_components / pcb / auth_llm_agent / domains | 1350 passed (exit 1 from 1 RPC error) / 856 passed, 2 failed: 60 s timeouts b15-2-1 62.95 s, b15-2-2 69.58 s (alone 46.15 s, 41.44 s) / 566 passed (1 RPC error) / 877 passed | 1 / 1 / 1 / 0 |
| `ran.py` coverage; `scripts/netlist-validation.test.ts` | 988 of 988 tracked vitest files ran; ALL PASS | 0 |
| `tsc --noEmit --incremental false` | clean (216 s) | 0 |
| `eslint` on 80 changed files | clean | 0 |
| 30 generators, passes 1-3 | 30/30; `threshold-census.csv` and `ui-agent-command-coverage.csv` stale and kept regenerated; pass 2 = pass 1 (fixpoint); pass 3 no drift | 0 |
| `scan-secrets.ts` tree, first / final | 1 hit: `l6-plan-assumptions.test.ts:76` openai-key-shape (a placeholder) / 4608 entries, 0 hits | 1 / 0 |
| `scan-secrets.ts --history 32b081e..HEAD` | the same line at `2240363a`; closed by the history-only allowlist entry of `0f1c446b` (compared with the configured key by value, never printed: not equal) | 1 |
| Playwright default config, `SIRKIT_E2E_SKIP` = the four B24 specs (fixture browser) | 73 passed, 22.7 min wall | 0 |
| Playwright orchestration config | 4 passed (4.2 min) | 0 |
| Playwright B24 split, run 1 | 1 passed, 4 failed, 8 did not run: `ERR_CONNECTION_REFUSED` — the generation worker exited `0xC0000409` right after "pump 1: the request failed (TypeError)" at the first `POST /api/chat` compile, then next exited 1 | 1 |
| Playwright B24 split, run 2 | 13 passed (11.6 min) | 0 |
| semantic-editor investigations (instrumented copy x4 with 10 CPU burners; the board builder's failing set with 16 burners; HMR-instrumented x2) | 20 passed; 10 passed; 10 passed — scenario 3 not reproduced | 0 |

Timing-only failures, loaded -> alone (seconds): b16-1c census 8.57 -> 2.81; b19-d closure 7.80 -> 2.82; b20-b3 reads 5.71 -> 2.70;
b20-a4 budget 5.49 -> 3.61; b19-d-kicad-hostile 200k pins 7.70 -> 2.17; b23-b census 6.87 -> 3.21; b24-f-verdict-lines 8 5.58 -> 0.81;
b11-4 5.97 -> 1.94; b16-0-2 5.51 -> 2.44; b20-a2 10.14 -> 1.05 and 5.11 -> 2.00.

Integration fix pass (`9a42c36b`: SPEND-1, SPEND-2, the input dimension across slices, engine F1/F3/F5-F9, BI-1, BI-2, FX-1/FX-2 and
four test-integrity items; each fix red without it, by a scratch revert):

| command | result | exit |
|---|---|---|
| the 13 new suites + every affected suite outside CI (`component-resolution`, `generation-task`, `api/generation-tasks`, `l5-`, `l6-`, `l3-`, `l7-`, `workflow`, `m4-`, `api/parts`, `llm`, `api/schematic`, `components/schematic`) | 90 files, 639 passed, 0 failed (PGlite included); exit 1 only from 1 RPC error | 1 |
| prompt-to-gerber selection | 340 files: 3640 passed, 36 skipped, 0 failed (484 s) | 0 |
| agent-boundary-suites selection | 177 files: 2203 passed, 18 skipped, 0 failed; exit 1 only from 1 RPC error | 1 |
| database-delivery selection | 195 passed, 1 failed: `b16-b-migrations` "dry run plans without applying", 5 s timeout at 5.40 s (another process held ~66 % CPU); alone 5.45 s red, then 4.33 s green, 15/15 | 1 |
| stage10; stage-09; benchmark validate; netlist-validation | 1286 passed; 18 passed; 63 packages 0 diagnostics; ALL PASS | 0 |
| chunks api_components / auth_llm_agent / domains / pcb | 1351 / 574 / 874 / 855 passed with 1 / 2 / 3 / 3 failed — all 9 timeouts, no assertion: b16-1c census 6.76 s, b16-0-2 AST 5.62 s, b16-0-8 ratchet 5.74 s, auto-place 5.96 s (5 s); b14-2 15b 78.8 s, b14-3 17 70.1 s, b14-5 6 68.8 s, b15-2-1 86.4 s, b15-2-2 87.9 s (60 s) | 1 |
| those 10 alone | all green: 4.11, 3.19, 4.31, 3.79, 4.33 (b16-b dry run), 51.2, 48.5, 35.2, 34.1, 38.7 s | 0 |
| `ran.py` | 1001 of 1001 vitest files ran (988 tracked, 13 new) | 0 |
| `tsc --incremental false`; `eslint` on 42 files | clean (150 s); clean | 0 |
| 30 generators passes 1 and 2 | `threshold-census.csv` gained the new hang-guard rows (kept); pass 2 byte-identical | 0 |
| `refresh-citations.py` on the 5 pages citing touched files | 0 rows re-pointed (the 13 stale rows it found in `ai-control-plane-b20/mcp-server-proposals.md` are pre-existing; the page was restored to HEAD) | 0 |
| tree secret scan; CR / final-LF byte check | 4621 entries, 0 hits; 0 CR bytes | 0 |
| Playwright set1 (prompt-to-gerber, l4, l5, l7 x2, m1, m4, m2, journey-contract, pr-f, pr-g, simple-workspace, semantic-editor) `--workers=1` | 24 passed (7.2 min); 10 provider refusals in the server log, all `missing_credentials`; the 21 rewritten PNGs restored | 0 |
| semantic-editor: 6 separate fresh-server runs on a quiet machine (CPU 2-4 %) | 30/30; scenario 3 took 2.0-2.4 s | 0 |
| semantic-editor `--repeat-each=10` in one server | iteration 1 passed 5/5; 2-10 failed in `beforeAll` (the serial spec bootstraps its project once per server: not a valid repetition, not the scenario-3 race) | 1 |
| quiet machine: `b16-1b-auth-composition` and `b19-d-external-text-injection-route` alone, 3 runs each | route census (177 methods) 0.86, 0.84, 0.85 s against 5 s; chat closure 3.01, 3.52, 3.66 s against 5 s | 0 |

Post-approval input bound (`2a0e3079`; SPEND-3 and its attack review A1-A4):

| command | result | exit |
|---|---|---|
| vitest `l6-request-input-bound`, `l6-post-apply-admission`, `l6-post-approval-retries`, `b16-0-10-tranche-parity`, `l6-input-bound`, `l3-input-allowance`, `l6-input-concurrency`, `l6-sdk-retries`, b24-a1 flags / configuration, b24-a2 env names, b24-c1 call record, b19-d injection route, b24-c2 attribution | 14 files, 191 tests | 0 |
| the 51 suites that read `app/page.tsx` | 50/51: `b21-e3-resume-offer` case 4 expected one `lastAiRetryRef.current = null;` line; pin moved in place with a dated note; rerun 7/7 | 1 / 0 |
| `pr-d-coverage-matrix`; `generate-b24-threshold-census.ts` + b24-d1 / d4 / f-generator-inventory / d1-latency-policy | 13 passed (no drift); census +1 budget row, 31 passed | 0 |
| `app/lib/qualification/__tests__`; stage10; generation-task + llm + api/schematic + api/generation-tasks + api | 559 passed, 15 skipped; 1286 passed; 70 files, 1321 tests | 0 |
| attack-review fixes, each reverted in a scratch copy | red as expected (A1 4, A4 3, A3 4, A2 1 failed); restored byte-identical; with the fixes 28 tests passed | 0 |
| after the fixes: 19 files (+ router, b21-a import gates, b21-e1 provider policy, b20-a5 tripwires, fixture-runtime); 52 page-reading suites; qualification; stage10; 70 files; orchestration + fixture-runtime + observability | 232; 678; 559; 1286; 1327; 508 tests passed | 0 |
| `tsc`; `eslint` (18 files); census regeneration | clean; clean; byte-identical | 0 |
| Playwright simple-workspace, journey-contract, prompt-to-gerber, l7-drone (fixture browser), twice | 4 passed (1.9 min) each time; layout-critic and review answered 503 `missing_credentials` after admission (no 413); rewritten PNGs restored | 0 |

Recorded bounds (fake-backed, the fixture drone's laid-out state through the real routes, gpt-5.6-sol, image at "high"): Tidy 64,090
input tokens, Review 26,367; both under the 200,000 default and LR-3's 100,000 ceiling.

## M4

Board impact before approving a replacement on a project with a durable PCB (`e03c532f`; BI-1 and BI-2 in `9a42c36b`):

| command | result | exit |
|---|---|---|
| `tsc --noEmit -p tsconfig.json` (validator.ts deleted), final tree | clean | 0 |
| `eslint` on the 27 changed or new files | clean (the Babel size note for page.tsx only) | 0 |
| vitest `component-resolution` m1 / m2 / m4, `pcb-sync`, `api/pcb-sync`, `workflow`, `components/pcb`, b12-4 / b12-5 journal, b17-a control inventory, b23-b panel, `project`, b07-*, `components/schematic` | 114 files, 945 passed, 2 skipped (pre-existing `databaseQualification` runIf) | 0 |
| the 69 page.tsx-reading suites + b21-e4-page + b24-d2-* | 55 passed, 1 skipped, 1 failed by timeout only: `b16-1b-auth-composition` route census 6.3 s against 5 s while another agent's TTS job loaded the CPU | 1 |
| `b16-1b-auth-composition` rerun after the load | 17/17 (177 route methods unchanged) | 0 |
| Playwright m4, m1 (x2), prompt-to-gerber, journey-contract, semantic-editor (fixture browser) | all passed except semantic-editor scenario 3 (the workspace tab read "schematic" at its first unpolled assertion) | 1 |
| semantic-editor repeat runs on the final tree, and one HEAD-runtime control | failed once more under load, then 4 consecutive passes (one with the spec unmodified, 5/5); HEAD runtime 5/5 | 0 |

The four defects M4 found and fixed are in `../component-resolution/m4-board-impact.md`. The mandatory domain guard
(`m4-schematic-drift` 6 and 7: zero drift right after a real-service sync) passed. Evidence class: fixture browser on an UNROUTED board
and the durable stack in vitest; no live board.

## LR-3

The one bounded live four-motor run (live; OD-252 item 10, OD-253 item 7). Reservation `3337f3f3`, result `deaf15ca`, both in
`../live-spend.json`.

| step | result |
|---|---|
| reservation before any paid call | 3.83 USD provable worst case: task input <= 450,000 x 4/M = 1.80; task output <= 57,344 x 20/M = 1.1469 (both planner attempts inside the unit); post-approval passes <= 2 x 100,000 x 4/M + (1,536 + 2,048) x 20/M = 0.8717; embeddings <= 0.01 (INFERRED, generous); remaining provable after it 0.9772 USD |
| launch (server :3005, worktree at `2a0e3079`; worker `--no-env-file --concurrency 1 --scope local/<project>/main`) | `SIRKIT_OPENAI_MODEL=gpt-5.6-sol`, `SIRKIT_BUILD_ITERATION_CAP=4`, reranker key empty, vendor keys absent, `SIRKIT_DB_POOL_MAX=5`; allowance unit 24 calls / 57,344 output / 450,000 input / 120 searches / 6 h; `SIRKIT_POST_APPLY_INPUT_TOKENS=100000`; SDK retries 0 on every metered call |
| `POST /api/generation-tasks` | 202 (1.2 s), before any design work; the event stream followed the task (server-sent, 2-minute windows) |
| plan slice (s1) | planned 3 blocks; assumptions and requested coverage on the card |
| block b3 "Four brushed-motor drivers" (s4) | SAVED |
| blocks b2, b1 (s3, s2) | each 4 turns under S1, yielded at the slice allowance, continued in the next slice |
| b2 (s5) | `insufficient_quota` -> blocked `provider_quota` |
| b1 (s6) | `rate_limit` -> waiting for the provider, retry scheduled 2026-10-20T01:49:36Z |
| stop | the builder stopped worker and server with no slice in flight; the task stays durable |
| spend, CONFIRMED from the call records | 15 completed gpt-5.6-sol calls, 219,005 input / 14,629 output tokens; 1 refused call, 0 tokens; 69 embedding calls, 1,470 tokens; 1.1686 -> 1.17 USD; no post-approval pass ran |

Screenshots (live, the page on :3005): `screenshots/lr3-card-plan-assumptions.jpg` (the card: three blocks, b3 designing, the plan's
assumptions and requested coverage, Stop design) and `screenshots/lr3-card-provider-quota.jpg` (b3 saved, b2 blocked, the same card).

## CI admission and split (increment 7)

Written from the CI builder's run at deaf15ca + its uncommitted changes (OD-254; `artifacts/ai-control-plane-b24/ci-split.md` sections 0-4
and 11.11 hold the full record). Local, deterministic, `--maxWorkers=4` unless stated; CI minutes INFERRED until PR #16's next run.

| step | result | exit |
|---|---|---|
| admission: test files in no CI job (git ls-files + the new pump test) | 388 of 1,003 before, 307 of 1,004 after; L/M suites in no job 81 -> 0 (13 PGlite suites to database-delivery, 69 exact-path entries to prompt-to-gerber, m1-boundaries and l7-fixture-vertical-slice moved on to agent-boundary-suites by weight) | — |
| the ONE re-measurement (prompt-to-gerber's 330 positional entries, two workers, junit -> `evidence/d0-ptg-timing.xml`) | 585 files (577 passed, 8 skipped), 6,452 tests (6,398 passed, 54 skipped), 0 failures; moved share 502.64 s = 43.9 % (41.2 % without the two weight moves); OD-30's 40 % line holds | 0 |
| CI selections as the workflow lists them | prompt-to-gerber 407 files / 4,197 passed / 0 failed; agent-boundary-suites 179 files / 2,213 passed; database-delivery 40 files / 270 passed | 0 |
| INFERRED CI minutes at ratio 1.079 | prompt-to-gerber about 11 min 34 s of 25; agent-boundary-suites about 9 min 03 s of 20 | — |
| browser split (PR #16 at 0f1c446b: page-browser-e2e cancelled at its 30-minute timeout after 73/73 passed in 28.1 min) | `e2e/agent-execution.spec.ts` moved to a new job `page-browser-e2e-agent` (30 min, the B24-D1 start and headroom steps); on 0f1c446b's slow-runner figures page-browser-e2e about 14 min 28 s and page-browser-e2e-agent about 19 min 45 s, both inside OD-30's five minutes of headroom (INFERRED) | — |
| pump idle backoff + fixture hold (`pump-transport.ts`, `l7-pump-idle-backoff` 7 cases) | before: 117 pump posts of 556 requests over four task specs (2.2 min); backoff alone slowed pickup (l5 case 1 8.8 s -> 20.6 s), so the fixture server holds an idle request and a durable commit wakes it; final: l4 43.7 s, l5 25.0 s, l7-drone 29.9 s, m2 12.1 s (2.0 min), agent-execution 48 pump posts in 328 s (was one per second) | 0 |
| workflow-reading suites (33 files) and the pump / route suites | 332 passed, 3 skipped; 60 passed | 0 |
| tsc, eslint (18 files), 32 generators twice (zero drift; `gen-demo-fixtures` writes CRLF on Windows - restored), secret scan tree mode | clean | 0 |
