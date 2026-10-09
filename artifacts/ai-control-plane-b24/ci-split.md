# B24-D0 - The OD-30 split of prompt-to-gerber: the measurement, the lead's decision, the split

Increment B24-D0 of chapter B24 on `chapter/b24-production-qualification`: the lead's corrective increment under OD-30. It closes no
defect. The first run (base `ba4f562`, B24-C3 committed) measured and STOPPED; the second run (base `aaa6a1b`, the lead's C3 fix on
top) applied the lead's decision and split the job by insertions only. Labels: **CONFIRMED** (executed here, or read at the cited
line), **INFERRED**, **PROPOSED**, **RECORDED** (taken from a record), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Every workflow
line below is this tree's unless it says otherwise; sections 1 to 3 are the first run's record, kept whole (the line numbers inside
them are `ba4f562`'s, as they were read).

## 0. What B24-D0 is: the measurement, the lead's decision, the split

- **Why.** CI's `prompt-to-gerber` job (`timeout-minutes: 25`, C1) measured 19 min 58 s at B24-C1's run (37872711743), 20 min 37 s
  at B24-C2's (37889413102) and 21 min 33 s at B24-C3's (37905772899); the runner varies by up to seven minutes between runs
  (12 min 38 s at B24-B3's). OD-30's rule, "split it if a run comes within five minutes of the limit" (C26), is crossed, and the
  owner forbids raising any `timeout-minutes`. **RECORDED** (the lead's readings, task-D0 and OD-30's C2 lead line, C27).
- **What the task asked.** An insertion-only split: `--exclude` lines before prompt-to-gerber's `--reporter` line, one per moved item,
  and a job `agent-boundary-suites` appended at the end of the workflow running exactly those items; the moved set "the heaviest files
  and directory filters that together take at least 40 % of the measured total", database-free, the e2e replay chain staying.
- **The first run measured and stopped.** It ran prompt-to-gerber's own selection locally, once, exactly as the workflow lists it
  (section 1), and derived what holds each heavy entry (section 2). The entries that carry 77.6 % of the measured time are the five
  chapter directory filters, whose suites the golden catalog and the scenario map record as production data (`ciJobs`), and every
  entry no production record holds adds up to 22.5 %: the task's 40 % and its "no production source change" rule could not both
  hold, so the first run edited no workflow line and recorded the candidate sets (section 3) for the lead. **CONFIRMED** by execution.
- **The lead's decision (2026-10-09).** The lead chose **option 2** of section 3: B24-B2's 25 unlinked named suites, the 11 unheld
  files of 2 s or more, PLUS the `app/lib/mcp` and `app/lib/computation/__tests__` directory filters - 38 items, 109 files, 398.84 s
  of the 931.21 s measured (42.8 %) - and relaxed the "no production source change" rule exactly to the two catalog modules
  (`golden-catalog.ts`, `scenario-map.ts`) recording the move, both generators re-run twice with zero drift. Option 1 (16 min 56 s
  expected) was not enough margin against a seven-minute runner variance once C3's run read 21 min 33 s (headroom 3 min 27 s).
  **RECORDED** (task-D0, "The lead's decision after the measurement"; recorded by the lead under OD-30, no new OD number).
- **What D0 did (the split).** By insertions only - no existing workflow line removed, reordered or edited: 38 `--exclude '<pattern>'`
  lines inserted before prompt-to-gerber's `--reporter` line (`deterministic-manufacturing.yml:293-330`, C8-C11; the `--reporter`
  line is now `:331`, C2) and the job `agent-boundary-suites` appended at the end (`:551-616`: one blank line, three comment lines,
  the job at `:555`, C12-C14) with `timeout-minutes: 20`, prompt-to-gerber's checkout, pnpm, node and install steps verbatim, one
  folded vitest step listing exactly the 38 items in prompt-to-gerber's order with the reporter line last, and an `if: always()`
  diagnostics upload; no environment variable, no secret, no database, no browser. The helper `_ci-admission.ts` reads the
  exclusions (C16, C17), the B19-E guard admits every suite by exactly one job (C15), the two catalog modules record the move
  (C18-C21), and every pin and page citation the insertions moved was moved in place with a dated note (section 5). **CONFIRMED**
  (by the suite `b24-d0-ci-split`, section 6). The review round ([B24-D0 review, 2026-10-09], section 6) closed its ten confirmed
  findings (seven distinct) in-tree, each red first in the suite's case 12: the guard's helpers moved to the end of its file and the
  guard citations re-pinned, the gates recorded with no placeholder, the superseded B24-B2 statements and the C1-C3 README-row
  drafts noted, A2's case (c) retitled, the evidence's hostname recorded, the merge gate drafted for the lead.
- **What the split is expected to do.** At CI's ratio 1.328 (20 min 37 s over the local total), prompt-to-gerber about 11 min 47 s of
  25 and agent-boundary-suites about 8 min 50 s of 20 (section 4) - **INFERRED** until the first CI run after the push, which the
  lead reads for all three jobs. No `timeout-minutes` changed.
- **What stands.** Census 168 = 165 canonical + 3 factories + 0 raw, the tool counts 47 / 36 / 9 / 27, 107 action records, 32
  migrations, the six SDK importers: unchanged, each re-measured by its own pin inside the first run's measurement at `ba4f562` and
  again by the pins among this run's gates (section 6); `aaa6a1b` differs from `ba4f562` in one test file and the ledger only
  (`git diff --stat`). Production simulation authority stays BLOCKED (B22); no provider is admitted and ordering stays disabled
  (B23). No production source changed but the two catalog modules the lead named; no `next build`, `next start` or `next dev`; no
  browser run; nothing live.

## 1. The measurement

One local run of prompt-to-gerber's own vitest selection, read from the step's folded scalar (first entry after `pnpm exec vitest run`
to the line before `--reporter`, `deterministic-manufacturing.yml:52-292`; the line `app/api/pcb/qualify app/api/pcb/release` splits as
the shell splits it): 242 entries, 21 of them directory filters. Through the lead's runner (two workers, the global lock), with
`--reporter=dot --reporter=junit --outputFile=...` (the dot reporter added beside the junit one the task named, so the log carries
vitest's own summary as CI's does): started 04:48:26, ended 04:59:41 local on 2026-10-09; vitest `Duration 670.97s (transform 23.11s,
setup 716ms, collect 270.53s, tests 935.30s, environment 21.77s, prepare 38.39s)`; `Test Files 466 passed | 5 skipped (471)`, `Tests 5388
passed | 42 skipped (5430)`, exit 0; the lock's cleanup reported 0 processes left. Log `b24/logs/d0-ptg-timing.log`. The junit file is
committed as `artifacts/ai-control-plane-b24/evidence/d0-ptg-timing.xml` (2,091,656 bytes, LF, no control byte) so `b24-d0-ci-split`
reads it. The five skipped files are the opt-in live suites (OD-222), which skip whole without their flags. **CONFIRMED** by execution.

The selection is the job's: the xml's 471 files are exactly the files the 242 positional entries select on this tree by B19-E's rule
(a path that contains the entry), `b24-d0-ci-split` 1 (the suite itself, which joined the `app/lib/qualification/__tests__` filter
after the run, is the one file set aside). The positional entries are unchanged by the split (the 38 `--exclude` lines follow them).

Totals: **931.21 s** of testcase time over 471 files (5430 tests, 0 failures, 0 errors, 42 skipped); vitest's per-file `testsuite`
time, collect and setup included, sums to 935.30 s and is not the figure the tables rank by. Every figure below is the summed
`testcase` time of a file, to the hundredth (`b24-d0-ci-split` 2 re-derives each from the xml in document order).

The top 25 files, with the entry that selects each (the first in prompt-to-gerber's order):

| rank | file | testcase time (s) | selected by |
|---|---|---|---|
| 1 | `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts` | 37.70 | `app/lib/mcp` |
| 2 | `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | 33.50 | `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` |
| 3 | `app/lib/qualification/__tests__/b24-a3-principal-limits.test.ts` | 29.95 | `app/lib/qualification/__tests__` |
| 4 | `app/lib/manufacturing-providers/__tests__/b23-c-purchase-authorization.test.ts` | 29.78 | `app/lib/manufacturing-providers/__tests__` |
| 5 | `app/lib/project/__tests__/b18-b-import-gates.test.ts` | 29.52 | `app/lib/project/__tests__/b18-b-import-gates.test.ts` |
| 6 | `app/lib/manufacturing-providers/__tests__/b23-c-order-contract.test.ts` | 29.26 | `app/lib/manufacturing-providers/__tests__` |
| 7 | `app/lib/mcp/__tests__/b20-a5-connector-tripwires.test.ts` | 29.16 | `app/lib/mcp` |
| 8 | `app/lib/manufacturing-providers/__tests__/b23-a-route-vocabulary.test.ts` | 28.03 | `app/lib/manufacturing-providers/__tests__` |
| 9 | `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | 27.43 | `app/lib/auth/__tests__/b16-0-2-gates.test.ts` |
| 10 | `app/lib/computation/__tests__/b22-b-no-generic-exec.test.ts` | 27.22 | `app/lib/computation/__tests__` |
| 11 | `app/lib/qualification/__tests__/b24-c1-llm-call-record.test.ts` | 26.97 | `app/lib/qualification/__tests__` |
| 12 | `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 26.39 | `app/lib/agent/orchestration/__tests__` |
| 13 | `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | 24.90 | `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` |
| 14 | `app/lib/manufacturing-providers/__tests__/b23-a-no-order-structural.test.ts` | 23.63 | `app/lib/manufacturing-providers/__tests__` |
| 15 | `app/lib/manufacturing-providers/__tests__/b23-d-physical-evidence-contract.test.ts` | 23.00 | `app/lib/manufacturing-providers/__tests__` |
| 16 | `app/lib/mcp/server/__tests__/b20-b3-import-gates.test.ts` | 21.99 | `app/lib/mcp` |
| 17 | `app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts` | 21.37 | `app/lib/mcp` |
| 18 | `app/lib/engineering/__tests__/b18-e-scenario-7.test.ts` | 20.92 | `app/lib/engineering/__tests__/b18-e-scenario-7.test.ts` |
| 19 | `app/lib/qualification/__tests__/b24-c3-recorded-limits.test.ts` | 20.39 | `app/lib/qualification/__tests__` |
| 20 | `app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts` | 20.28 | `app/lib/mcp` |
| 21 | `app/lib/mcp/__tests__/b20-a3-secret-hygiene.test.ts` | 20.11 | `app/lib/mcp` |
| 22 | `app/lib/manufacturing-providers/__tests__/b23-b-egress-import-gate.test.ts` | 19.76 | `app/lib/manufacturing-providers/__tests__` |
| 23 | `app/lib/manufacturing-providers/__tests__/b23-d-latent-claim-paths.test.ts` | 19.44 | `app/lib/manufacturing-providers/__tests__` |
| 24 | `app/lib/qualification/__tests__/b24-c3-trace-read.test.ts` | 18.34 | `app/lib/qualification/__tests__` |
| 25 | `app/lib/qualification/__tests__/b24-c2-retention.test.ts` | 15.20 | `app/lib/qualification/__tests__` |

Every directory filter, in prompt-to-gerber's order, with its files, its summed testcase time, its share of the total and its class
(section 2):

| directory filter | files | testcase time (s) | share | class |
|---|---|---|---|---|
| `app/lib/workflow/prompt-to-gerber/__tests__` | 5 | 5.36 | 0.6 % | production-data |
| `app/api/pcb/qualify` | 1 | 0.01 | 0.0 % | production-data |
| `app/api/pcb/release` | 2 | 0.03 | 0.0 % | production-data |
| `app/api/pcb-sync/__tests__` | 3 | 0.29 | 0.0 % | free |
| `app/lib/pcb/fab/__tests__` | 7 | 0.15 | 0.0 % | free |
| `app/lib/pcb-sync/__tests__` | 7 | 1.66 | 0.2 % | free |
| `app/api/physical-bindings/__tests__` | 2 | 0.18 | 0.0 % | free |
| `app/lib/fixture-runtime` | 2 | 0.38 | 0.0 % | free |
| `app/components/view-session` | 1 | 0.06 | 0.0 % | free |
| `app/lib/pcb/candidates` | 1 | 0.15 | 0.0 % | production-data |
| `app/lib/view-session` | 5 | 0.30 | 0.0 % | production-data |
| `app/lib/net` | 3 | 0.72 | 0.1 % | free |
| `app/lib/schgen` | 1 | 0.18 | 0.0 % | free |
| `app/lib/acquisition` | 15 | 15.90 | 1.7 % | production-data |
| `app/lib/mcp` | 45 | 181.28 | 19.5 % | production-data |
| `app/lib/agent/orchestration/__tests__` | 49 | 66.20 | 7.1 % | production-data |
| `app/api/mcp/__tests__` | 7 | 3.24 | 0.3 % | production-data |
| `app/lib/computation/__tests__` | 28 | 51.02 | 5.5 % | production-data |
| `app/lib/manufacturing-providers/__tests__` | 29 | 222.19 | 23.9 % | production-data |
| `app/lib/qualification/__tests__` | 33 | 135.70 | 14.6 % | production-data |
| `app/lib/footprint-resolver/__tests__` | 5 | 0.36 | 0.0 % | production-data |

The 221 explicit file entries carry the rest (`b24/d0/ptg-summary.json` in the scratchpad holds every entry's figures; the page keeps
the ones a decision needs, in section 2). The 21 directory filters together: 685.37 s, 73.6 %; the five chapter filters alone:
656.40 s, 70.5 %. **CONFIRMED** (derived from the xml).

## 2. What holds each heavy entry, and the ceiling

An entry can move only where nothing records it as prompt-to-gerber's. Three classes, each derived from the tree by
`b24-d0-ci-split` 3 (never asserted by hand):

- **production data**: a file the entry selects is a golden-catalog link (`eval-catalog.json`, 99 paths) or scenario-map evidence
  (`scenario-map.json`, 54 paths). Each records the file's `ciJobs`, checked against the helper's derivation by
  `b24-b1-catalog` 4, `b24-b2-ci-admission` 1 and `b24-b3-scenario-map` 3. A move needs `golden-catalog.ts` and
  `scenario-map.ts` edited (the rows, `CATALOG_CI_JOBS` and `PULL_REQUEST_CI_JOBS`, since the new job runs on pull requests), both
  generators re-run, and the three pins moved by review.
- **test or page pins only**: no production record, but a file the entry selects is in the live registry (`live-suites.ts`, C30:
  `b24-b3-live-suite-honesty` needs any job), a workflow citation anchor a page checks once on its line (B21's C31-C34, C39, C50, C51,
  C55, C60, C115 in `evaluation-matrix.md` and `orchestration-contracts.md`), in B19-E's explicit prompt-to-gerber list ([B19-E E3],
  [B20 A4], [SEC-1]), in B24-B2's named list (`b24-b2-ci-admission` 3 and 4, "exactly one prompt-to-gerber filter"), a B20 suite
  under the mcp filters ([B20 A0]) or a B21 suite ([B21 A]); or the entry is a filter a suite pins as prompt-to-gerber's
  (the e2e chain, A1's and B23's filter lines once each, the mcp, orchestration and acquisition filters). A move needs reviewed
  pin moves in test files and pages only.
- **held by nothing**: free to move with no pin moved.

The totals (per-entry sums; the one file two entries select, `qualify-human-only` under `app/api/pcb/qualify` and its own line, counts
in each, 0.01 s): production data: 57 entries, **722.16 s** (77.6 %); test or page pins only: 37 entries, **100.08 s** (10.7 %);
held by nothing: 148 entries, **108.98 s** (11.7 %); the ceiling without a production-data edit is **209.06 s** (22.5 %). The
task's target, at least 40 % (372.48 s), is 163 s above that ceiling. **CONFIRMED** (derived).

Every entry of 5 s or more, with what holds it (the labels are the suite's: catalog, scenario-map, live-registry, citation-anchor,
guard-explicit = B19-E's named files, b24-b2-named, guard-b20, guard-b21, pinned-filter):

| entry | files | testcase time (s) | share | held by |
|---|---|---|---|---|
| `app/lib/manufacturing-providers/__tests__` | 29 | 222.19 | 23.9 % | pinned-filter (A1 case 12 wants B23's line once), catalog, scenario-map |
| `app/lib/mcp` | 45 | 181.28 | 19.5 % | pinned-filter ([B20 A0]), guard-b20, guard-explicit ([B20 A4]), catalog, scenario-map |
| `app/lib/qualification/__tests__` | 33 | 135.70 | 14.6 % | pinned-filter (A1's own filter, OD-222), live-registry, catalog, scenario-map |
| `app/lib/agent/orchestration/__tests__` | 49 | 66.20 | 7.1 % | pinned-filter ([B21 A]; B21's C39 and C55 anchor it), guard-b21, catalog, scenario-map |
| `app/lib/computation/__tests__` | 28 | 51.02 | 5.5 % | catalog, scenario-map, live-registry |
| `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | 1 | 33.50 | 3.6 % | b24-b2-named |
| `app/lib/project/__tests__/b18-b-import-gates.test.ts` | 1 | 29.52 | 3.2 % | nothing |
| `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | 1 | 27.43 | 2.9 % | b24-b2-named |
| `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | 1 | 24.90 | 2.7 % | b24-b2-named |
| `app/lib/engineering/__tests__/b18-e-scenario-7.test.ts` | 1 | 20.92 | 2.2 % | scenario-map |
| `app/lib/acquisition` | 15 | 15.90 | 1.7 % | pinned-filter ([B20 A4]), guard-explicit, catalog, scenario-map, live-registry |
| `app/lib/engineering/__tests__/b18-e-lost-settlement.test.ts` | 1 | 10.39 | 1.1 % | nothing |
| `app/lib/engineering/__tests__/b18-c-undo-redo.test.ts` | 1 | 7.51 | 0.8 % | catalog, scenario-map |
| `app/lib/distributors/__tests__/b19-connector-policy.test.ts` | 1 | 5.58 | 0.6 % | nothing |
| `app/lib/workflow/prompt-to-gerber/__tests__` | 5 | 5.36 | 0.6 % | pinned-filter (the job's name; the task keeps it), catalog, scenario-map |
| `app/lib/engineering/__tests__/b18-c-review-3.test.ts` | 1 | 5.34 | 0.6 % | nothing |
| `app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts` | 1 | 5.29 | 0.6 % | nothing |

The five heaviest directory filters each hold at least one catalog link and one scenario-map path (`b24-d0-ci-split` 3). The
"test or page pins only" class is, apart from seven B21 route suites (4.2 s, anchored once by B21's pages), B24-B2's named list: the
25 B09-B11 and B16.0 suites the catalog does not link (93.72 s, 10.1 %) - the set B24-B2's page called the candidate for an
`agent-boundary-suites` job (C29). **CONFIRMED** (derived). The classes are those of `ba4f562`'s records; since the split, the catalog
and the map record the moved mcp and computation suites under `agent-boundary-suites` (section 5), which changes no file's class.

## 3. The candidate sets and the OD-30 arithmetic

The arithmetic the task fixed: a job's expected CI time = its local testcase time x CI's ratio, the ratio = 20 min 37 s (B24-C2's run)
/ the local total = 1237 s / 931.21 s = 1.328. It assumes CI's time scales with testcase time; it does not (CI's job also installs,
type-checks with a 4 GB heap and collects 471 files: locally `collect` alone took 270.53 s of the 670.97 s wall), so every figure
below is **INFERRED** until the first CI run of the split, which measures all three jobs. The split is insertion-only in every option:
`--exclude` lines before the `--reporter` line, the new job appended after `secret-scan`.

| option | moved items | files | local testcase time | share | expected prompt-to-gerber (of 25) | expected new job (of 20) | what it needs |
|---|---|---|---|---|---|---|---|
| 1: no production edit | B24-B2's 25 unlinked named suites + the 11 unheld files of 2 s or more (36 lines) | 36 | 166.53 s | 17.9 % | 16 min 56 s (headroom 8 min 04 s) | 3 min 41 s | reviewed moves in `b24-b2-ci-admission` 3, `b24-a1-environment-profile` 16, `b24-a2-secret-scan` (c); B19-E's guard and `_ci-admission.ts` extended to read `--exclude`; no production file |
| 1-max: the whole ceiling | every entry no production record holds (185 lines) | 203 | 209.06 s | 22.5 % | 15 min 59 s (headroom 9 min 01 s) | 4 min 38 s | as option 1, plus B21's C31-C34, C50, C51, C60, C115 (anchored once) and B19-E's [B20 A4] and [B21 A] moved; not recommended (185 exclude lines for 42 s more) |
| 2: one production-data move | option 1 + `app/lib/mcp` + `app/lib/computation/__tests__` (38 lines) | 109 | 398.84 s | 42.8 % | 11 min 47 s (headroom 13 min 13 s) | 8 min 50 s | option 1, plus `golden-catalog.ts` and `scenario-map.ts` rows for every linked file under the two filters, both generators re-run, `b24-b1-catalog` 4, `b24-b3-scenario-map`, B19-E's [B20 A0] and [B20 A4], B22-A1's citation of `:226` and the B20 and B22 pages' "runs in prompt-to-gerber" statements noted |
| 2b: option 2 + the orchestration filter | + `app/lib/agent/orchestration/__tests__` (39 lines) | 158 | 465.04 s | 49.9 % | 10 min 19 s | 10 min 18 s | option 2, plus [B21 A] and B21's C39 and C55 (the filter line anchored once) |
| 3: B23's filter | option 1 + `app/lib/manufacturing-providers/__tests__` (37 lines) | 65 | 388.73 s | 41.7 % | 12 min 01 s | 8 min 36 s | option 1, plus the production-data edits for B23's 29 suites, and A1 case 12 wants B23's filter line in the workflow exactly once - the new job's line would double it: an A1 STOP; not recommended |

Option 1 meets the task's shape and its rules but not its 40 % line; it puts prompt-to-gerber about 3 min back outside OD-30's
five-minute line, inside the runner's own seven-minute spread. Option 2 meets the 40 % line and needs the lead's leave to edit the two
catalog modules. The owner's rule stands in every option: no `timeout-minutes` changes. **PROPOSED** by the first run; **RECORDED**:
the lead chose option 2 on 2026-10-09 (section 0), and section 4 is its delivery.

The 36 items of option 1, in prompt-to-gerber's order (each is one `--exclude '<path>'` line and one line of the new job):
`app/api/__tests__/b16-0-auth-route-coverage.test.ts`, `app/lib/engineering/__tests__/b18-c-review-3.test.ts`,
`app/lib/engineering/__tests__/b18-c-review-fixes.test.ts`, `app/lib/engineering/__tests__/b18-c-result-contract.test.ts`,
`app/lib/engineering/__tests__/b18-e-lost-settlement.test.ts`, `app/lib/project/__tests__/b18-b-import-gates.test.ts`,
`app/lib/distributors/__tests__/b19-distributor-egress.test.ts`, `app/lib/distributors/__tests__/b19-connector-policy.test.ts`,
`app/lib/distributors/__tests__/b19-d-exact-mpn-connectors.test.ts`, `app/components/parts/__tests__/b19-e-atomic-publication-panel.test.tsx`,
`app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts`, `app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts`, 17 of the 19
agent suites `app/lib/agent/__tests__/b09-*`, `b10-*`, `b11-*` (`b09-loop-safety` and `b11-trace-replay-evaluation` are catalog links
and stay), the four chat route suites `app/api/chat/__tests__/b10-1-request-boundary`, `b10-2-closure`, `b10-chat-boundary`,
`b11-1-route-finalization`, and the four B16.0 pins `app/lib/auth/__tests__/b16-0-1-ci-gates`, `b16-0-2-gates`,
`b16-0-8-migration-ratchet` and `app/api/__tests__/b16-0-auth-route-coverage` (named above): 11 + 17 + 4 + 4 = 36. Of B24-B2's 36,
`pin-pad-mapping`, the `app/lib/footprint-resolver/__tests__` filter and the three opt-in live suites are catalog links too and stay.
`b24/d0/ptg-summary.json` holds the list with each figure. **RECORDED**.

## 4. The split: what moves and what stays

**Before any workflow edit** this run probed vitest 3.2.6's `--exclude` on the shapes the split uses (the task's stop condition), one
run through the lock: positional `app/lib/net/__tests__/b19-outbound-fetch.test.ts app/lib/net/__tests__/b20-a1-outbound-headers.test.ts
app/lib/schgen app/lib/fixture-runtime` with `--exclude 'app/lib/net/__tests__/b19-outbound-fetch.test.ts' --exclude 'app/lib/schgen/**'`
ran 3 files (the other net file and the two fixture-runtime files; 37 tests, exit 0; log `d0r2-probe-3-explicit-and-multi-exclude`):
an explicit positional file is left out when excluded by its own path, a directory filter's files by `<dir>/**`, and two `--exclude`
flags accumulate. The first run's two probes (one file under a directory filter; one directory glob) stand beside it. **CONFIRMED**.

**What moves.** The 38 items of option 2, each one `--exclude` line of prompt-to-gerber (`:293-330`, in this order) and one positional
line of `agent-boundary-suites` (`:570-607`); the first column is the item's own positional line in prompt-to-gerber, unchanged:

| line | item | files | testcase time (s) | share |
|---|---|---|---|---|
| `:98` | `app/lib/project/__tests__/b18-b-import-gates.test.ts` | 1 | 29.52 | 3.2 % |
| `:125` | `app/lib/distributors/__tests__/b19-distributor-egress.test.ts` | 1 | 2.63 | 0.3 % |
| `:131` | `app/lib/mcp` | 45 | 181.28 | 19.5 % |
| `:136` | `app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts` | 1 | 3.94 | 0.4 % |
| `:138` | `app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts` | 1 | 5.29 | 0.6 % |
| `:154` | `app/lib/distributors/__tests__/b19-connector-policy.test.ts` | 1 | 5.58 | 0.6 % |
| `:161` | `app/lib/distributors/__tests__/b19-d-exact-mpn-connectors.test.ts` | 1 | 3.50 | 0.4 % |
| `:207` | `app/components/parts/__tests__/b19-e-atomic-publication-panel.test.tsx` | 1 | 2.31 | 0.2 % |
| `:226` | `app/lib/computation/__tests__` | 28 | 51.02 | 5.5 % |
| `:229` | `app/lib/engineering/__tests__/b18-e-lost-settlement.test.ts` | 1 | 10.39 | 1.1 % |
| `:252` | `app/lib/engineering/__tests__/b18-c-result-contract.test.ts` | 1 | 2.27 | 0.2 % |
| `:254` | `app/lib/engineering/__tests__/b18-c-review-3.test.ts` | 1 | 5.34 | 0.6 % |
| `:255` | `app/lib/engineering/__tests__/b18-c-review-fixes.test.ts` | 1 | 2.04 | 0.2 % |
| `:260` | `app/lib/agent/__tests__/b09-1-boundary.test.ts` | 1 | 0.67 | 0.1 % |
| `:261` | `app/lib/agent/__tests__/b09-1-recovery.test.tsx` | 1 | 0.00 | 0.0 % |
| `:262` | `app/lib/agent/__tests__/b09-2-closure.test.ts` | 1 | 0.12 | 0.0 % |
| `:263` | `app/lib/agent/__tests__/b09-2-recovery.test.tsx` | 1 | 0.00 | 0.0 % |
| `:264` | `app/lib/agent/__tests__/b09-3-closure.test.ts` | 1 | 0.24 | 0.0 % |
| `:266` | `app/lib/agent/__tests__/b09-proposals.test.ts` | 1 | 0.07 | 0.0 % |
| `:267` | `app/lib/agent/__tests__/b09-provider-contracts.test.ts` | 1 | 0.00 | 0.0 % |
| `:268` | `app/lib/agent/__tests__/b10-1-strict-mode-publisher.test.tsx` | 1 | 0.03 | 0.0 % |
| `:269` | `app/lib/agent/__tests__/b10-editor-context.test.ts` | 1 | 0.12 | 0.0 % |
| `:270` | `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | 1 | 0.77 | 0.1 % |
| `:271` | `app/lib/agent/__tests__/b11-2-replay-context.test.ts` | 1 | 1.01 | 0.1 % |
| `:272` | `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | 1 | 24.90 | 2.7 % |
| `:273` | `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts` | 1 | 0.98 | 0.1 % |
| `:274` | `app/lib/agent/__tests__/b11-4-no-execution.test.ts` | 1 | 0.46 | 0.0 % |
| `:275` | `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | 1 | 1.01 | 0.1 % |
| `:276` | `app/lib/agent/__tests__/b11-6-projection-ownership.test.ts` | 1 | 0.59 | 0.1 % |
| `:277` | `app/lib/agent/__tests__/b11-7-primitive-discipline.test.ts` | 1 | 0.60 | 0.1 % |
| `:279` | `app/api/chat/__tests__/b10-1-request-boundary.test.ts` | 1 | 0.03 | 0.0 % |
| `:280` | `app/api/chat/__tests__/b10-2-closure.test.ts` | 1 | 0.12 | 0.0 % |
| `:281` | `app/api/chat/__tests__/b10-chat-boundary.test.ts` | 1 | 0.09 | 0.0 % |
| `:282` | `app/api/chat/__tests__/b11-1-route-finalization.test.ts` | 1 | 0.15 | 0.0 % |
| `:283` | `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | 1 | 33.50 | 3.6 % |
| `:284` | `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | 1 | 27.43 | 2.9 % |
| `:285` | `app/api/__tests__/b16-0-auth-route-coverage.test.ts` | 1 | 0.02 | 0.0 % |
| `:286` | `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | 1 | 0.80 | 0.1 % |

The moved set: **398.84 s** of the measured 931.21 s (42.8 %), 109 files, 38 items - the task's "at least 40 %" holds
(`b24-d0-ci-split` 9). Every moved file is database-free (no suite under the two filters or among the 36 imports
`app/lib/db/disposable-postgres`, by the guard's detector and the helper's: `b19-e-ci-job-scope`, `b24-d0-ci-split` 7). The opt-in
live suites under the moved filters (`b22-a3-runner-live`, `b22-d-adversarial-live`, under `app/lib/computation/__tests__`) move with
their filter and skip there as before, since the new job sets no flag (`b24-b3-live-suite-honesty` 2). **CONFIRMED** (derived from
the xml and the tree).

**What stays** in prompt-to-gerber: 362 files, 532.37 s (57.2 %) - the whole e2e replay chain
(`app/lib/workflow/prompt-to-gerber/__tests__`, the job's name), A1's and B23's directory filters (`app/lib/qualification/__tests__`,
`app/lib/manufacturing-providers/__tests__`, 357.89 s together, each cited once by A1 case 12), the orchestration, acquisition and
`app/api/mcp/__tests__` filters, every other directory filter, the 11 of B24-B2's 36 that the catalog links (`b09-loop-safety`,
`b11-trace-replay-evaluation`, `pin-pad-mapping`, the five footprint-resolver suites and the three opt-in live suites), every B21 route
suite and B19-E's explicit expectations, and this suite. The 242 positional lines are untouched; the step's folded scalar gained only
the 38 `--exclude` lines (a `#` would have been a shell comment and swallowed every later argument, so nothing was commented out).

**The new job** (`deterministic-manufacturing.yml:551-616`): one blank line (`:551`), three `  # [B24-D0]` comment lines
(`:552-554`), `agent-boundary-suites:` (`:555`, C12), `runs-on: ubuntu-latest`, `timeout-minutes: 20`, prompt-to-gerber's nine
checkout, pnpm, node and install lines verbatim (`:559-567`), `- run: >-` with `pnpm exec vitest run` (`:568-569`), the 38 items
(`:570-607`), `--reporter=dot --reporter=junit --outputFile=vitest-agent-boundary-suites.xml` last (`:608`, C13), and `Upload
diagnostics` (`actions/upload-artifact@v4`, `if: always()`, `:609-616`, C14) for that xml. No `env:`, no `secrets.`, no `permissions:` (it inherits
`contents: read`), no database, no browser, no `tsc` step (prompt-to-gerber's type check stays where it is). The job runs on the
workflow's triggers (`pull_request`, `push` to main, `workflow_dispatch`), so `PULL_REQUEST_CI_JOBS` names it (C19). **CONFIRMED**
(`b24-d0-ci-split` 5).

**The OD-30 arithmetic** (the task's method; ratio 1.328 = 1237 s / 931.21 s; **INFERRED** until the first CI run, which the lead
reads for all three jobs; the ratio assumes CI's time scales with testcase time, and section 3 says why it does not quite):

- prompt-to-gerber: 532.37 s x 1.328 = about 11 min 47 s of 25 (headroom about 13 min 13 s against the limit, C1) - **INFERRED**;
  it also still installs, type-checks and collects 363 files (this suite joined), none of which the ratio counts.
- agent-boundary-suites: 398.84 s x 1.328 = about 8 min 50 s of 20 (headroom about 11 min 10 s against its limit) - **INFERRED**;
  it installs and collects 109 files and runs no `tsc`.
- page-browser-e2e: untouched by D0 (21 min 15 s of 30 at B24-C2's run, the lead's reading, **RECORDED**); B24-D1's headroom steps
  record all three.

**The proof that nothing was lost** - the new job's own selection run locally once through the runner, after every edit of the
review round (`d0r3-abs-selection`, section 6): started 06:59:08, ended 07:05:21 local on 2026-10-09; vitest `Duration 369.60s
(transform 14.58s, setup 289ms, collect 116.37s, tests 581.04s, environment 4.12s, prepare 11.40s)`; `Test Files 107 passed | 2
skipped (109)`, `Tests 1556 passed | 18 skipped (1574)`, exit 0; the lock's cleanup reported 0 processes left; its junit
(`b24/d0/run3/abs-timing.xml` in the scratchpad, 538,476 bytes, LF) holds 109 files, 1574 tests, 0 failures, 0 errors, 18 skipped,
580.64 s of testcase time. Its 109 files are exactly the measurement's 109 moved files (set equality both ways, by name), and the two
files skipped whole are the two opt-in live suites under `app/lib/computation/__tests__` (`b22-a3-runner-live`,
`b22-d-adversarial-live`), skipped whole in the measurement too; every other file passed, none failed. Its testcase time is above the
measurement's 398.84 s for the same files (two workers over 109 files on a loaded machine: `b20-b4-process-gate` 56.68 s against
37.70 s) and is no re-measurement - the OD-30 arithmetic above keeps the first run's figures. The second run's attempt at this proof
(`d0r2-abs-selection`) had exited 1 after 86 s with no summary and an empty junit and was never a record ([B24-D0 review, 2026-10-09]
correctness-2, security-1: the page had claimed it); this run is. **CONFIRMED** by execution.

## 5. The guards, the helper and the pins moved

Every pin below moved in place with a dated `[B24-D0, 2026-10-09]` note on its line; none was loosened. `git grep -l` of each file's
name found its readers before the edit, and the readers ran before (19 files, 299 tests, exit 0, `d0r2-readers-before`) and after
(section 6).

**The helper** `app/lib/qualification/__tests__/_ci-admission.ts` (B24-B1's, extended in place; no second reader): `CI_JOB_IDS` gains
`agent-boundary-suites` (C16's file, `:30`); a sixth anchor `  agent-boundary-suites:` (`:48`); `foldedVitestFilters` became
`foldedVitestStep` (C16) returning `{ filters, excludes }` - the `--exclude '<pattern>'` lines after the positional filters, each a
quoted `<dir>/**` or test-file path some positional filter touches; a bare, unquoted or mis-shaped exclude, another flag, a positional
filter after an exclude, or an exclude no positional filter selects throws CI_ANCHOR (`b24-d0-ci-split` 6 plants each); `jobsOf` is
net of the exclusions (`runs`, C17: `<dir>/**` leaves out every path under the directory, a file path that file); `filters` gains the
new job's list and a new `excludes` record carries the three folded jobs' patterns. `b24-b1-catalog` 4's anchor probes gain the sixth
key (C23). **CONFIRMED** (`b24-b2-ci-admission` 3 and 4, `b24-b1-catalog` 4, `b24-b3-scenario-map` 3, `b24-b3-live-suite-honesty` 2
and `b24-d0-ci-split` 6 to 7 read through it).

**The guard** `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` (B19-E's; `const CHAPTERS` stays on `:54`, which five pages
cite): `jobFilters` skips the `--` lines; `jobExcludes` (C35) reads the exclude lines (after every positional filter, each a quoted
`<dir>/**` or test-file path; any other flag fails); `runBy` is a job's positional selection net of its exclusions; `offlineRuns`
names the no-database jobs that run a file. The five helpers are declared after the describe block, at the end of the file
(`:273-306`; [B24-D0 review, 2026-10-09] correctness-1, security-3: they first sat before it, which moved every case +35; the
describe is back on `:95`, C50, and each case keeps HEAD's line but for the lines the in-case notes added: case 1 +1, [B19-E E3]
+1, [B20 A0] +4, [B20 A4] +2, [B21 A] +2, [SEC-1] +1; the citations of the shifted cases are re-pinned below). Reviewed moves,
each noted on its line: case 1 reads prompt-to-gerber net of its
exclusions and adds the new job's no-PGlite check; [B19-E E3] and the chapter case admit a non-PGlite suite in exactly ONE of
prompt-to-gerber and agent-boundary-suites (was: in prompt-to-gerber); [B20 A0] keeps `app/lib/mcp` as a prompt-to-gerber positional
filter and adds that prompt-to-gerber excludes it, the new job lists it and `app/api/mcp/__tests__` stays; [B20 A4] expects the four
explicit entries and the acquisition suite in prompt-to-gerber and the two `app/lib/mcp` suites in the new job; [B21 A] adds that
every B21 suite still runs in prompt-to-gerber; [SEC-1] adds that its suite is not excluded; the redundancy rule is unchanged; a new
`[B24-D0]` case (C15) pins that the exclude list equals the new job's positional list, each exclude removes at least one positionally
selected file, every excluded file runs in the new job and nothing runs in both, and the new job has no exclude, no PGlite suite and
no explicit file under one of its directory filters. The guard's `it(` count is 9 (was 8): B21-A's row in
`orchestration-contracts.md:344` (C33, pinned by `b21-a-page` 4, C34) re-pinned 8 -> 9 and `9 + 1 per chapter` with a dated note on
`:351`. **CONFIRMED** (the guard green after, in `d0r2-readers-after-2` and, with the helpers at the end, `d0r3-readers-after`;
`b21-a-page` green after, in `d0r2-orchestration-dir` and `d0r3-closeouts-and-pins`; section 6).

**The catalog modules** (the lead's leave; the only production files touched): `app/lib/evaluation/golden-catalog.ts` -
`CATALOG_CI_JOBS` (C18) and `PULL_REQUEST_CI_JOBS` gain `agent-boundary-suites`; `AGENT_BOUNDARY` (C19, declared on the line that
held B24-B2's NO_JOB note, so no later line moved) records it on the eight link declarations under the two filters (`parity`,
`b20-a2-tool-discovery`, `b20-d1-malicious-server`, the four `b22-a1-*`/`b22-d-adversarial` suites and the `b22-d-adversarial-live`
opt-in link; `app/api/mcp/__tests__/b20-d2-never-reachable-sweep` stays prompt-to-gerber). `app/lib/evaluation/scenario-map.ts` -
`AGENT_BOUNDARY` (C20; one line inserted after `P2G_CORE`, so `recordedCiJobsOf` moved to `:402`, C21) on its eight evidence items
(scenarios 12, 15, 16 and 18), and `live()` takes the job as a parameter (default `P2G`). Generators: `generate-b24-eval-catalog` and
`generate-b24-scenario-map` each run twice through the lock (exit 0 x 4); the first pass rewrote `eval-catalog.csv` (six rows' CI-job
cells), `eval-catalog.json` (`catalogDigest` `eng1-de3c15c892b29c1b` -> `eng1-f0ac300e3f594603`) and `scenario-map.json` (`mapDigest`
`eng1-c67f871dc0dcf3c4` -> `eng1-dee4eaa7c1343196`); the second pass changed nothing (`git status` and the diff digest identical):
zero drift. `scenario-map.csv` carries no CI job and is unchanged, so B3's page table (`b24-b3-scenario-map` 6) stands. **CONFIRMED**.

**The suites' pins** (each in place, dated):

| suite | case | was | is |
|---|---|---|---|
| `b24-a1-environment-profile` | 16 (C24) | `toHaveLength(13)` planned rows | 15: D0's two real rows beside the 13 planned groups |
| `b24-a2-secret-scan` | (c) (C25) | the last job header is `secret-scan`; the job runs to the file's end | secret-scan found by content, follows production-smoke, precedes agent-boundary-suites; the job runs to the next header; the header list gains `agent-boundary-suites:`; the suite's header line 11 noted; [B24-D0 review, 2026-10-09] correctness-5, security-4: the `it(` title (`:183`, C40) retitled in place to what the body pins and the header sentence (`:11`) likewise, the dated notes kept |
| `b24-b2-ci-admission` | 3 and 4 (C22) | each named suite selected by exactly one prompt-to-gerber filter | selected by exactly one positional filter of the one job that runs it (prompt-to-gerber net of its exclusions, or agent-boundary-suites); the 25 moved names run in the new job, the other 11 and the three live suites in prompt-to-gerber |
| `b24-b1-catalog` | 4 (C23) | five workflow anchors probed | six (the new job's key); three `jobsOf` pins for a moved mcp suite, the moved computation live suite and the staying `app/api/mcp` suite |
| `b19-e-ci-job-scope` | 1, E3, the chapter case, A0, A4, B21-A, SEC-1, + the [B24-D0] case (C15, C35, C50) | see "The guard" | see "The guard" |
| `b24-d0-ci-split` | 4 | the tree is unsplit | the tree is split (section 6) |
| `b24-d0-ci-split` | 12 (C48, new) | - | the review round's checks, red first on the reviewed tree, every problem listed in one run (section 6) |

**The page citations the 38 lines moved** (+38, each re-derived by its anchor on the tree and moved in place with a dated note; every
citation at or below `:293`): B21's C49 374 -> 412, C93 377 -> 415, C94 386 -> 424 (`evaluation-matrix.md:1139, :1183, :1184`,
`b21-f-page` 6); B23's C64 335 -> 373 (`dfm-quote-flow.md:537`, C32, `b23-b-dfm-quote-flow-page` 3) and its prose citation
(`dfm-quote-flow.md:269`, `b24-a1-environment-profile` 17; the C64 re-pin noted at `:470`); B24-B2's page-browser-e2e limit line
`:360` -> `:398` (`ci-admission.md:185`); B24-C1's row `:340` -> `:378` with A4's last entry `:339` -> `:377`
(`observability-and-replay.md:364`), C3's prose `:342` -> `:380` (`:861`), C3's row `:342` -> `:380` with C2's `:341` -> `:379`
(`:1072`), C50 342 -> 380 (`:1226`, a four-cell citation row, so its note is on `:861`); B24-C2's row `:341` -> `:379` with C1's
`:340` -> `:378` (`retention-and-deletion.md:184`); B24-A4's two workflow lines, which no earlier task had moved (the first run's open
item): `:303-306` and `:302` -> `:374-377` and `:373` (`database-and-recovery.md:446`, A4's numbers carried +32, +1, +38) and
`timeout-minutes: 15` at `:275` -> `:346` (`:475`). The C1-C3 pages' `### The README row` drafts ([B24-D0 review, 2026-10-09]
correctness-4; the second run had left them): `:340` -> `:378` (`observability-and-replay.md:526`, C45),
`:342` -> `:380` (`observability-and-replay.md:1336`, C46), `:341` -> `:379` (`retention-and-deletion.md:274`, C47), each in place
with the dated note. The B24 README's C1-C3 rows and `OWNER_DECISIONS.md:110` are the lead's files: their
moves are drafted in section 9. The statements the split supersedes carry dated notes on their lines (section 7). A1's insertion
table (`environments-and-deployment.md:384`) gained D0's two rows (`:394-395`, C28): `| [B24-D0, 2026-10-09] | prompt-to-gerber | `:293` | 38 |`
and `| [B24-D0, 2026-10-09] | agent-boundary-suites | `:551` | 66 |` - the appended job's first line is its leading blank line and its
count includes it, A2's convention (A2's secret-scan row `:447` 26 at A2's tree carries to `:525-550` today, right above D0's blank
line; `b24-d0-ci-split` 10 reads the convention from the tree). A1's own tables and numbers were not edited (the handover's rule);
A1 cases 12, 14, 16 and 17 ran before and after (section 6). **CONFIRMED**.

**The guard's line citations** ([B24-D0 review, 2026-10-09] correctness-1, security-3; the second run's mid-file helpers had left
every citer of a line below `:93` stale): re-derived by anchor on this tree, once the helpers sat at the end of the file, and moved
in place with the dated note - `ci-admission.md:85` (the redundancy rule) `:236-240` -> `:247-251` (C36); `ci-admission.md:92` (the
detector fixtures) `:106-124` -> `:107-125` (C37); `mcp-client-boundary.md:41` (the chapter case and the [B20 A0] case) `:147-164`
-> `:150-194` (C38); `b24-b2-ci-admission.test.ts:19` and `:192` (the detector fixtures) `:106-124` -> `:107-125` (C39). The
`:52-55`, `:53` and `:54` citers (`const CHAPTERS`) never moved. The seven citations in the lead's files (B24's discovery `:977`,
`:986`, `:1436`, `:1569`; B22's `:843`, `:1327`; B20's `:142`) are drafted in section 9, one dated line each. `b24-d0-ci-split` 12
pins every re-pin and refuses a HEAD-numbered citation without its note. **CONFIRMED** (case 12 green, section 6).

## 6. Test-first record and gates

`b24-d0-ci-split` (`app/lib/qualification/__tests__/b24-d0-ci-split.test.ts`, rides A1's directory filter, C5, no explicit entry; no
PGlite; it reads files and writes nothing). The first run wrote its four measurement cases before the page (red twice, then green;
the first run's record). This run kept cases 1 to 3 as they were, inverted case 4 with a dated note (the tree is split) and added
cases 5 to 11 - (i) to (vi) of the task and the citation case - before any other edit:

- Red run 1 at `aaa6a1b` (`d0r2-red-1-ci-split-unsplit`, no workflow edit, no page edit): 8 failed, 3 passed (cases 1 to 3 hold on the
  evidence; 4 to 11 red on the unsplit workflow, the missing helper fields, the missing rows and notes), exit 1.
- The readers before any edit (`d0r2-readers-before`: the A1, A2, B1, B2, B3 and live-suite suites, the guard, `b21-f-page`,
  `b22-a1-page`, the three B23 readers, the six B20 page readers): 19 files, 299 tests, exit 0.
- Then the workflow (insertions only: `git diff --numstat` 104 added, 0 removed; 616 lines; no CR; parsed with the pnpm store's
  js-yaml 4.1.1: six jobs, the new job 6 steps and 45 run tokens, prompt-to-gerber 38 excludes), the helper, the guard, the pins,
  the two catalog modules, the generators twice, the page citations, this page; then green (below).

**The review round** ([B24-D0 review, 2026-10-09]; ten confirmed findings, seven distinct: correctness-1 = security-3, correctness-2
= security-1, correctness-5 = security-4). Case 12 was written first, one check per finding, every problem collected and listed
in one run, and run on the reviewed tree before any fix (`d0r3-red-1-review`): 2 failed, 10 passed of 12, exit 1 - case 4 on this
suite's row (11 `it(` -> 12) and case 12 with 67 problems: the five helpers on `:97-125` before a describe on `:130`, the detector,
chapter and [B20 A0] cases on `:142`, `:185`, `:193`; the four HEAD-numbered guard citations without a note; the placeholder; a
gates table of four rows with none of the 19 required; the four ci-admission statements; the three README-row drafts; the (c)
title and header; the hostname unrecorded; the merge gate and the seven lead drafts absent. Then the fixes (section 5, 7 to 9) and
green (below): the first final chain over the finished page left case 12 red on one residual, a line wrap inside section 5's
README-row record (`d0r3-qualification-dir`, `d0r3-green-final-ci-split`: 1 failed, 11 passed); the record was re-wrapped onto one
line and the chain repeated (`-2`), green. The second run's gates before the review stand in `b24/logs/d0r2-*` (the readers after, the orchestration directory,
the tripwires and count pins, eslint, the B17 generator; its `b24-d0-ci-split` runs were red on case 4 until the citation rows
resolved, and its selection run, `d0r2-abs-selection`, exited 1 after 86 s with no summary - the run this round repeated and
recorded, section 4).

| suite | it( |
|---|---|
| `app/lib/qualification/__tests__/b24-d0-ci-split.test.ts` | 12 |

Gates (every heavy job alone through the global lock; the lock's cleanup reported 0 processes left after each; logs
`b24/logs/d0r2-*` for the split and `b24/logs/d0r3-*` for the review round):

| gate | files | tests | exit |
|---|---|---|---|
| the exclusion probe before any workflow edit (`d0r2-probe-3-explicit-and-multi-exclude`): two explicit files, two directory filters, one file and one directory excluded - 3 of 5 files ran | 3 | 37 | 0 |
| the readers before any edit (`d0r2-readers-before`) | 19 | 299 | 0 |
| `b24-d0-ci-split` red 1 at `aaa6a1b` (`d0r2-red-1-ci-split-unsplit`) | 1 failed | 8 failed, 3 passed | 1 |
| B24-B1's catalog generator and B24-B3's scenario-map generator, twice each (`d0r2-gen1-*`, `d0r2-gen2-*`) | - | 114 rows; 20 scenarios; pass 2 identical to pass 1 (no drift) | 0, 0, 0, 0 |
| `b24-d0-ci-split` red on the reviewed tree, case 12 written first (`d0r3-red-1-review`) | 1 failed | 2 failed, 10 passed (12) | 1 |
| tsc after the review's .ts edits - the guard's helpers moved, this suite, `b24-a2-secret-scan`, `b24-b2-ci-admission` (`d0r3-tsc`) | - | 0 log lines | 0 |
| eslint on those four files (`d0r3-eslint`) | 4 | 0 log lines | 0 |
| the readers after the review fixes (`d0r3-readers-after`): the A1, A2, B1, B2, B3 and live-suite suites, `b19-e-ci-job-scope`, `b21-f-page`, `b22-a1-page`, `b23-b-dfm-quote-flow-page`, `b23-a-provider-admission`, `b23-d-physical-evidence-contract`, the six B20 page readers | 18 | 296 | 0 |
| the new job's selection run locally once after the review's edits (`d0r3-abs-selection`, section 4): 107 passed, 2 skipped whole (the opt-in live suites), none failed; junit 109 files, 1574 tests, 0 failures, 0 errors, 18 skipped, 580.64 s of testcase time; the files equal the measurement's 109 moved files | 109 files | 1556 passed, 18 skipped (1574) | 0 |
| B24-B1's catalog generator once more on the final modules (`d0r3-generate-b24-eval-catalog`: 114 rows), B24-B3's scenario-map generator (`d0r3-generate-b24-scenario-map`: 20 scenarios) and the B17 control-inventory generator (`d0r3-generate-b17-control-inventory`: 631 controls, 63 surfaces): `git status` and the diff digest identical before and after each, no drift | - | - | 0, 0, 0 |
| the three closeout tripwires with B11.5, `b21-a-page` and the count pins (`d0r3-closeouts-and-pins`): `b21-closeout-statements` (10), `b22-closeout-statements` (9), `b23-closeout-statements` (8), `b11-5-capture-exactness` (18), `b21-a-page` (6), `b16-1c-invariant-tripwires` (7), `b23-a-tier3-vocabulary` (9), `b22-b-exposure` (9), `b16-b-migrations` (15), `action-registry` (10, B01's toolability pin), `b21-a-import-gates` (7) | 11 | 108 | 0 |
| tsc once more on the final .ts state (`d0r3-tsc-2`) | - | 0 log lines | 0 |
| eslint once more on the four edited files (`d0r3-eslint-2`) | 4 | 0 log lines | 0 |
| the qualification directory `app/lib/qualification/__tests__` over the page as first finished (`d0r3-qualification-dir`): 33 files green; this suite red on case 12's one residual problem - section 5's README-row record wrapped "`:342` -> `:380`" from its "(`observability-and-replay.md:1336`" onto the next line, so the recorded move never stood on one line | 34 | 358 passed, 1 failed, 3 skipped (362) | 1 |
| the three closeout tripwires over that page (`d0r3-closeouts-final`): `b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements` | 3 | 27 | 0 |
| `b24-d0-ci-split` over that page (`d0r3-green-final-ci-split`): cases 1 to 11 green, case 12 red on the same one residual | 1 failed | 1 failed, 11 passed (12) | 1 |
| the qualification directory once more over the re-wrapped page, this suite and `b24-a1-configuration` 14 among its files (`d0r3-qualification-dir-2`) | 34 | 359 passed, 3 skipped (362) | 0 |
| the three closeout tripwires once more over the re-wrapped page (`d0r3-closeouts-final-2`) | 3 | 27 | 0 |
| `b24-d0-ci-split` green over the re-wrapped page, the last run of the round (`d0r3-green-final-2-ci-split`) | 1 | 12 | 0 |

The count pins, each green inside the first run's measurement at `ba4f562` (its junit) and again in the review round's
`d0r3-closeouts-and-pins` (`b24-a1-configuration` in `d0r3-qualification-dir`): `b16-1c-invariant-tripwires` "168 route methods = 165
canonical + 3 factories + 0 raw"; `b22-b-exposure` 1 "registry 47 (42 + the five kinds), agent set 36 (33 + the three reads), MCP 9
unchanged" (the tool counts 47 / 36 / 9 / 27); B01's "the committed toolability matrix equals the registry render"
(`app/lib/engineering/__tests__/action-registry.test.ts`; [B24-D0 review, 2026-10-09] the second run's gates had not run it) and
`b23-a-tier3-vocabulary` (107 action records); `b21-a-import-gates` 1 and `b24-a1-configuration` 14 (the six SDK importers and the
six construction sites); `b16-b-migrations` (32 migrations). **CONFIRMED** by execution.

## 7. Superseded statements

Each carries a dated `[B24-D0, 2026-10-09]` note on its own line:

- `ci-admission.md:189-190` (B24-B2): "an estimate over 20 minutes would have sent the 36 suites to a new `agent-boundary-suites`
  job ... so they ride prompt-to-gerber (OD-204's default); no new job" - OD-30's line was crossed at C2's run and D0 moved 25 of the
  36 with 13 other items to the appended job.
- `eval-catalog.md:330` (B24-B1): "The closed job set is `prompt-to-gerber`, `database-delivery`, `benchmark-core`,
  `benchmark-nightly` and `page-browser-e2e`" - and, since the split, `agent-boundary-suites`.
- `edge-security.md:542` (B24-A2, (i)): "`secret-scan` appended after every job ... so no cited line moves" - D0 appended
  `agent-boundary-suites` after it; secret-scan is the last job no more.
- `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:285` (B22-A1): "one directory filter `app/lib/computation/__tests__`
  in `prompt-to-gerber` (workflow `:226` ...)" - the line stays at `:226`, prompt-to-gerber excludes it (`:301`) and the suites run in
  the new job.
- `artifacts/ai-control-plane-b20/mcp-client-boundary.md:41` and `mcp-provider-connectors.md:254` (B20): "`app/lib/mcp` is a
  `prompt-to-gerber` directory filter", "all under the `app/lib/mcp` directory filter of the prompt-to-gerber job" - the filter line
  stays at `:131`, prompt-to-gerber excludes it (`:295`) and the `b20-` suites run in the new job, where the guard admits them.
- `orchestration-contracts.md:344` (B21-A): the guard's row, 8 -> 9 and `9 + 1 per chapter`, noted on `:351`.
- `ci-admission.md:83` (B24-B2, (c); [B24-D0 review, 2026-10-09] correctness-3): "each selected by exactly one prompt-to-gerber
  filter" - 25 of the 36 (the B09-B11 suites but `b09-loop-safety` and `b11-trace-replay-evaluation`, the four B16.0 pins) are
  excluded at `:306-330` and run in the new job, each selected there by exactly one positional filter (C41); the guard citation on
  `:85` re-pinned `:236-240` -> `:247-251`.
- `ci-admission.md:362`, `ci-admission.md:364` and `ci-admission.md:365` (B24-B2, section 13; correctness-3): "`b11-1-trace-integrity.test.ts:445-448` now run in
  prompt-to-gerber (`:278`, `:270`). CONFIRMED", "the B11.1 route finalization suite (`:282`) and the B16.0 gates (`:283-286`).
  CONFIRMED", "the B11.1 integrity suite (`:270`). CONFIRMED" - `:270`, `:282` and `:283-286` are excluded at `:315`, `:326` and
  `:327-330` and run in the new job; `:278` stays (C42-C44).
- This page's first text (the STOP): rewritten in place by this run (sections 0, 4 to 9); the measurement record (sections 1 to 3)
  stands whole.

## 8. What stays open

- **UNKNOWN** until CI: the figures of section 4. The first CI run after the push measures prompt-to-gerber, agent-boundary-suites
  and page-browser-e2e; the lead reads all three (OD-30), and B24-D1's headroom steps record them afterwards. If the new job's real
  time approaches its 20-minute limit, the lead's rule applies to it as to any job.
- **INFERRED**, low: `scenario-map.md:325` and `:415` (B24-B3) cite `golden-catalog.ts:200, :237, :336, :352` for four `liveOptIn`
  links; on this tree they stand on `:201`, `:238`, `:337`, `:353` (a line was inserted above them before D0; D0 inserted none in that
  module). No suite pins them. Not moved by D0 (not a line the insertions moved).
- **INFERRED**, low: the lead's lock (`bin/lock.sh`) takes a lock older than 20 minutes as abandoned; the first run's measurement ran
  11 min 15 s under it. Scratchpad only.
- The B24-D1 plan (A1's simulation, `b24-a1-environment-profile` 16) counts 15 insertion rows: the ten real rows (D0's two included)
  and D1's four and D2's one still planned.
- `OWNER_DECISIONS.md:110` (the lead's file) cites A4's `:303-306`, today `:374-377`; drafted in section 9.
- **RECORDED** ([B24-D0 review, 2026-10-09] security-2; [B24-D0 lead, 2026-10-09] scrubbed): the evidence xml disclosed the measuring
  machine's name - vitest's junit reporter wrote it as the `hostname` attribute on each of its 471 `<testsuite>` elements; the lead
  replaced every occurrence with `hostname="local"` before the commit (option (b) of section 9; 471 replacements, the file's
  2,091,656 bytes unchanged, sha256 `19d56fd7b4694fd030eb4172fc8a13f7fdf109461bb5af98b800d167db226b9d`) (one value; no path, user name or secret in the
  file: 0 hits for the user's folder or `/Users/`; the 33 `<system-out>`/`<system-err>` blocks hold console text such as a refused
  database connection) and no scanner rule covers a hostname (`secret-scan.ts:34`, C49). This run kept the file byte-identical (its
  rule); the scrub is drafted for the lead in section 9, and `b24-d0-ci-split` 12 pins the one value to this note.
- **UNKNOWN** until the lead confirms ([B24-D0 review, 2026-10-09] security-5): the merge gate. No job of either workflow `needs:`
  another and the tree records no required-status-check list, so a list configured by job name would not include
  `agent-boundary-suites` until someone adds it, and the 109 moved files' pins now fail only there (section 9, "The merge gate").
- The guard citations in the lead's files (B24's discovery `:977`, `:986`, `:1436`, `:1569`; B22's `:843`, `:1327`; B20's `:142`):
  stale on this tree by the in-case notes (one to six lines); drafted in section 9. Not pinned by any suite.

## 9. For the lead

### OD-30 amendment

- [B24-D0, 2026-10-09] B24-D0 split prompt-to-gerber by insertions only (the lead's option 2 of `ci-split.md` section 3, decided 2026-10-09 after the first run's measurement and STOP): 38 `--exclude` lines before its `--reporter` line (`deterministic-manufacturing.yml:293-330`) move B24-B2's 25 unlinked named suites, the 11 unheld files of 2 s or more and the `app/lib/mcp` and `app/lib/computation/__tests__` directory filters - 109 files, 398.84 s of the measured 931.21 s of local testcase time (42.8 %) - to the appended job `agent-boundary-suites` (`:551-616`; `timeout-minutes: 20`; prompt-to-gerber's setup steps verbatim; no environment variable, secret, database or browser), which runs exactly those items. Expected at CI's ratio 1.328 (20 min 37 s / 931.21 s): prompt-to-gerber about 11 min 47 s of 25 (headroom about 13 min 13 s), agent-boundary-suites about 8 min 50 s of 20 (headroom about 11 min 10 s) - INFERRED until the first CI run after the push, which the lead reads for all three jobs. The two catalog modules record the move (`CATALOG_CI_JOBS` and `PULL_REQUEST_CI_JOBS` gain `agent-boundary-suites`; eight catalog link declarations in six rows and eight scenario-map evidence items in four scenarios record it), both generators re-run twice with zero drift; the helper reads the exclusions and the B19-E guard admits every non-PGlite suite in exactly one of the two jobs. No `timeout-minutes` changed; no job removed; no existing workflow line edited.

### The discovery section 10 line

- [B24-D0, 2026-10-09] B24-D0 landed the OD-30 split of prompt-to-gerber by insertions only (the lead's option 2 after the first run's measurement and STOP; closes no defect): 38 `--exclude` lines at `deterministic-manufacturing.yml:293-330` and the appended job `agent-boundary-suites` (`:551-616`, 20 minutes, no env, secret, database or browser) move 109 files, 398.84 s = 42.8 % of the measured 931.21 s of local testcase time (`ci-split.md` section 4; evidence `artifacts/ai-control-plane-b24/evidence/d0-ptg-timing.xml`); `_ci-admission.ts` reads `--exclude` lines and `jobsOf` is net of them, the B19-E guard admits every non-PGlite suite in exactly one of the two jobs (+1 case), `golden-catalog.ts` and `scenario-map.ts` record the move (both generators twice, zero drift); pins moved in place with dated notes: `b24-a1-environment-profile` 16 (13 -> 15), `b24-a2-secret-scan` (c), `b24-b2-ci-admission` 3 and 4, `b24-b1-catalog` 4, B19-E's cases 1, E3, the chapter case, A0, A4, B21-A and SEC-1, B21-A's guard row (8 -> 9), B21's C49/C93/C94, B23's C64 and prose citation, B24's C50 and the C1-C3 and A4 workflow lines, A1's insertion table (two rows), and the superseded statements of B20, B22, A2, B1 and B2 noted; the review round's ten confirmed findings closed in-tree (the guard's helpers at the end of its file and every guard citation re-pinned, the gates recorded, B2's section-13 statements and the C1-C3 README-row drafts noted, A2's (c) retitled, the evidence's hostname recorded, the merge gate drafted). Expected CI times INFERRED (prompt-to-gerber 11 min 47 s of 25, agent-boundary-suites 8 min 50 s of 20) until the first run. Counts unchanged (census 168 / 165 / 3 / 0, tools 47 / 36 / 9 / 27, 107 action records, 32 migrations, six SDK importers). `ci-split.md`.

### The README row

| B24-D0 the OD-30 split of prompt-to-gerber (OD-30 amended; no defect) | `ci-split.md`, evidence `evidence/d0-ptg-timing.xml`; workflow `deterministic-manufacturing.yml:293-330` (38 `--exclude` lines), `:551-616` (`agent-boundary-suites`); code `app/lib/evaluation/golden-catalog.ts`, `app/lib/evaluation/scenario-map.ts` (the move recorded; `eval-catalog.csv`, `eval-catalog.json`, `scenario-map.json` regenerated); test helper `_ci-admission.ts` (reads `--exclude`), guard `b19-e-ci-job-scope` (+1 case); suite `b24-d0-ci-split` (12) | done 2026-10-09 offline at `aaa6a1b`, one review round closed in-tree: 109 files, 42.8 % of the measured local testcase time moved; expected prompt-to-gerber 11 min 47 s of 25 and agent-boundary-suites 8 min 50 s of 20 (INFERRED until the first CI run); census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records, 32 migrations |

### B24-D0 - the OD-30 split of prompt-to-gerber (2026-10-09 local; increment workflow + lead; this commit)

Test-first on `chapter/b24-production-qualification`, two runs. The first run (from `ba4f562`) measured prompt-to-gerber's own 242 entries once through the runner with the junit reporter (471 files, 5430 tests, 0 failures, 42 skipped; 931.21 s of testcase time; the xml committed as evidence), derived the holders from the tree and stopped: the entries carrying 77.6 % of the time are the chapter directory filters whose suites the catalog and the scenario map record, and everything no production record holds is 22.5 %, under the task's 40 %. The lead chose option 2 (42.8 %) and relaxed the no-production-change rule exactly to the two catalog modules. The second run (from `aaa6a1b`) wrote the split's cases first (8 red, 3 green at `aaa6a1b`), probed vitest's `--exclude` on the exact shapes, then inserted the 38 `--exclude` lines before prompt-to-gerber's `--reporter` line (`:293-330`) and appended `agent-boundary-suites` (`:551-616`; 104 lines added, 0 removed, 0 edited); extended `_ci-admission.ts` in place to read the exclusions (no second reader), moved B19-E's guard to admit every non-PGlite suite in exactly one of the two jobs (+1 case; B21-A's row 8 -> 9), moved the A1 (16), A2 ((c)), B2 (3, 4) and B1 (4) pins in place with dated notes, recorded the move in `golden-catalog.ts` and `scenario-map.ts` and re-ran both generators twice with zero drift, moved every page citation the 38 lines shifted (+38: B21 C49/C93/C94, B23 C64 and its prose, B24-B2's limit line, C1-C3's rows and C50, A4's two lines) and noted the superseded statements (B20, B22, A2, B1, B2), appended D0's two rows to A1's insertion table (`:293` 38; `:551` 66). Suite `b24-d0-ci-split` (12 cases: the evidence is the job's selection; the tables are the evidence; the holders are derived; the tree is split and the page says so; the new job's shape; the exclude list equals the new job's list and the helper bites; disjoint selections whose union is the former one; the moved-set table; at least 40 % and the OD-30 arithmetic; A1's two rows; every moved citation and superseded statement noted; the review round's checks). The review round ([B24-D0 review, 2026-10-09], ten confirmed findings, seven distinct) closed in-tree, case 12 red first with its 67 problems listed, then green: the guard's five helpers moved after its describe block (every case back on HEAD's line but for the in-case notes) and the guard citations re-pinned in place with dated notes (`ci-admission.md:85`, `:92`, `mcp-client-boundary.md:41`, `b24-b2-ci-admission.test.ts:19`, `:192`; the seven in the lead's discovery pages drafted), the page's placeholders replaced by the recorded gates and case 12 refusing a placeholder or a gate without a numeric exit, B2's section-13 statements and the C1-C3 README-row drafts noted in place, A2's case (c) retitled to what it pins, the evidence's `hostname` attribute recorded (kept byte-identical; the scrub drafted), the merge gate drafted for the lead. Gates (every run alone under the lock, 0 processes left after each): the readers after the fixes (18 files, 296 tests), the new job's own selection locally (109 files: 107 passed, 2 opt-in live suites skipped whole, 1574 tests, none failed; the files equal the measurement's moved set), the three closeout tripwires with B11.5, `b21-a-page` and the count pins (11 files, 108 tests; census 168 / 165 / 3 / 0, tools 47 / 36 / 9 / 27, 107 action records, 32 migrations, the six SDK importers, B01's toolability matrix), the qualification directory (34 files, 362 tests), the closeouts once more and the suite green over the finished page (12), tsc and eslint clean twice, the B1, B3 and B17 generators with zero drift; every exit 0. Expected CI times INFERRED (11 min 47 s of 25; 8 min 50 s of 20) until the first run, which the lead reads for all three jobs. `ci-split.md`.

### The README's C1-C3 rows (the lead's file)

- `artifacts/ai-control-plane-b24/README.md:21-23`: `deterministic-manufacturing.yml:340` -> `:378`, `:341` -> `:379`, `:342` -> `:380`
  (B24-D0's 38 `--exclude` lines at `:293-330`), each with a dated `[B24-D0, 2026-10-09]` note if the lead keeps notes in rows.

### The OWNER_DECISIONS.md:110 note (the lead's file)

- `OWNER_DECISIONS.md:110` (OD-30's A4 line) cites `deterministic-manufacturing.yml:303-306`; today `:374-377` (carried +32 by B24-B2, +1
  by B24-B3, +38 by B24-D0). A dated note there is the lead's choice; D0 wrote none.

### The guard's line citations in the lead's files

- [B24-D0, 2026-10-09] `artifacts/ai-control-plane-b24/discovery.md:977` and `artifacts/ai-control-plane-b24/discovery.md:1569` cite `b19-e-ci-job-scope.test.ts:148-153` (the [B20 A0] chapter case): on this tree `:150-155` (B24-D0's in-case notes added one line to case 1 and one to [B19-E E3] above it; the helpers sit after the describe block).
- [B24-D0, 2026-10-09] `artifacts/ai-control-plane-b24/discovery.md:986` and `artifacts/ai-control-plane-b24/discovery.md:1436` cite `b19-e-ci-job-scope.test.ts:96-99` (case 1's first four lines: unchanged) and `:148-154` (the chapter case): on this tree `:150-156`.
- [B24-D0, 2026-10-09] `artifacts/ai-control-plane-b22/discovery.md:843` cites `b19-e-ci-job-scope.test.ts:228-234` ([SEC-1]): on this tree `:238-245` (the case gained its exclusion check).
- [B24-D0, 2026-10-09] `artifacts/ai-control-plane-b22/discovery.md:1327` cites `b19-e-ci-job-scope.test.ts:152` (the chapter case's "suites exist" expectation) and `:228-234` ([SEC-1]): on this tree `:154` and `:238-245`.
- [B24-D0, 2026-10-09] `artifacts/ai-control-plane-b20/discovery.md:142` cites `b19-e-ci-job-scope.test.ts:20-148` (`jobFilters` to the chapter case): on this tree `:20-150`.

### The evidence file's hostname attribute

- [B24-D0, 2026-10-09] `artifacts/ai-control-plane-b24/evidence/d0-ptg-timing.xml` carries vitest's junit `hostname="<name>"` attribute on each of its 471 `<testsuite>` elements - the measuring machine's name, the one value in the file; no path, user name or secret (0 hits for the user's folder or `/Users/`; the 33 `<system-out>`/`<system-err>` blocks hold console text such as a refused database connection, read); no scanner rule covers a hostname (`app/lib/deployment/secret-scan.ts:34`). The owner's choice, recorded by the lead: (a) commit the file as measured (this run's rule: byte-identical, sha256 `d7c515c7ba984fa69c86f33f3b09bcac1680ea44140b032b343ed6c74c52c0d7`), or (b) scrub the attribute before the commit - `sed -i 's/hostname="<name>"/hostname="local"/g' artifacts/ai-control-plane-b24/evidence/d0-ptg-timing.xml` - which keeps the 2,091,656 bytes (sha256 `19d56fd7b4694fd030eb4172fc8a13f7fdf109461bb5af98b800d167db226b9d`, computed in the scratchpad on a copy); `b24-d0-ci-split` 1 never reads the attribute and case 12 wants one value recorded in section 8, so after a scrub the section 8 note changes `hostname="<name>"` to `hostname="local"` in place and the suite stays green. D0 wrote neither.
- [B24-D0 lead, 2026-10-09] Option (b) applied: the attribute is `hostname="local"` on all 471 elements; sha256 `19d56fd7b4694fd030eb4172fc8a13f7fdf109461bb5af98b800d167db226b9d`; the measurement figures are unchanged (the attribute carries no time); the machine's name is spelled nowhere on this page.

### The merge gate

- [B24-D0, 2026-10-09] No job of either workflow `needs:` another, and the tree records no required-status-check list (nothing in README, OWNER_DECISIONS.md, the B20-B24 pages or `.github`), so nothing ties a red `agent-boundary-suites` to any other job and a list configured by job name would not include it until someone adds it; the 109 moved files - the route-policy and CSRF pins (`b20-b2-mcp-route-policy`, `b20-b2-route-matrices-pinned`, `b16-0-1-ci-gates`, `b16-0-2-gates`, `b16-0-auth-route-coverage`, `b16-0-8-migration-ratchet`), the agent boundary and no-execution suites (`b09-1-boundary`, `b11-4-no-execution`, `b11-5-capture-exactness`, `b11-7-primitive-discipline`) and the whole `app/lib/mcp` tree - now fail only there. Before the first pull request with the split merges, the lead confirms that any required-status-check list on `main` names `agent-boundary-suites` beside `prompt-to-gerber` (or that the workflow's overall status is what gates the merge) and adds the job where a list exists by name; the branch-protection configuration is not readable from the tree (INFERRED; section 8 keeps it open until confirmed).

### The local production-mode run

- None needed: D0 changed no module the Next application imports (`golden-catalog.ts` and `scenario-map.ts` are read by the two
  generators and the test suites only; `b24-b1-catalog` 10). The first CI run after the push is the measurement OD-30 waits for.

## 10. Citations

| id | file | line | anchor |
|---|---|---|---|
| C1 | `.github/workflows/deterministic-manufacturing.yml` | 26 | `timeout-minutes: 25` |
| C2 | `.github/workflows/deterministic-manufacturing.yml` | 331 | `--reporter=dot --reporter=junit --outputFile=vitest-deterministic-manufacturing.xml` |
| C3 | `.github/workflows/deterministic-manufacturing.yml` | 227 | `app/lib/manufacturing-providers/__tests__` |
| C4 | `.github/workflows/deterministic-manufacturing.yml` | 131 | `app/lib/mcp` |
| C5 | `.github/workflows/deterministic-manufacturing.yml` | 228 | `app/lib/qualification/__tests__` |
| C6 | `.github/workflows/deterministic-manufacturing.yml` | 132 | `app/lib/agent/orchestration/__tests__` |
| C7 | `.github/workflows/deterministic-manufacturing.yml` | 226 | `app/lib/computation/__tests__` |
| C8 | `.github/workflows/deterministic-manufacturing.yml` | 293 | `--exclude 'app/lib/project/__tests__/b18-b-import-gates.test.ts'` |
| C9 | `.github/workflows/deterministic-manufacturing.yml` | 295 | `--exclude 'app/lib/mcp/**'` |
| C10 | `.github/workflows/deterministic-manufacturing.yml` | 301 | `--exclude 'app/lib/computation/__tests__/**'` |
| C11 | `.github/workflows/deterministic-manufacturing.yml` | 330 | `--exclude 'app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts'` |
| C12 | `.github/workflows/deterministic-manufacturing.yml` | 555 | `agent-boundary-suites:` |
| C13 | `.github/workflows/deterministic-manufacturing.yml` | 608 | `--outputFile=vitest-agent-boundary-suites.xml` |
| C14 | `.github/workflows/deterministic-manufacturing.yml` | 613 | `name: agent-boundary-suites-diagnostics` |
| C15 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 253 | `it("[B24-D0, 2026-10-09] OD-30's split:` |
| C16 | `app/lib/qualification/__tests__/_ci-admission.ts` | 100 | `function foldedVitestStep(lines: readonly string[], key: string, file: string): FoldedStep {` |
| C17 | `app/lib/qualification/__tests__/_ci-admission.ts` | 216 | `const runs = (step: FoldedStep, path: string): boolean =>` |
| C18 | `app/lib/evaluation/golden-catalog.ts` | 83 | `export const CATALOG_CI_JOBS = ["prompt-to-gerber", "database-delivery", "benchmark-core", "benchmark-nightly", "page-browser-e2e", "agent-boundary-suites"] as const;` |
| C19 | `app/lib/evaluation/golden-catalog.ts` | 86 | `export const PULL_REQUEST_CI_JOBS: readonly CatalogCiJob[] = Object.freeze(["prompt-to-gerber", "database-delivery", "benchmark-core", "page-browser-e2e", "agent-boundary-suites"]);` |
| C20 | `app/lib/evaluation/scenario-map.ts` | 86 | `const AGENT_BOUNDARY = ["agent-boundary-suites"];` |
| C21 | `app/lib/evaluation/scenario-map.ts` | 402 | `export function recordedCiJobsOf(rows: readonly ScenarioRow[]): (path: string) => readonly string[] {` |
| C22 | `app/lib/qualification/__tests__/b24-b2-ci-admission.test.ts` | 146 | `const runsIn = (path: string)` |
| C23 | `app/lib/qualification/__tests__/b24-b1-catalog.test.ts` | 293 | `CI_ADMISSION_ANCHORS.agentBoundary]` |
| C24 | `app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts` | 643 | `expect(insertionRowsOf(planned.page)).toHaveLength(15);` |
| C25 | `app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts` | 187 | `const last = all.indexOf("  secret-scan:");` |
| C26 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md` | 104 | `## OD-30 — CI time (B18-E, 2026-09-11)` |
| C27 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md` | 112 | `- [B24-C2 lead, 2026-10-09] B24-C1's CI run (37872711743 at` |
| C28 | `artifacts/ai-control-plane-b24/environments-and-deployment.md` | 395 | `[B24-D0, 2026-10-09] \| agent-boundary-suites \|` |
| C29 | `artifacts/ai-control-plane-b24/ci-admission.md` | 189 | `an estimate over 20 minutes would have sent the 36 suites to a new` |
| C30 | `app/lib/evaluation/live-suites.ts` | 88 | `path: "app/api/pcb/edit/__tests__/assist-live.test.ts",` |
| C31 | `artifacts/ai-control-plane-b21/evaluation-matrix.md` | 1139 | `\| C49 \|` |
| C32 | `artifacts/ai-control-plane-b23/dfm-quote-flow.md` | 537 | `\| C64 \|` |
| C33 | `artifacts/ai-control-plane-b21/orchestration-contracts.md` | 344 | `\| 9 \| 9 + 1 per chapter \|` |
| C34 | `app/lib/agent/orchestration/__tests__/b21-a-page.test.ts` | 89 | `it("4. every suite row names a file that exists with the` |
| C35 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 275 | `function jobExcludes(job: string): string[] {` |
| C36 | `artifacts/ai-control-plane-b24/ci-admission.md` | 85 | `b19-e-ci-job-scope.test.ts:247-251` |
| C37 | `artifacts/ai-control-plane-b24/ci-admission.md` | 92 | `b19-e-ci-job-scope.test.ts:107-125` |
| C38 | `artifacts/ai-control-plane-b20/mcp-client-boundary.md` | 41 | `:150-194` |
| C39 | `app/lib/qualification/__tests__/b24-b2-ci-admission.test.ts` | 19 | `b19-e-ci-job-scope.test.ts:107-125; [B24-D0, 2026-10-09] was :106-124` |
| C40 | `app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts` | 183 | `it("(c) the CI job: secret-scan follows production-smoke and precedes the appended agent-boundary-suites` |
| C41 | `artifacts/ai-control-plane-b24/ci-admission.md` | 83 | `superseded in part: 25 of these` |
| C42 | `artifacts/ai-control-plane-b24/ci-admission.md` | 362 | `superseded in part:` |
| C43 | `artifacts/ai-control-plane-b24/ci-admission.md` | 364 | `superseded: the route finalization suite (` |
| C44 | `artifacts/ai-control-plane-b24/ci-admission.md` | 365 | `superseded: excluded at` |
| C45 | `artifacts/ai-control-plane-b24/observability-and-replay.md` | 526 | `deterministic-manufacturing.yml:378` |
| C46 | `artifacts/ai-control-plane-b24/observability-and-replay.md` | 1336 | `deterministic-manufacturing.yml:380` |
| C47 | `artifacts/ai-control-plane-b24/retention-and-deletion.md` | 274 | `deterministic-manufacturing.yml:379` |
| C48 | `app/lib/qualification/__tests__/b24-d0-ci-split.test.ts` | 590 | `it("12. [B24-D0 review, 2026-10-09] the review round` |
| C49 | `app/lib/deployment/secret-scan.ts` | 34 | `export const SECRET_SCAN_RULES: readonly SecretScanRule[] = Object.freeze([` |
| C50 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 95 | `describe("[B19-E E2 review] CI job scope", () => {` |
