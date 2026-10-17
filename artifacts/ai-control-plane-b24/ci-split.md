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
  lines inserted before prompt-to-gerber's `--reporter` line (`deterministic-manufacturing.yml:293-330`; [B24-D1, 2026-10-09] now `:294-331` after B24-D1's prompt-to-gerber start step at `:32`; C8-C11; the `--reporter`
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
to the line before `--reporter`, `deterministic-manufacturing.yml:52-292` ([B24-D1, 2026-10-09] now `:53-293`); the line `app/api/pcb/qualify app/api/pcb/release` splits as
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
| `:99` | `app/lib/project/__tests__/b18-b-import-gates.test.ts` | 1 | 29.52 | 3.2 % |
| `:126` | `app/lib/distributors/__tests__/b19-distributor-egress.test.ts` | 1 | 2.63 | 0.3 % |
| `:132` | `app/lib/mcp` | 45 | 181.28 | 19.5 % |
| `:137` | `app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts` | 1 | 3.94 | 0.4 % |
| `:139` | `app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts` | 1 | 5.29 | 0.6 % |
| `:155` | `app/lib/distributors/__tests__/b19-connector-policy.test.ts` | 1 | 5.58 | 0.6 % |
| `:162` | `app/lib/distributors/__tests__/b19-d-exact-mpn-connectors.test.ts` | 1 | 3.50 | 0.4 % |
| `:208` | `app/components/parts/__tests__/b19-e-atomic-publication-panel.test.tsx` | 1 | 2.31 | 0.2 % |
| `:227` | `app/lib/computation/__tests__` | 28 | 51.02 | 5.5 % |
| `:230` | `app/lib/engineering/__tests__/b18-e-lost-settlement.test.ts` | 1 | 10.39 | 1.1 % |
| `:253` | `app/lib/engineering/__tests__/b18-c-result-contract.test.ts` | 1 | 2.27 | 0.2 % |
| `:255` | `app/lib/engineering/__tests__/b18-c-review-3.test.ts` | 1 | 5.34 | 0.6 % |
| `:256` | `app/lib/engineering/__tests__/b18-c-review-fixes.test.ts` | 1 | 2.04 | 0.2 % |
| `:261` | `app/lib/agent/__tests__/b09-1-boundary.test.ts` | 1 | 0.67 | 0.1 % |
| `:262` | `app/lib/agent/__tests__/b09-1-recovery.test.tsx` | 1 | 0.00 | 0.0 % |
| `:263` | `app/lib/agent/__tests__/b09-2-closure.test.ts` | 1 | 0.12 | 0.0 % |
| `:264` | `app/lib/agent/__tests__/b09-2-recovery.test.tsx` | 1 | 0.00 | 0.0 % |
| `:265` | `app/lib/agent/__tests__/b09-3-closure.test.ts` | 1 | 0.24 | 0.0 % |
| `:267` | `app/lib/agent/__tests__/b09-proposals.test.ts` | 1 | 0.07 | 0.0 % |
| `:268` | `app/lib/agent/__tests__/b09-provider-contracts.test.ts` | 1 | 0.00 | 0.0 % |
| `:269` | `app/lib/agent/__tests__/b10-1-strict-mode-publisher.test.tsx` | 1 | 0.03 | 0.0 % |
| `:270` | `app/lib/agent/__tests__/b10-editor-context.test.ts` | 1 | 0.12 | 0.0 % |
| `:271` | `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | 1 | 0.77 | 0.1 % |
| `:272` | `app/lib/agent/__tests__/b11-2-replay-context.test.ts` | 1 | 1.01 | 0.1 % |
| `:273` | `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | 1 | 24.90 | 2.7 % |
| `:274` | `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts` | 1 | 0.98 | 0.1 % |
| `:275` | `app/lib/agent/__tests__/b11-4-no-execution.test.ts` | 1 | 0.46 | 0.0 % |
| `:276` | `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | 1 | 1.01 | 0.1 % |
| `:277` | `app/lib/agent/__tests__/b11-6-projection-ownership.test.ts` | 1 | 0.59 | 0.1 % |
| `:278` | `app/lib/agent/__tests__/b11-7-primitive-discipline.test.ts` | 1 | 0.60 | 0.1 % |
| `:280` | `app/api/chat/__tests__/b10-1-request-boundary.test.ts` | 1 | 0.03 | 0.0 % |
| `:281` | `app/api/chat/__tests__/b10-2-closure.test.ts` | 1 | 0.12 | 0.0 % |
| `:282` | `app/api/chat/__tests__/b10-chat-boundary.test.ts` | 1 | 0.09 | 0.0 % |
| `:283` | `app/api/chat/__tests__/b11-1-route-finalization.test.ts` | 1 | 0.15 | 0.0 % |
| `:284` | `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | 1 | 33.50 | 3.6 % |
| `:285` | `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | 1 | 27.43 | 2.9 % |
| `:286` | `app/api/__tests__/b16-0-auth-route-coverage.test.ts` | 1 | 0.02 | 0.0 % |
| `:287` | `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | 1 | 0.80 | 0.1 % |

The moved set: **398.84 s** of the measured 931.21 s (42.8 %), 109 files, 38 items - the task's "at least 40 %" holds [B24-D1, 2026-10-09] the first column (each item's positional line in prompt-to-gerber) moved +1 after B24-D1's prompt-to-gerber start step at `:32`; `b24-d0-ci-split` 8 derives it from the tree.
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

**The new job** (`deterministic-manufacturing.yml:551-616`; [B24-D1, 2026-10-09] the block is `:557-625` after B24-D1's OD-30 steps: every number in this paragraph moves +6 up to `:558` and +7 from `:559` on, the job's start step sits at `:565` after `steps:` and its headroom step at `:624-625`; [B24-D4, 2026-10-10] now `:560-628`, its start step at `:568`, its headroom step at `:627-628`: +1 after B24-D2's entry at `:384`, +2 after B24-D4's `env:` mapping at `:418-419`): one blank line (`:551`), three `  # [B24-D0]` comment lines
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
`:340` -> `:378` (`retention-and-deletion.md:184`); B24-A4's two workflow lines, which no earlier task had moved (the first run's open [B24-closeout, 2026-10-10] superseded: B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305.
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
  in `prompt-to-gerber` (workflow `:226` ...)" - the line stays at `:226`, prompt-to-gerber excludes it (`:301`) and the suites run in ([B24-D1, 2026-10-09] `:227` and `:302` after B24-D1's prompt-to-gerber start step at `:32`)
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
| C2 | `.github/workflows/deterministic-manufacturing.yml` | 332 | `--reporter=dot --reporter=junit --outputFile=vitest-deterministic-manufacturing.xml` |
| C3 | `.github/workflows/deterministic-manufacturing.yml` | 228 | `app/lib/manufacturing-providers/__tests__` |
| C4 | `.github/workflows/deterministic-manufacturing.yml` | 132 | `app/lib/mcp` |
| C5 | `.github/workflows/deterministic-manufacturing.yml` | 229 | `app/lib/qualification/__tests__` |
| C6 | `.github/workflows/deterministic-manufacturing.yml` | 133 | `app/lib/agent/orchestration/__tests__` |
| C7 | `.github/workflows/deterministic-manufacturing.yml` | 227 | `app/lib/computation/__tests__` |
| C8 | `.github/workflows/deterministic-manufacturing.yml` | 294 | `--exclude 'app/lib/project/__tests__/b18-b-import-gates.test.ts'` |
| C9 | `.github/workflows/deterministic-manufacturing.yml` | 296 | `--exclude 'app/lib/mcp/**'` |
| C10 | `.github/workflows/deterministic-manufacturing.yml` | 302 | `--exclude 'app/lib/computation/__tests__/**'` |
| C11 | `.github/workflows/deterministic-manufacturing.yml` | 331 | `--exclude 'app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts'` |
| C12 | `.github/workflows/deterministic-manufacturing.yml` | 564 | `agent-boundary-suites:` |
| C13 | `.github/workflows/deterministic-manufacturing.yml` | 618 | `--outputFile=vitest-agent-boundary-suites.xml` |
| C14 | `.github/workflows/deterministic-manufacturing.yml` | 623 | `name: agent-boundary-suites-diagnostics` |
| C15 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 253 | `it("[B24-D0, 2026-10-09] OD-30's split:` |
| C16 | `app/lib/qualification/__tests__/_ci-admission.ts` | 101 | `function foldedVitestStep(lines: readonly string[], key: string, file: string): FoldedStep {` |
| C17 | `app/lib/qualification/__tests__/_ci-admission.ts` | 220 | `const runs = (step: FoldedStep, path: string): boolean =>` |
| C18 | `app/lib/evaluation/golden-catalog.ts` | 83 | `export const CATALOG_CI_JOBS = ["prompt-to-gerber", "database-delivery", "benchmark-core", "benchmark-nightly", "page-browser-e2e", "agent-boundary-suites"] as const;` |
| C19 | `app/lib/evaluation/golden-catalog.ts` | 86 | `export const PULL_REQUEST_CI_JOBS: readonly CatalogCiJob[] = Object.freeze(["prompt-to-gerber", "database-delivery", "benchmark-core", "page-browser-e2e", "agent-boundary-suites"]);` |
| C20 | `app/lib/evaluation/scenario-map.ts` | 86 | `const AGENT_BOUNDARY = ["agent-boundary-suites"];` |
| C21 | `app/lib/evaluation/scenario-map.ts` | 402 | `export function recordedCiJobsOf(rows: readonly ScenarioRow[]): (path: string) => readonly string[] {` |
| C22 | `app/lib/qualification/__tests__/b24-b2-ci-admission.test.ts` | 146 | `const runsIn = (path: string)` |
| C23 | `app/lib/qualification/__tests__/b24-b1-catalog.test.ts` | 293 | `CI_ADMISSION_ANCHORS.agentBoundary]` |
| C24 | `app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts` | 643 | `expect(insertionRowsOf(planned.page)).toHaveLength(19);` |
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
| C48 | `app/lib/qualification/__tests__/b24-d0-ci-split.test.ts` | 607 | `it("12. [B24-D0 review, 2026-10-09] the review round` |
| C49 | `app/lib/deployment/secret-scan.ts` | 34 | `export const SECRET_SCAN_RULES: readonly SecretScanRule[] = Object.freeze([` |
| C50 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 95 | `describe("[B19-E E2 review] CI job scope", () => {` |

- [B24-D1 lead, 2026-10-09] C24's anchor re-pinned in place, `toHaveLength(15)` -> `toHaveLength(17)`: the lead's reviewed move of A1 case 16 after B24-D1's six insertion rows (A1 planned four groups for D1; lead decision D19 added agent-boundary-suites's two).

[B24-D1, 2026-10-09] C2-C14 re-pinned in place after B24-D1's OD-30 steps (prompt-to-gerber's start step at `:32`, +1 from `:32`; its headroom step at `:344-345`, +2 more from `:343`; page-browser-e2e's start and headroom steps at `:405` and `:432-433`, +1 and +2 more from `:402` and `:428`; agent-boundary-suites's start step at `:565`, +1 more from `:559`); C45-C47 stand on their lines, which keep their text with a dated note. [B24-D1, 2026-10-09] C16 and C17 re-pinned 100 -> 101 and 216 -> 220 (`_ci-admission.ts` gained the benchmark-latency job's id, anchor, filter, env and jobsOf lines before them); C48 re-pinned 590 -> 607 (the dated pin moves in cases 1, 5, 7, 10 and 11 of this suite, above case 12). [B24-D2, 2026-10-09] C12-C14 re-pinned +1 in place after B24-D2's database-delivery entry at `:384` (the rows carry no note cell; this line holds the note). [B24-D4, 2026-10-10] C12-C14 re-pinned +2 in place after B24-D4's `env:` mapping at `:418-419` (OD-30's split of page-browser-e2e, section 11); C24's anchor re-pinned in place, `toHaveLength(17)` -> `toHaveLength(19)` (A1 case 16 after B24-D4's two insertion rows).

## 11. B24-D4 - the OD-30 split of page-browser-e2e

### 11.0 What B24-D4 is

The lead's corrective increment under OD-30 (one workflow run, one commit by the lead), on `chapter/b24-production-qualification`
from `1fe719e`. It closes no new defect and writes no OD entry and no LB row. Its first run (wf_9abf9eb9-813) stopped before any
lasting edit: `SIRKIT_E2E_SKIP` on `playwright.config.ts:21` is a new `SIRKIT_` name in a root config, and B24-A1's flag census
(`b24-a1-flags` 2) wants an inventory row for it. The lead chose option A (2026-10-10): the no-production-change rule is relaxed for
the split exactly to the two inventory data modules, one row each. This second run did, test-first:

- **Part 1**, B24-D3's two CI reds (run 38061798204 on `1fe719e`), both functional and both fixed in the product: `multi-tab` case
  2's silent overwrite of another tab's working copy (D24-30; `performance-and-reliability.md` section 29) and `keyboard-and-focus`
  case 4's focus on `body` after Escape on the Tier 1 card (D24-32; `accessibility.md` sections 4, 7 and 12). Neither is called a
  flake.
- **Part 2**, the split, by insertions only: B24-D3's two specs (`e2e/keyboard-and-focus.spec.ts`, 5 cases;
  `e2e/minimum-width.spec.ts`, 3 cases) leave `page-browser-e2e` for an appended job, `page-browser-e2e-b24`. [B24-D4 lead, 2026-10-10] With them, by the lead's option (b) of section 11.9, B24-D2's two specs (`e2e/multi-tab.spec.ts`, 3 cases; `e2e/crash-recovery.spec.ts`, 2 cases), so that page-browser-e2e keeps OD-30's five minutes (section 11.4); the job, drafted as `page-browser-e2e-accessibility`, is renamed `page-browser-e2e-b24` for B24's own browser specs. No
  `timeout-minutes` is raised, no job removed, no workflow line removed, reordered or edited.

Counts unchanged at `1fe719e` and after (the pinned suites green both times, section 11.7): census
168 = 165 canonical + 3 factories + 0 raw, agent tools 48 / 37 / 9 / 28, 107 action records, 32 migrations. **CONFIRMED** by execution.

### 11.1 The measurement

- B24-D2's run (38049453257 on `3773c6a`): page-browser-e2e 21 min 46 s of 30, its OD-30 headroom step 8 min 23 s. **RECORDED**
  (the lead's reading).
- B24-D3's run (38061798204 on `1fe719e`): page-browser-e2e 27 min 40 s of 30; its headroom step printed "headroom 2 min 20 s:
  split_required (OD30_SPLIT_REQUIRED)"; 64 passed, 2 failed, 2 did not run. **CONFIRMED** by reading the log the lead saved
  (`b24/logs/ci-d3-page-browser.clean.log`, its last step). The orchestration step did not run on that run (a failing step stops
  the steps after it), so 27 min 40 s holds no orchestration time.
- The ratio: CI ran `agent-execution.spec.ts` in 750 s against 171 s on this machine (the lead's figures), about 4.4.
- The setup, from the log's step timestamps: the start step at 14:59:37, `pnpm exec playwright test` at 15:00:33 (56 s of checkout,
  pnpm, node, install and browser install), the upload at 15:27:12. **CONFIRMED** by reading.
- The two specs on this machine (B24-D3's lead runs): `keyboard-and-focus` about 111 s, `minimum-width` about 2 s. **RECORDED**.
- The two specs on D3's CI run, as the log reports them (partial: `keyboard-and-focus` 4 failed and its case 5 did not run):
  `keyboard-and-focus` 1-4 took 2.2 m, 4.8 s, 1.1 m and 1.4 m; `minimum-width` 1-3 took 117 ms, 2.6 s and 2.0 s. **CONFIRMED** by
  reading; [B24-D4 review, 2026-10-10] page-browser-e2e's input in section 11.4 (was: a cross-check only). The log's own count:
  "Running 68 tests using 1 worker", 60 outside the two specs and 8 in them.
- [B24-D4 review, 2026-10-10] B24-D2's run, per spec (the lead's saved log `b24/logs/ci-d2-page-browser.clean.log`; its test step
  "56 passed (20.3m)"): `crash-recovery` 21.6 s ((a) failed, (b) did not run), `multi-tab` 1.9 m and 1.1 m (case 2 failed, case 3
  did not run). Neither D2's run nor D3's reached the orchestration step (it has no `if: always()`; a failing step stops the steps
  after it). B24-C2's run (21 min 15 s of 30, the lead's reading, section 4) did run it, with every spec but those two: between
  `600d1ba` and `3773c6a` only `e2e/crash-recovery.spec.ts` and `e2e/multi-tab.spec.ts` were added (`git diff --stat`).
  **CONFIRMED** by reading.
- [B24-D4 lead, 2026-10-10] B24-D2's two specs on D3's run, as its log reports them (the lead's saved log, read again for option (b)):
  `multi-tab` 1 and 2 took 1.6 m and 1.2 m (case 2 failed, case 3 did not run); `crash-recovery` (a) and (b) took 22.6 s and 25.6 s
  (both passed). The log's 68 tests by spec: 13 in the four moved specs (`multi-tab` 3, `crash-recovery` 2, `keyboard-and-focus` 5,
  `minimum-width` 3) and 55 outside them. **CONFIRMED** by reading.

### 11.2 The split: before and after

| job | at `1fe719e` | after B24-D4 | limit |
|---|---|---|---|
| `page-browser-e2e` | every `e2e/*.spec.ts` (9 files, 69 cases), then the orchestration step | [B24-D4 lead, 2026-10-10] 5 files (56 cases by the probe's count, 55 by CI's): the same step, with `SIRKIT_E2E_SKIP` naming the four moved specs (was: 7 files, 61 cases, the two); the orchestration step unchanged | 30 min (unchanged) |
| `page-browser-e2e-b24` | (none) | [B24-D4 lead, 2026-10-10] `e2e/multi-tab.spec.ts`, `e2e/crash-recovery.spec.ts`, `e2e/keyboard-and-focus.spec.ts` and `e2e/minimum-width.spec.ts` (4 files, 13 cases; was B24-D3's two, 8 cases, in the job drafted as `page-browser-e2e-accessibility`, renamed) | 20 min (new) |

The case counts are the lead's scratch-config probe (`--list` only; 2026-10-10); on the real config they are the lead's `--list`
run at close, **INFERRED** until then (section 11.9). [B24-D4 review, 2026-10-10] CI's run at `1fe719e` listed 68 tests, 60 outside
the two specs and 8 in them (section 11.1): one fewer than the probe's 69 / 61 outside the two specs (section 11.8). The new job runs no database, secret or live resource; `CI: "true"` as
page-browser-e2e; its own artifact name (`page-browser-e2e-b24-report`); B24-D1's start step first and headroom step
last. Every catalog link and scenario-map path stays where it was: neither moved spec is a link of `golden-catalog.ts` or a path of
`scenario-map.ts`, so `CATALOG_CI_JOBS` and both generators are unchanged (zero drift, section 11.7). [B24-D4 lead, 2026-10-10]
Option (b) moves B24-D2's two specs as well; by CI's count at `1fe719e` the four hold 13 cases and page-browser-e2e keeps 55 (the
probe's count: 56), **INFERRED** for the real config until the lead's `--list` at close. Neither of B24-D2's two is a catalog link
or a scenario-map path either: both modules link only `e2e/agent-execution.spec.ts`, `e2e/semantic-editor.spec.ts`,
`e2e/prompt-to-gerber.spec.ts` and the orchestration spec (re-read 2026-10-10), so no link and no `CATALOG_CI_JOBS` entry moves.

### 11.3 The mechanism, and why it is insertion-only

- `playwright.config.ts:21`, edited in place (the config keeps its 71 lines and the line still starts with its `testMatch`):
  `testIgnore: (process.env.SIRKIT_E2E_SKIP ?? "").split(",").map((glob) => glob.trim()).filter(Boolean),` and a dated
  `[B24-D4, 2026-10-10]` comment. Unset or empty, the list is empty and Playwright ignores nothing (its default). The orchestration
  config takes the base's web server, timeout and `use`, never its `testIgnore`; it is untouched (byte-identical to `1fe719e`).
- In page-browser-e2e, an `env:` mapping inserted under the existing `- run: pnpm exec playwright test` step (`:417`, its line not
  edited): `:418-419`, `SIRKIT_E2E_SKIP: "**/multi-tab.spec.ts,**/crash-recovery.spec.ts,**/keyboard-and-focus.spec.ts,**/minimum-width.spec.ts"`
  ([B24-D4 lead, 2026-10-10] option (b): the four (the run line lists B24-D2's two first; Playwright runs the files in name order: crash-recovery, keyboard-and-focus, minimum-width, multi-tab); was the two). The orchestration step after it
  does not see the variable (a step-level env).
- `page-browser-e2e-b24` appended at the end (`:629-663`: one blank line, three `[B24-D4]` comment lines, the job), after
  `agent-boundary-suites`, as B24-A2's `secret-scan` and B24-D0's `agent-boundary-suites` were appended. Its run step is named
  (`- name:` then `run: pnpm exec playwright test e2e/multi-tab.spec.ts e2e/crash-recovery.spec.ts e2e/keyboard-and-focus.spec.ts e2e/minimum-width.spec.ts`), as B21-F2's
  orchestration step is, so no line of the job holds B21's C49 anchor (`- run: pnpm exec playwright test`, which `b21-f-page` 6 wants
  exactly once). [B24-D4 lead, 2026-10-10] Option (b) and the rename changed only D4's own lines: the skip value (`:419`), two of the
  comment lines (`:631-632`), the key (`:633`), the start step's comment (`:639`), the run step's name and line (`:650-651`), the
  upload step's name (`:652`, `Upload browser evidence (B24's specs)`), the artifact name (`:656`, `page-browser-e2e-b24-report`)
  and the headroom step's comment and argument (`:662-663`); the line count is unchanged and the workflow without D4's 37 lines is
  still `1fe719e`'s byte for byte (`b24-d4-browser-split` 5).
- Option A's two rows, each appended on the line of `SIRKIT_E2E_PORT` (no line of either module moves): `flag-inventory.ts:65`,
  `{ name: "SIRKIT_E2E_SKIP", kind: "tooling", default: "unset (ignores nothing)", direction: "disables", owner:
  "playwright.config.ts:21", constant: null, rule: { parse: "list" } }`, and `environment-names.ts:137`,
  `undeclared("SIRKIT_E2E_SKIP", "platform", "playwright.config.ts", ...)`. The direction is `disables` (the module's own definition,
  `flag-inventory.ts:16`: it can only take specs out of a run; no guard constrains a tooling row's direction, `b24-a1-flags` 3 and 5
  read only the flag kinds). The rule is `{ parse: "list" }`, the closed parse that describes the reader exactly (split on commas,
  trim, drop blanks); non-flag rows use a closed parse where one fits (the live-test gates' exact "1") and `VALUE` only where none
  does (a JSON role table, a port), and `configuration.ts:72, :173` evaluates rules for the flag kinds alone, so the choice has no
  runtime effect: a tooling row stays out of the deployment configuration's record (`b24-d4-browser-split` 6).
- Why insertions only: B24-A1's shift and insertion tables model insertions only (`b24-a1-environment-profile` 14, 16, 17), and
  every page that cites a workflow line keeps working through the insertion rows. The guard proves it by hash: the workflow without
  B24-D4's 37 lines is `1fe719e`'s byte for byte, and `playwright.config.ts` with line 21 restored is `1fe719e`'s
  (`b24-d4-browser-split` 4, 5). Why an environment variable: a `--grep-invert` would edit the step's line, and a second Playwright
  project or a file read would add config lines, which pages cite by line (the first run's options B and C).

### 11.4 The OD-30 arithmetic

All **INFERRED** until CI's first run of the split. Each job takes the figure that is conservative for it. [B24-D4 review, 2026-10-10]
security-1: the first draft subtracted the ratio's larger share from page-browser-e2e, which flattered the job left behind, and left
the orchestration step out of its total; both are corrected here, and the result is not the one the first draft promised.
[B24-D4 lead, 2026-10-10] On the review's figures the two-spec split left page-browser-e2e about 25 min 39 s of 30, a headroom of
about 4 min 21 s, under OD-30's five minutes (its headroom step would have printed `split_required` and exited 1). The lead chose
option (b) of section 11.9: B24-D2's two specs move too. The figures below are for the four; `b24-d4-browser-split` 7 computes each
from the measured figures and requires both headrooms to be at least OD-30's five minutes.

- CI's ratio, `agent-execution.spec.ts`'s 750 s against 171 s locally: ratio 4.39. B24-D3's two specs' share at it: 113 s x 4.39 = 8 min 16 s.
- B24-D3's two specs' measured share on D3's run (section 11.1; `keyboard-and-focus` 5 did not run): 286.8 s + 4.7 s = 4 min 52 s.
- [B24-D4 lead, 2026-10-10] B24-D2's two specs' measured share on D3's run (section 11.1; `multi-tab` 3 did not run): 168.0 s +
  48.2 s = 3 min 36 s. The four moved specs together: 4 min 52 s + 3 min 36 s = 8 min 28 s.
- The orchestration step, which neither D2's nor D3's run reached: about 2 min 51 s, from B24-C2's job (21 min 15 s with it) less
  D2's job (21 min 46 s) without the two specs D2 added (`crash-recovery` 21.6 s, `multi-tab` 180.0 s on D2's run), the other specs
  taken as equal on both runs (run-to-run noise: `agent-execution.spec.ts` took 750 s on D2's run and 779 s on D3's, about 30 s).
- `multi-tab` case 3, which did not run on D3's run: 1 ms to 25 ms in every local run, about 0 s ([B24-D4 lead, 2026-10-10] it
  moves with its spec to page-browser-e2e-b24).
- page-browser-e2e: 27 min 40 s - 8 min 28 s + 2 min 51 s = 22 min 03 s of 30, a headroom of 7 min 57 s, **INFERRED**: at least OD-30's five minutes, so on these figures its headroom step would print `ok`. [B24-D4 lead, 2026-10-10] Was, for B24-D3's two
  alone: 27 min 40 s - 4 min 52 s + 2 min 51 s = 25 min 39 s of 30, a headroom of 4 min 21 s, under OD-30's five minutes
  (`split_required`); the lead's option (b) answers it.
- page-browser-e2e-b24: 56 s of setup + 8 min 16 s + 3 min 36 s = 12 min 48 s of 20, a headroom of 7 min 12 s, **INFERRED**: at least OD-30's five minutes, so its headroom step would print `ok` (the ratio's share for B24-D3's two, the larger figure, and
  B24-D2's two as measured on D3's run); plus the web server's first compile, which its first spec now pays, and
  `keyboard-and-focus` case 5, which did not run on D3's run (both **UNKNOWN**). [B24-D4 lead, 2026-10-10] Was, for B24-D3's two
  alone: 56 s of setup + 8 min 16 s = 9 min 12 s of 20.
- Not counted either way: `multi-tab` case 2 passing instead of failing (72 s failing on D3's run; 15 s to 26 s passing locally,
  about 66 s to 114 s at CI's ratio: [B24-D4 lead, 2026-10-10] up to about 42 s more for page-browser-e2e-b24, which keeps at
  least 6 min 30 s) and the worker restarts after D3's two failures; each is well under a minute.

### 11.5 Part 1: B24-D3's two CI reds

- **`multi-tab` case 2** (D24-30, OD-214): B's two arrow-key nudges are two serialized canonical commits and the working-copy
  autosave is debounced 600 ms; on CI's slower runner B saved its first nudge alone, a board equal to the one A had stored, and the
  "unchanged" rule kept A's write token as B's own, so B's second nudge was judged untouched and replaced A's copy silently. Fixed in
  place in `app/lib/pcb/board-persistence.ts` (a write equal to another tab's newer copy writes nothing and keeps the tab's base; a
  checkpoint-restore adoption takes only the copy page.tsx persisted). `b24-d2-working-copy` 9 and 10, red first on `1fe719e`
  (`d4r2-02-red-working-copy`), green after. The path on CI is **INFERRED** (it fits every field of CI's diagnostic line); the
  mechanism is **CONFIRMED** at the unit level. Every path ruled out, and the one not ruled out, are on
  `performance-and-reliability.md` section 29. [B24-D4 review, 2026-10-10] Three review findings, each red first
  (`d4fix-01-red-working-copy`: cases 11-13 and case 7's call-site check): the skip held a tab that loaded no copy out of every save
  once another tab had stored its very board, so such a tab now takes that copy for its own, as at `1fe719e` (`:255`,
  `known.boardJson !== null`; case 11); the restore adoption is told by the board the editor hands it, not by a missing token
  (`rememberStoredWorkingCopy(projectId, restoredBoard)`, `:261-262`; both call sites in place, `PcbEditor.tsx:602`, `:629`; case 7),
  so another tab's unchanged rewrite of the restored copy no longer locks the restoring tab out (case 12) and another tab's own
  token-less restore is never taken for the tab's own (case 13). Case 9 now compares A's whole stored copy, red under a planted write
  of the skip (`d4fix-02-mutation-skip-writes`, the source restored by sha256). Green: `d4fix-07-green-part1`.
- **`keyboard-and-focus` case 4** (D24-32, 2.4.3): focus fell to `body` after Escape on the Tier 1 card. Fixed in place in
  `app/components/pcb/GrantedExecutionDialog.tsx:55` (`finalFocus={promptFocus}`, declared at the end of the file): when the card
  closes by Escape, Cancel or Confirm, focus returns to the prompt. `b24-d3-bom-dialogs` 5, red first on `1fe719e`
  (`d4r2-04-red-card-focus`: focus on `body`), green after; case 4 now asserts focus on the prompt
  (`keyboard-and-focus.spec.ts:235`, a stricter assertion in place), **PROPOSED** until the lead's browser run. [B24-D4 review,
  2026-10-10] correctness-1: closed while the prompt is still disabled (the grant arrives mid-stream), the card fell back to Base
  UI's default, the last element an earlier popup recorded (the page's first control locally), where page.tsx's run-end return,
  which acts only from `body`, could not reach it. The card now moves no focus then (`promptFocus` returns `false`, `:125`, in
  place), so focus is on `body` until the run's end returns it to the prompt. `b24-d3-bom-dialogs` 6 runs page.tsx's run-end code
  over jsdom; red first on the D4 tree (`d4fix-03-red-card-focus`, `d4fix-06-red-card-focus-2`: focus on the page's first control),
  green after (`d4fix-07-green-part1`). **CONFIRMED** in jsdom; the browser path stays case 4's, **PROPOSED**.

### 11.6 The guards and the pins moved

`b24-d4-browser-split` (8 cases; [B24-D4 review, 2026-10-10] case 8 added, case 7's arithmetic corrected; [B24-D4 lead, 2026-10-10] cases 1, 2, 3, 7 and 8 strengthened in place for option (b) and the rename) is a new suite beside `b24-d0-ci-split` rather than cases inside it: D0's guard is cited by line on
this page (C48, `:607`) and its section 6 table pins it alone with its `it(` count, so a separate suite keeps every D0 line and row
in place and moves only D0's set-aside pattern and file count, as B24-D3's two suites did. `_ci-admission.ts` (a test helper)
reads the split from the files: `CI_JOB_IDS` gains `page-browser-e2e-b24` after `page-browser-e2e` (`:30`, in place); the
`pageBrowserB24` anchor (`:47`, in place; [B24-D4 lead, 2026-10-10] renamed with the job, and the derived list `browser.b24`); `testMatch` on `playwright.config.ts` is admitted only with the exact D4 suffix
(`:185`, `E2E_SKIP_SUFFIX`); `browserSplit` reads the skip list and the new job's arguments and refuses a malformed mapping, glob or
argument, a glob naming no spec, a missing or doubled run line or job key, and a disagreement (declared at the end of the file, so
C16 `:101` and C17 `:220` hold); `jobsOf` models both. Reviewed pin moves, each in place with a dated `[B24-D4, 2026-10-10]` note:

| suite or page | where | was | is |
|---|---|---|---|
| `b24-a1-flags` | 1 | the tooling list without it; 65 entries | + `SIRKIT_E2E_SKIP`; 66 |
| `b24-a2-env-names` | 5, 9, 10 | `platform` 11; 97 rows; 65 entries (D1's note 62 -> the size) | 12; 98 (`edge-security.md` section 5); 66 (D1's note held to 62 -> 65, D4's 65 -> 66 on A1's page section 3) |
| `b24-a2-headers` | 11 | (page only) | `edge-security.md`'s OD-195 draft lists `SIRKIT_E2E_SKIP` |
| `b24-a1-environment-profile` | 16 | 17 insertion rows | 19 |
| `b24-a2-secret-scan` | (c) | six job keys; two `playwright test` lines | seven; three (the title's tail retitled) |
| `b24-d0-ci-split` | 1, 4, 5, 7, 10, 11 | `b24-d[123]`; six keys and limits; the job ends the file; 483; seven later rows, the job to the end, `:558`; C93 `:420`, C94 `:429` | `b24-d[1234]`; seven; its own lines end where page-browser-e2e-b24's region begins; 484; nine, its own region, `:560`; `:422`, `:431` |
| `b24-d1-latency-policy` | 9, 10 | three jobs; two `playwright test` lines; six limits; four start steps | four jobs; three; seven; five |
| `b24-d1-threshold-census` | 4, 5 | no row for the new job; 305 rows | `ci.page-browser-e2e-b24.timeout-minutes` 20 min ([B24-D4 lead, 2026-10-10] renamed with the job; regenerated twice, zero drift); 306 (the CSV regenerated twice, zero drift on the second) |
| `b21-f-page` | 10 | two `playwright test` lines | the three exact lines (page-browser-e2e's two, the new job's one) |
| `evaluation-matrix.md` (B21) | C93, C94, C49 | `:420`, `:429` | `:422`, `:431`; C49 unmoved, with a note |
| this page | C12-C14, C24 | `:562`, `:616`, `:621`; `toHaveLength(17)` | `:564`, `:618`, `:623`; `toHaveLength(19)` |
| `accessibility.md` | C52; C67-C70 | the browser step admits both specs | superseded, noted; four rows added |
| `environments-and-deployment.md` | section 3; section 10 | 65 names, tooling (5); 17 rows | D4's notes; 19 rows (D4's two) |
| `edge-security.md` | section 5; section 13; `:317` | `platform` 11, 97 rows; the OD-195 list; two `playwright test` lines | 12, 98; + `SIRKIT_E2E_SKIP`; superseded, noted |
| `performance-and-reliability.md` | `:152`; section 18; section 29 | two `playwright test` lines; the unchanged rule; D2's record | superseded, noted; D4's notes; D3's CI record |
| [B24-D4 review] `performance-and-reliability.md` | `:151`; `:449`; sections 18, 29 | `:405`, `:432-433`, `:565`, `:624-625`; `:557-625`; the restore told by its token | a D4 note each: `:406`, `:435-436`, `:568`, `:627-628`; `:560-628`; told by its board, the review round's record |
| [B24-D4 review] this page | `:289` (section 4) | the job's block `:557-625`, start `:565`, headroom `:624-625` | a D4 note: `:560-628`, `:568`, `:627-628` |
| [B24-D4 review] `edge-security.md` | section 5, the row-total paragraph | D4's note inside the `SIRKIT_AUTH_MODE` sentence | before it, on the same first line (`b24-a2-env-names` 9 reads the total there) |
| [B24-D4 review] `accessibility.md` | sections 4, 7, 12; the 2.4.3 row; C68 | `: true` (Base UI's default) | `: false` (no focus move), case 6 |
| [B24-D4 review] `threshold-census.csv` | the two budget rows | `b24-d2-working-copy` 10, `b24-d3-bom-dialogs` 5 | 13, 6 (regenerated twice, zero drift on the second) |
| [B24-D4 lead] `b24-d4-browser-split` | `MOVED_SPECS`, `JOB`; 1, 2, 3, 7, 8 | B24-D3's two; the draft name; the two-spec arithmetic, under OD-30's five minutes required | the four (the run line lists B24-D2's two first; Playwright runs the files in name order: crash-recovery, keyboard-and-focus, minimum-width, multi-tab); `page-browser-e2e-b24`; the four-spec arithmetic, both jobs at least five minutes; case 8 checks the rename and D2's readers |
| [B24-D4 lead] the job's name | `_ci-admission.ts` (`:30`, `:47`, the browser split's field and messages); `b21-f-page` 10; `b24-a1-environment-profile` 16 (its note); `b24-a2-secret-scan` (c); `b24-d0-ci-split` 4, 5, 10; `b24-d1-latency-policy` 9, 10; `b24-d1-threshold-census` 4; `playwright.config.ts:21` (its note); `environment-names.ts:137` (its reason) | the draft name; the two specs | `page-browser-e2e-b24`; the four (`b21-f-page` 10's third line, `b24-a2-secret-scan` (c)'s note); `b24-d1-latency-policy` 9's upload label `Upload browser evidence (B24's specs)` |
| [B24-D4 lead] pages | `accessibility.md` C52, C70; `edge-security.md:317` ([PR-G, 2026-10-17] now `:320`, the three secret-scan allowlist rows PR-G added in its section 6 standing above it); `environments-and-deployment.md:370`, `:404`; `performance-and-reliability.md:152`, section 25 (`:1600`), section 27 (`:1759`), section 29 (`:1897`); B21's C49 | the draft name; page-browser-e2e as the CI job of B24-D2's two specs | `page-browser-e2e-b24`, each with a dated lead note (the A1 table row, whose shape is pinned, by the paragraph above it) |
| [B24-D4 lead] `threshold-census.csv` | the job's limit row | the draft name's row | `ci.page-browser-e2e-b24.timeout-minutes` (regenerated twice, zero drift on the second) |

Part 1's suites: `b24-d2-working-copy` (10; cases 9 and 10 added) and `b24-d3-bom-dialogs` (5 `it(` blocks, 17 cases; case 5
added). The browser spec `keyboard-and-focus.spec.ts:235` moved in place, stricter. [B24-D4 review, 2026-10-10] Now
`b24-d2-working-copy` 13 (cases 11-13 added; cases 7 and 9 strengthened in place) and `b24-d3-bom-dialogs` 6 `it(` blocks, 18 cases
(case 6 added); `PcbEditor.tsx:602` and `:629` pass the restored board, in place.

### 11.7 Test-first record and gates

Red first at `1fe719e`, every run through the lock: `b24-d2-working-copy` 2 failed of 10 (`d4r2-02-red-working-copy`: cases 9 and
10, B's second save and A's post-restore save returned `true`); `b24-d3-bom-dialogs` 1 failed of 17 (`d4r2-04-red-card-focus`:
case 5, focus on `body` after Escape); `b24-d4-browser-split` 7 failed of 7 (`d4r2-07-red-browser-split`: no job, no skip list, no
inventory row, no rows, no section; case 4 on line 21's reader, its invariants holding by design). The first run's counterexample
(`d4-01-counterexample-flags`) stands as the reason for option A. **CONFIRMED** by execution.

[B24-D4 review, 2026-10-10] The review round (eight confirmed findings), each red first through the lock: `b24-d2-working-copy` 4
failed of 13 (`d4fix-01-red-working-copy`: case 7's call-site check and cases 11-13); case 9's whole-copy comparison red under a
planted write of the skip (`d4fix-02-mutation-skip-writes`, 1 failed; the source restored, sha256 `28b6175b...` checked);
`b24-d3-bom-dialogs` 1 failed of 18 (`d4fix-03-red-card-focus`, and again on the case's final text with the D4 tree's `: true`
planted back, `d4fix-06-red-card-focus-2`, the source restored by sha256: focus on the page's first control); `b24-d4-browser-split`
2 failed of 8 (`d4fix-04-red-browser-split`: case 7 on the arithmetic, case 8 on `edge-security.md`'s paragraph). **CONFIRMED** by
execution.

[B24-D4 lead, 2026-10-10] The lead's option (b) and the rename, red first through the lock: `b24-d4-browser-split` 6 failed of 8 on the
D4 tree (`d4lead-01-red-browser-split`: case 1 on the job key, 2 on the skip list, 3 on the moved set, 5 on the insertion row's
job, 7 on B24-D2's measured share, 8 on eleven code files holding the draft name; cases 4 and 6 held), with every reader green
before any edit (`d4lead-00-baseline-readers`). **CONFIRMED** by execution.

| suite | `it(` blocks |
|---|---|
| `app/lib/qualification/__tests__/b24-d4-browser-split.test.ts` | 8 |
| `app/lib/qualification/__tests__/b24-d2-working-copy.test.ts` | 13 |
| `app/lib/qualification/__tests__/b24-d3-bom-dialogs.test.tsx` | 6 |

| gate | files | tests | exit |
|---|---|---|---|
| `b24-d2-working-copy` red at `1fe719e` (`d4r2-02-red-working-copy`) | 1 | 2 failed, 8 passed | 1 |
| `b24-d3-bom-dialogs` red at `1fe719e` (`d4r2-04-red-card-focus`) | 1 | 1 failed, 16 passed | 1 |
| `b24-d4-browser-split` red at `1fe719e` (`d4r2-07-red-browser-split`) | 1 | 7 failed | 1 |
| Part 1 green: `b24-d2-working-copy`, project-state, sync-authority, B12.5 activation, B18-E scenario 2 (`d4r2-03-green-working-copy`) | 5 | 53 passed, 1 skipped | 0 |
| Part 1 green: `b24-d3-bom-dialogs`, the B18-C and B18-D card suites, B18-B import gates, B17-A control inventory, `b24-d3-accessible-names`, action-registry (`d4r2-05-green-card-focus`) | 7 | 57 passed | 0 |
| `b24-d4-browser-split` and `b24-d0-ci-split` green over the page (`d4r2-17-guard-page`) | 2 | 19 passed | 0 |
| `app/lib/qualification/__tests__` (`d4r2-26-gate-qualification`) | 43 (+3 skipped) | 458 passed, 15 skipped | 0 |
| `app/lib/agent/orchestration/__tests__`: `b21-f-page`, `b21-closeout-statements` and every B21 page suite (`d4r2-18-gate-orchestration`) | 49 | 460 passed | 0 |
| `b19-e-ci-job-scope`, `b22-a1-page`, `b22-closeout-statements`, `b23-b-dfm-quote-flow-page`, `b23-closeout-statements`, the Part 1 readers, the count pins (`b16-1c-invariant-tripwires`, `b21-e1-result-tool`, `b23-a-tier3-vocabulary`, `b16-b-migrations`) and `b11-5-capture-exactness` (`d4r2-19-gate-readers`) | 19 | 176 passed, 1 skipped | 0 |
| the three closeout tripwires over the edited pages, again after the last page edit, with `b24-d4-browser-split`, `b24-d0-ci-split` and `b24-d3-accessible-names` (`d4r2-27-closeouts`) | 6 | 57 passed | 0 |
| `app/components`, `app/lib/project/__tests__` (`d4r2-20-gate-components-project`) | 71 | 448 passed, 1 skipped | 0 |
| `app/lib/engineering/__tests__` (`d4r2-21-gate-engineering`) | 99 | 1107 passed | 0 |
| the AST, import and process gates: `b16-0-1-ci-gates`, `b22-a2-process-census`, `b20-b2-import-gates`, `b20-b4-process-gate` (`d4r2-22-gate-ast`) | 4 | 39 passed | 0 |
| tsc `--noEmit -p tsconfig.json` (`d4r2-28-tsc`) | - | - | 0 |
| eslint on the 18 changed TypeScript files (`d4r2-29-eslint`) | 18 | 0 problems | 0 |
| `generate-b24-threshold-census`, twice (`d4r2-11`, `d4r2-12`): 305 -> 306 rows (the reviewed `ci.page-browser-e2e-accessibility.timeout-minutes` row, [B24-D4 lead, 2026-10-10] renamed `ci.page-browser-e2e-b24.timeout-minutes` with the job; budget counts `b24-d2-working-copy` 8 -> 10, `b24-d3-bom-dialogs` 4 -> 5), zero drift on the second | - | 306 rows | 0, 0 |
| `generate-b24-eval-catalog` and `generate-b24-scenario-map`, twice each (`d4r2-13`, `d4r2-14`): zero drift | - | 114 rows, 20 scenarios | 0, 0 |
| `generate-b17-control-inventory`, `generate-b24-accessible-names`, `generate-action-toolability-matrix` (`d4r2-13`): zero drift (628 controls, 63 surfaces; in scope 168, 0 unnamed; 107 action records) | - | - | 0 |
| `scan-secrets` in tree mode (`d4r2-25-secret-scan`) | 4164 entries | 0 hits | 0 |
| the workflow parsed as YAML (PyYAML): seven jobs, the new job's nine steps, the `env:` value without its comment | 1 | - | 0 |
| the `--list` checks of the mechanism on the real config | - | the lead's at close (section 11.9) | - |
| [B24-D4 review] `b24-d2-working-copy` red on the D4 tree (`d4fix-01-red-working-copy`) | 1 | 4 failed, 9 passed | 1 |
| [B24-D4 review] case 9 under a planted write of the skip (`d4fix-02-mutation-skip-writes`; source restored by sha256) | 1 | 1 failed, 12 skipped | 1 |
| [B24-D4 review] `b24-d3-bom-dialogs` red on the D4 tree (`d4fix-03-red-card-focus`; `d4fix-06-red-card-focus-2` with `: true` planted back, restored by sha256) | 1 | 1 failed, 17 passed | 1, 1 |
| [B24-D4 review] `b24-d4-browser-split` red before the review's page edits (`d4fix-04-red-browser-split`) | 1 | 2 failed, 6 passed | 1 |
| [B24-D4 review] PcbEditor's readers before its edit (`d4fix-05-before-pcbeditor-readers`; `b24-d3-accessible-names` 10 red on C68, the dialog already edited) and after (`d4fix-08-after-pcbeditor-readers`, C68 moved in place) | 16 | 1 failed, 173 passed, 1 skipped; then 174 passed, 1 skipped | 1, 0 |
| [B24-D4 review] Part 1 green: `b24-d2-working-copy`, `b24-d3-bom-dialogs`, project-state, sync-authority, B12.5 activation, B18-E scenario 2, the B18-C and B18-D card suites (`d4fix-07-green-part1`) | 8 | 80 passed, 1 skipped | 0 |
| [B24-D4 review] `app/components`, `app/lib/project/__tests__` (`d4fix-16-gate-components-project`) | 71 | 448 passed, 1 skipped | 0 |
| [B24-D4 review] `app/lib/engineering/__tests__` (`d4fix-17-gate-engineering`) | 99 | 1107 passed | 0 |
| [B24-D4 review] `b16-0-1-ci-gates`, `b22-a2-process-census`, `b20-b2-import-gates`, `b20-b4-process-gate`, `b14-4-ast-import-gates` (`d4fix-18-gate-ast`) | 5 | 61 passed | 0 |
| [B24-D4 review] tsc `--noEmit -p tsconfig.json` (`d4fix-09-tsc`) | - | - | 0 |
| [B24-D4 review] eslint on the 19 changed TypeScript files (`d4fix-14-eslint`): one error, `PcbEditor.tsx:1422` `react-hooks/purity`, on a line D4 did not touch and present at `1fe719e` (`d4fix-15-eslint-pcbeditor-at-1fe719e`, the file read from `1fe719e`: the same one error); the other 18 files clean | 19 | 1 error (pre-existing) | 1, 1 |
| [B24-D4 review] `generate-b24-threshold-census`, twice (`d4fix-10`, `d4fix-11`): 306 rows; the two budget rows `b24-d2-working-copy` 10 -> 13, `b24-d3-bom-dialogs` 5 -> 6; the second run byte-identical (sha256 `b7e7a3e8...`) | - | 306 rows | 0, 0 |
| [B24-D4 review] `generate-b24-eval-catalog` and `generate-b24-scenario-map` twice each, `generate-b17-control-inventory`, `generate-b24-accessible-names`, `generate-action-toolability-matrix` once (`d4fix-12`, `d4fix-13`): every tracked artifact but the census CSV byte-identical to before the generators (1447 files hashed) | - | 114 rows, 20 scenarios, 628 controls, 168 in scope and 0 unnamed, 107 action records | 0 |
| [B24-D4 review] `b24-d4-browser-split`, `b24-d0-ci-split`, `b24-a2-env-names`, `b24-d3-accessible-names` over the edited pages (`d4fix-19-guard-page`) | 4 | 41 passed | 0 |
| [B24-D4 review] `app/lib/qualification/__tests__` (`d4fix-20-gate-qualification`) | 43 (+3 skipped) | 463 passed, 15 skipped | 0 |
| [B24-D4 review] `app/lib/agent/orchestration/__tests__` (`d4fix-21-gate-orchestration`) | 49 | 460 passed | 0 |
| [B24-D4 review] `b19-e-ci-job-scope`, `b22-a1-page`, `b22-closeout-statements`, `b23-b-dfm-quote-flow-page`, `b23-closeout-statements`, `b21-closeout-statements`, the count pins (`b16-1c-invariant-tripwires`, `b21-e1-result-tool`, `b23-a-tier3-vocabulary`, `b16-b-migrations`) and `b11-5-capture-exactness` (`d4fix-22-gate-readers`) | 11 | 114 passed | 0 |
| [B24-D4 review] `scan-secrets` in tree mode (`d4fix-23-secret-scan`) | 4164 entries | 0 hits | 0 |
| [B24-D4 review] after the last edit of this page: `app/lib/qualification/__tests__` (the guard and every B24 page suite), the three closeout tripwires and `b19-e-ci-job-scope` (`d4fix-24-final-pages`) | 47 (+3 skipped) | 505 passed, 15 skipped | 0 |
| [B24-D4 lead, 2026-10-10] the readers before the lead's change: `app/lib/qualification/__tests__`, `app/lib/agent/orchestration/__tests__`, `b19-e-ci-job-scope`, `b22-a1-page`, `b22-closeout-statements`, `b23-b-dfm-quote-flow-page`, `b23-closeout-statements` (`d4lead-00-baseline-readers`) | 97 (+3 skipped) | 972 passed, 15 skipped | 0 |
| [B24-D4 lead, 2026-10-10] `b24-d4-browser-split` red on the D4 tree before option (b) and the rename (`d4lead-01-red-browser-split`) | 1 | 6 failed, 2 passed | 1 |
| [B24-D4 lead, 2026-10-10] `generate-b24-threshold-census`, twice (`d4lead-02`, `d4lead-03`): 306 rows, the job's limit row renamed `ci.page-browser-e2e-b24.timeout-minutes`, the second run byte-identical (sha256 `8d0361c9...`); a third run after the page edits (`d4lead-06-gen-threshold-3`), unchanged | - | 306 rows | 0, 0, 0 |
| [B24-D4 lead, 2026-10-10] the guard and its direct readers: `b24-d4-browser-split`, `b24-d0-ci-split`, `b24-a1-environment-profile`, `b24-a2-secret-scan`, `b24-d1-latency-policy`, `b24-d1-threshold-census`, `b24-a2-env-names`, `b24-a1-flags`, `b24-b1-catalog`, `b24-b2-ci-admission`, `b24-d3-accessible-names`, `b21-f-page` (`d4lead-04-green-guard-readers`) | 12 | 153 passed | 0 |
| [B24-D4 lead, 2026-10-10] the readers after, the same set as `d4lead-00` (`d4lead-05-gate-readers`) | 97 (+3 skipped) | 972 passed, 15 skipped | 0 |
| [B24-D4 lead, 2026-10-10] `generate-b24-eval-catalog` and `generate-b24-scenario-map`, twice each (`d4lead-06`): every tracked file byte-identical to before them (4163 hashed) | - | 114 rows, 20 scenarios | 0 |
| [B24-D4 lead, 2026-10-10] tsc `--noEmit -p tsconfig.json` (`d4lead-07-tsc`) | - | - | 0 |
| [B24-D4 lead, 2026-10-10] eslint on the ten TypeScript files the lead's change edits (`d4lead-08-eslint`) | 10 | 0 problems | 0 |
| [B24-D4 lead, 2026-10-10] `scan-secrets` in tree mode (`d4lead-09-secret-scan`) | 4164 entries | 0 hits | 0 |
| [B24-D4 lead, 2026-10-10] after the last edit of this page: `app/lib/qualification/__tests__` (the guard and every B24 page suite), the three closeout tripwires and `b19-e-ci-job-scope` (`d4lead-10-final-pages`) | 47 (+3 skipped) | 505 passed, 15 skipped | 0 |

### 11.8 What stays open

- The `--list` check of the mechanism on the real config is the lead's at close (section 11.9); the scratch-config probe is the
  evidence it works, **INFERRED** for the real file until then.
- CI's first run of the split: page-browser-e2e's and page-browser-e2e-b24's times and headrooms (section 11.4,
  **PROPOSED**), the orchestration step's CI time and the new job's first compile (**UNKNOWN**). [B24-D4 review, 2026-10-10] On
  section 11.4's figures page-browser-e2e ends about 25 min 39 s of 30, a headroom of about 4 min 21 s, under OD-30's five minutes:
  its headroom step would print `split_required` and exit 1 (**INFERRED**; the orchestration step's 2 min 51 s is itself an estimate
  from two runs' job times, give or take about 30 s). [B24-D4 lead, 2026-10-10] Answered: the lead chose option (b) (section 11.9);
  on the four specs' figures page-browser-e2e ends about 22 min 03 s of 30 and page-browser-e2e-b24 about 12 min 48 s of 20, both at
  least OD-30's five minutes (**INFERRED** until CI; the orchestration estimate's 30 s and `multi-tab` case 2's up to 42 s leave both
  above them).
- [B24-D4 review, 2026-10-10] The case counts: CI's run at `1fe719e` listed 68 tests (60 outside the two specs, 8 in them), one
  fewer than the scratch probe's 69 / 61. Which count the real config's `--list` gives is the lead's check (section 11.9);
  **INFERRED**: 68 / 60 / 8, the counts of the spec files' own `test(` calls (`security-headers` 4 + 4 from its loop).
  [B24-D4 lead, 2026-10-10] For the four: 68 / 55 / 13 by the same count (`multi-tab` 3 and `crash-recovery` 2 by their own `test(`
  calls, as CI's log ran them), **INFERRED** until the lead's `--list`.
- The merge gate: no job `needs:` another and the tree records no required-status-check list, so a list configured by job name
  would not include `page-browser-e2e-b24` until someone adds it (as section 8 records for `agent-boundary-suites`).
- `multi-tab` case 2: the fix closes the path found; that it was CI's path is **INFERRED**, and a cross-renderer delay in
  localStorage's propagation is not ruled out (`performance-and-reliability.md` section 29). The checkpoint-restore adoption tells
  page.tsx's copy by its missing write token: another tab's own restore written in the same window would still be adopted
  (**INFERRED**, low). [B24-D4 review, 2026-10-10] Closed: the adoption is told by the restored board (`b24-d2-working-copy` 12,
  13). Left open, **INFERRED**, low: a tab that loaded no copy and whose first save is an edit reproducing another tab's newer copy
  exactly takes that copy for its own, as at `1fe719e` (case 11's rule; the module cannot tell that edit from the tab's hydration
  autosave, which PcbEditor's autosave normally writes first).
- [B24-D4 review, 2026-10-10] The Tier 1 card closed by a pointer click while its run still streams leaves focus on `body` after
  the run: page.tsx's run-end return acts only for a run sent from the prompt with no pointer pressed since (B24-D3's pointer rule,
  `accessibility.md` section 12). **INFERRED**, low; keyboard closes (Escape, Enter or Space on Cancel or Confirm) return to the
  prompt.
- `SIRKIT_E2E_SKIP` reaches the fixture server's environment too (`playwright.config.ts:48` spreads `process.env`); no production
  file reads it (`b24-a2-env-names` 2 scans them). **INFERRED**, low.

### 11.9 For the lead

### The OD-30 estimate: the lead's decision (2026-10-10)

- [B24-D4 lead, 2026-10-10] The lead chose option (b) and the rename: B24-D2's two specs (`e2e/multi-tab.spec.ts`, `e2e/crash-recovery.spec.ts`) move with B24-D3's two into the appended job, renamed `page-browser-e2e-b24` (B24's own browser specs; the draft's accessibility-only name would misdescribe it). Applied in D4's own lines only (section 11.3); the run line lists the four in a fixed order, B24-D2's two then B24-D3's two, and `SIRKIT_E2E_SKIP` names the same four as globs. Expected page-browser-e2e about 22 min 03 s of 30 (headroom 7 min 57 s) and page-browser-e2e-b24 about 12 min 48 s of 20 (headroom 7 min 12 s), both at least OD-30's five minutes, both INFERRED until CI (section 11.4). Option (c) is not taken.
- [B24-D4 review, 2026-10-10] security-1: on section 11.4's corrected arithmetic, page-browser-e2e ends about 25 min 39 s of 30 after the split (27 min 40 s, less the two specs' measured 4 min 52 s on D3's run, plus about 2 min 51 s for the orchestration step that neither D2's nor D3's run reached, estimated from B24-C2's job), a headroom of about 4 min 21 s. That is under OD-30's five minutes, so its headroom step would print `split_required` and exit 1 (INFERRED; the orchestration estimate is good to about 30 s). The split as decided (B24-D3's two specs) is implemented unchanged. Whether to commit it as is, or to widen it first, is the lead's decision. No option is applied: [B24-D4 lead, 2026-10-10] superseded, option (b) is applied (the bullet above).
  - (a) Commit as decided and read CI's first run. Its headroom step decides; a red step means a second split.
  - (b) Also move B24-D2's two specs, `e2e/multi-tab.spec.ts` and `e2e/crash-recovery.spec.ts` (168.0 s and 48.2 s on D3's run). Neither is a `golden-catalog.ts` link or a `scenario-map.ts` path. Expected page-browser-e2e about 22 min 03 s of 30 (headroom about 7 min 57 s) and the new job about 12 min 48 s of 20 (56 s setup, plus the ratio's 8 min 16 s, plus the measured 3 min 36 s), both INFERRED. It edits only D4's own lines: the `SIRKIT_E2E_SKIP` value (`:419`), the new job's run line (`:651`), its step name (`:650`) and its comment lines (`:630-632`). It also changes the guard's `MOVED_SPECS`, the page and the records. `_ci-admission.ts` reads both lists from the files. The lead's launch decision names exactly two specs, so this is the lead's call, not this run's. [B24-D4 lead, 2026-10-10] Chosen, with the rename (the four are B24's own browser specs).
  - (c) Also move the orchestration step. That cannot be done by insertions only (its step line would need an `if:`), and B24-B1's catalog link for F6 (`golden-catalog.ts:410`, `BROWSER`) ties it to page-browser-e2e. Not recommended.

### OD-30 amendment

- [B24-D4, 2026-10-10] OD-30: page-browser-e2e came within five minutes of its limit at B24-D3's run (38061798204 on `1fe719e`: 27 min 40 s of 30, its headroom step 2 min 20 s, `split_required`; 21 min 46 s at B24-D2's run). So it is split by insertions only. The lead chose option A on 2026-10-10 after the first run's STOP: the no-production-change rule is relaxed exactly to `app/lib/deployment/flag-inventory.ts` and `app/lib/deployment/environment-names.ts`, one `SIRKIT_E2E_SKIP` row each (tooling -> platform), and no runtime record changes. On 2026-10-10 the lead also chose option (b) of `ci-split.md` section 11.9 and the rename: B24's own browser specs - B24-D2's `multi-tab` and `crash-recovery`, B24-D3's `keyboard-and-focus` and `minimum-width` - leave page-browser-e2e for one appended job, `page-browser-e2e-b24` (the draft's accessibility-only name would misdescribe it). `playwright.config.ts:21` reads `SIRKIT_E2E_SKIP` into `testIgnore` in place; page-browser-e2e's first browser step sets it to the four specs (`deterministic-manufacturing.yml:418-419`); the appended `page-browser-e2e-b24` (`:629-663`, 20 minutes, B24-D1's start and headroom steps, no secret, database or live resource) runs them (the run line lists B24-D2's two first; Playwright runs the files in name order: crash-recovery, keyboard-and-focus, minimum-width, multi-tab). No `timeout-minutes` is raised. Expected page-browser-e2e: about 22 min 03 s of 30 (27 min 40 s, less the four specs' measured 8 min 28 s on D3's run, plus about 2 min 51 s for the orchestration step that neither D2's nor D3's run reached, from B24-C2's job), a headroom of about 7 min 57 s. Expected `page-browser-e2e-b24`: about 12 min 48 s of 20 (56 s of setup, B24-D3's two at CI's ratio of 750 s / 171 s, 8 min 16 s, and B24-D2's two as measured on D3's run, 3 min 36 s), a headroom of about 7 min 12 s. Each is at least OD-30's five minutes; all figures are INFERRED until CI (`ci-split.md` section 11.4).

### The D24-30 and D24-32 amendment lines

- [B24-D4, 2026-10-10] D24-30: CI's run 38061798204 on `1fe719e` failed `multi-tab` case 2 again. D3's diagnostic line showed B's board (R3 51.0 mm) stored over A's (50.5 mm) with no conflict record. The path (INFERRED for CI, CONFIRMED at the unit level): B's first nudge was saved alone, because two serialized commits outlasted the 600 ms autosave debounce; that board equalled A's newer copy, so the "unchanged" rule adopted A's token as B's own, and B's second nudge was judged untouched. Fixed in place in `app/lib/pcb/board-persistence.ts`. A write equal to another tab's newer copy now writes nothing and keeps the tab's base; a tab that loaded no copy still takes a copy of its very board, as at `1fe719e`. The checkpoint-restore adoption takes the stored copy only when it holds the restored board the editor hands it (`PcbEditor.tsx:602`, `:629`, in place). A tab's save is now refused whenever another tab wrote the stored copy after the copy its board derives from and the stored board is not this tab's board, whether the tab got that board by a load, a save or a restore. One exception is recorded open (INFERRED, low): a tab that loaded no copy, whose first save is an edit reproducing another tab's newer copy exactly. Tests: `b24-d2-working-copy` 9-13 (red first). The spec is unchanged; its CI run, in `page-browser-e2e-b24` since OD-30's split (the lead's option (b)), is the browser proof (`performance-and-reliability.md` section 29).
- [B24-D4, 2026-10-10] D24-32: CI's run 38061798204 failed `keyboard-and-focus` case 4 with focus on `body` after Escape on the Tier 1 card; the INFERRED fallback to the header's first button was the defect. When the card closes with the prompt enabled, it now returns focus to the prompt through its `finalFocus` (`GrantedExecutionDialog.tsx:55`, in place). When the prompt is still disabled (the card closed while its run streams), the card moves no focus (`:125`), so focus stays on `body` until page.tsx's run-end return takes it to the prompt. Tests: `b24-d3-bom-dialogs` 5 and 6 (Escape, Cancel and Confirm; red first; case 6 runs page.tsx's run-end code over jsdom). Case 4 asserts focus on the prompt (`keyboard-and-focus.spec.ts:235`, stricter, PROPOSED until the lead's browser run; `accessibility.md` sections 4, 7 and 12). A pointer close during the run leaves focus on `body`, by B24-D3's pointer rule (INFERRED, low).

### The discovery section 10 line

- [B24-D4, 2026-10-10] B24-D4 landed the OD-30 split of page-browser-e2e by insertions only (the lead's corrective increment; option A after the first run's STOP, then option (b) and the rename, both the lead's on 2026-10-10; closes no new defect): `playwright.config.ts:21` reads `SIRKIT_E2E_SKIP` into `testIgnore` in place, page-browser-e2e's first browser step sets it to B24's own four browser specs - `multi-tab`, `crash-recovery`, `keyboard-and-focus`, `minimum-width` (`deterministic-manufacturing.yml:418-419`) - the appended `page-browser-e2e-b24` (`:629-663`, 20 minutes) runs them, one inventory row and one census row (`flag-inventory.ts:65`, `environment-names.ts:137`, on existing lines), `_ci-admission.ts` reads the split, and guard `b24-d4-browser-split` (8) pins it. Part 1 fixed B24-D3's two CI reds test-first: D24-30's silent overwrite (`board-persistence.ts`; `PcbEditor.tsx:602`, `:629` in place; `b24-d2-working-copy` 9-13) and D24-32's focus on `body` after Escape (`GrantedExecutionDialog.tsx:55`, `:125`; `b24-d3-bom-dialogs` 5, 6; `keyboard-and-focus.spec.ts:235` stricter). No census, tool-count, action-record, route or migration move (168 = 165 + 3 + 0; 48 / 37 / 9 / 28; 107; 32), and no `timeout-minutes` raised. Expected page-browser-e2e about 22 min 03 s of 30 and `page-browser-e2e-b24` about 12 min 48 s of 20, each at least OD-30's five minutes (INFERRED until CI). The `--list` check and the browser runs are the lead's (`ci-split.md` section 11).

### The README row

| B24-D4 the OD-30 split of page-browser-e2e and B24-D3's two CI reds (OD-30 amended; D24-30, D24-32 amended; no new defect) | `ci-split.md` section 11, `performance-and-reliability.md` section 29, `accessibility.md` sections 4, 7, 12; workflow `deterministic-manufacturing.yml:418-419` (the `env:` mapping), `:629-663` (`page-browser-e2e-b24`); in place `playwright.config.ts:21`, `flag-inventory.ts:65`, `environment-names.ts:137` (option A), `board-persistence.ts`, `PcbEditor.tsx:602`, `:629`, `GrantedExecutionDialog.tsx:55`, `:125`, `keyboard-and-focus.spec.ts:235`; test helper `_ci-admission.ts`; suites `b24-d4-browser-split` (8), `b24-d2-working-copy` (13), `b24-d3-bom-dialogs` (6) | done 2026-10-10 offline: two CI reds fixed test-first, with a review round of eight findings each fixed test-first; the split by insertions only (the workflow without D4's lines is `1fe719e`'s byte for byte); the lead chose option (b) and the rename on 2026-10-10: B24's four browser specs (`multi-tab`, `crash-recovery`, `keyboard-and-focus`, `minimum-width`) run in the appended `page-browser-e2e-b24`; expected page-browser-e2e about 22 min 03 s of 30 and page-browser-e2e-b24 about 12 min 48 s of 20, each at least OD-30's five minutes (INFERRED until CI); census 168 / 165 / 3 / 0, counts 48 / 37 / 9 / 28, 107 action records, 32 migrations |

### B24-D4 - the OD-30 split of page-browser-e2e (2026-10-10 local; increment workflow + lead; this commit)

Test-first on `chapter/b24-production-qualification` from `1fe719e`: two runs, then a review round. The first run (wf_9abf9eb9-813) stopped before any lasting edit. `SIRKIT_E2E_SKIP` on `playwright.config.ts:21` is a new `SIRKIT_` name in a root config, and B24-A1's flag census wants an inventory row for it (`d4-01-counterexample-flags`: `b24-a1-flags` 2 and `b24-b1-catalog` 4 red). The lead chose option A, relaxing the no-production-change rule exactly to the two inventory modules, one row each. The second run, Part 1, fixed B24-D3's two CI reds (run 38061798204), each red first at the unit level and fixed in the product. D24-30: on CI's slower runner, B's first nudge was saved alone as a board equal to A's newer copy, and the "unchanged" rule adopted A's write token as B's own, so B's second nudge replaced A's copy (`b24-d2-working-copy` 9, red: B's second save returned `true`). `board-persistence.ts` now writes nothing for such a save and keeps the tab's base; case 10 (red first) covers the restore adoption. The path on CI is INFERRED and the mechanism CONFIRMED; the paths ruled out are recorded (`performance-and-reliability.md` section 29). D24-32: focus fell to `body` after Escape on the Tier 1 card (`b24-d3-bom-dialogs` 5, red: focus on `body`). The card's `finalFocus` now gives the prompt (`GrantedExecutionDialog.tsx:55`), and `keyboard-and-focus.spec.ts:235` asserts focus on the prompt, stricter. Part 2, the split by insertions only: guard `b24-d4-browser-split` (red 7 of 7 at `1fe719e`), `playwright.config.ts:21` edited in place, the two-line `env:` mapping at `deterministic-manufacturing.yml:418-419`, the appended `page-browser-e2e-b24` (`:629-663`, 20 minutes), one inventory row and one census row on existing lines, and `_ci-admission.ts` reading both lists and refusing every malformed shape. The workflow without D4's 37 lines is `1fe719e`'s byte for byte. Reviewed pin moves, in place with dated notes: `b24-a1-flags` 1; `b24-a2-env-names` 5, 9, 10; `b24-a1-environment-profile` 16; `b24-a2-secret-scan` (c); `b24-d0-ci-split` 1, 4, 5, 7, 10, 11; `b24-d1-latency-policy` 9, 10; `b24-d1-threshold-census` 4, 5; `b21-f-page` 10. Pages: B21's C93 and C94 (+2), `ci-split.md` C12-C14 and C24, `accessibility.md`, `edge-security.md`, `environments-and-deployment.md`, `performance-and-reliability.md` (section 11.6). The review round fixed eight confirmed findings, each test-first (section 11.7). (1) The skip had held a tab that loaded no copy out of every save once another tab stored its very board (`b24-d2-working-copy` 11, red); such a tab again takes the copy for its own, as at `1fe719e`. (2) The restore adoption is now told by the restored board the editor hands it, not by a missing token (`rememberStoredWorkingCopy(projectId, restoredBoard)`; `PcbEditor.tsx:602`, `:629` in place). Another tab's unchanged rewrite no longer locks the restoring tab out, and another tab's own restore is never adopted (cases 12, 13 and 7, red first). (3) Case 9 now compares A's whole copy; it failed under a planted write of the skip, and the source was restored and checked by sha256. (4) A card closed while the prompt is still disabled moves no focus, so page.tsx's run-end return takes focus from `body` to the prompt (`b24-d3-bom-dialogs` 6, which runs that code over jsdom; red first, with focus on the page's first control). (5) The OD-30 arithmetic now subtracts the two specs' measured CI share (4 min 52 s) and adds the orchestration step that D2's and D3's runs never reached (about 2 min 51 s, from B24-C2's job): page-browser-e2e about 25 min 39 s of 30, still under OD-30's five minutes (INFERRED). (6) `edge-security.md`'s census note moved out of the `SIRKIT_AUTH_MODE` sentence. (7) The OD-30 steps' present-tense citations were re-pinned with D4 notes (`performance-and-reliability.md:151`, `:449`; `ci-split.md:289`; guard case 8). Gates (section 11.7): the qualification directory, B21's page suites, the B19-E guard, the B22 and B23 page suites, the three closeout tripwires, components, project, engineering, the AST and process gates, tsc, eslint (one pre-existing error at `PcbEditor.tsx:1422`, present at `1fe719e`), the generators (only the reviewed threshold-census rows moved: the new job's limit row, then the two budget counts) and the secret scan. Counts unchanged: census 168 / 165 / 3 / 0, tool counts 48 / 37 / 9 / 28, 107 action records, 32 migrations. The lead then chose option (b) and the rename on 2026-10-10 (section 11.9): B24-D2's `multi-tab` and `crash-recovery` move with B24-D3's `keyboard-and-focus` and `minimum-width` into the appended job, renamed `page-browser-e2e-b24` for B24's own browser specs. Only D4's own workflow lines changed (the skip value, two comment lines, the key, the start step's comment, the run step's name and line, the upload step's name, the artifact name, the headroom step's comment and argument); the workflow without D4's 37 lines is still `1fe719e`'s byte for byte. Test-first: guard `b24-d4-browser-split` red on the D4 tree, 6 failed of 8 (`d4lead-01-red-browser-split`: cases 1, 2, 3, 5, 7, 8), then every reader moved in place with a dated `[B24-D4 lead, 2026-10-10]` note (`_ci-admission.ts`; `b21-f-page` 10; `b24-a2-secret-scan` (c); `b24-d0-ci-split` 4, 5, 10; `b24-d1-latency-policy` 9, 10; `b24-d1-threshold-census` 4 and the census row; `playwright.config.ts:21`'s note; `environment-names.ts:137`'s reason; D2's page, sections 25, 27 and 29; `accessibility.md`, `edge-security.md`, `environments-and-deployment.md`, B21's C49). Expected page-browser-e2e about 22 min 03 s of 30 and `page-browser-e2e-b24` about 12 min 48 s of 20, each at least OD-30's five minutes (INFERRED until CI). Gates after the lead's change: the readers green before and after (97 files and 3 skipped, 972 passed and 15 skipped, `d4lead-00`, `d4lead-05`), the guard's readers (`d4lead-04`), tsc, eslint on the ten files it edits (0 problems), the census twice and the B1 and B3 generators twice each (zero drift but the renamed census row), the secret scan (0 hits) and the final pages (`d4lead-10`). Left for the lead's close: the three `--list` checks on the real config (for the four), the browser runs of `keyboard-and-focus` and `multi-tab`, and CI's first run of the split.

### The lead's runs at close

- The `--list` checks of the mechanism on the real config, from the tree's root (`--list` starts no web server; never `next dev`
  here):
  - `SIRKIT_E2E_SKIP="**/multi-tab.spec.ts,**/crash-recovery.spec.ts,**/keyboard-and-focus.spec.ts,**/minimum-width.spec.ts" pnpm exec playwright test --list`:
    every spec but the four (5 files; [B24-D4 lead, 2026-10-10] option (b), was the two: the scratch probe's 7 files, 61 cases);
  - `pnpm exec playwright test --list` with the variable unset: all 9 spec files (69 cases);
  - `pnpm exec playwright test --list e2e/multi-tab.spec.ts e2e/crash-recovery.spec.ts e2e/keyboard-and-focus.spec.ts e2e/minimum-width.spec.ts`:
    exactly the four (13 cases; [B24-D4 lead, 2026-10-10] was the two, 8 cases).
  If any differs, the lead stops the increment (task-D4). [B24-D4 review, 2026-10-10] CI's run at `1fe719e` listed 68 tests (60 + 8),
  one fewer than the probe's 69 / 61 outside the two specs (section 11.8); the file sets are the check, and the case counts are
  expected at 68 / 60 / 8 unless the probe's extra case is found. [B24-D4 lead, 2026-10-10] For the four: 68 / 55 / 13 by CI's
  count (56 outside them by the probe's), read off the spec files and CI's log, never run here (**INFERRED**).
- The browser runs: `keyboard-and-focus` (case 4's stricter assertion and the card's focus return) and `multi-tab` (the
  working-copy fix; CI is the run that showed the path), on the lead's usual configuration; then CI's first run of the split, both
  jobs' headroom steps (page-browser-e2e's and `page-browser-e2e-b24`'s; [B24-D4 lead, 2026-10-10] the decision is taken, section 11.4).
- The local production-mode run: B24-D4 changes three modules the Next application imports (`app/lib/pcb/board-persistence.ts`,
  `app/components/pcb/GrantedExecutionDialog.tsx`, `app/components/pcb/PcbEditor.tsx`); the inventory modules are data no route
  reads at run time. A fresh-worktree `next build` and `next start` with no `.env*` file is the lead's (CI's production-smoke job runs
  the same build).
- The B17-A browser suite (lead lesson 11): `GrantedExecutionDialog.tsx` gained a prop on `DialogContent` and `PcbEditor.tsx` two
  arguments on existing lines (no control added or renamed; the B17-A generator and suite show zero drift, `d4fix-12`).

### The lead's sweep (the lead's files and the records not moved)

- [B24-D4 review, 2026-10-10] `artifacts/ai-control-plane-b24/README.md:24` cites `deterministic-manufacturing.yml` `:557-625`
  (`agent-boundary-suites`): today `:560-628`. `README.md:26` cites the OD-30 steps at `:32`, `:344-345`, `:405`, `:432-433`, `:565`,
  `:624-625`: today `:32`, `:344-345`, `:406`, `:435-436`, `:568`, `:627-628` (+1 after B24-D2's entry at `:384`, +2 more after B24-D4's
  `env:` mapping at `:418-419`).
- Not moved, as records of their own time: `performance-and-reliability.md:335` (A1's insertion-table rows as D1 inserted them, the
  frozen first lines A1's cases 14, 16 and 17 model) and every ledger paragraph that names a line as of its commit.
- `app/components/pcb/PcbEditor.tsx:1422` fails eslint's `react-hooks/purity` (`Date.now()` in a render-time path) at `1fe719e` and
  after, on a line D4 did not touch; CI runs no eslint. A follow-up, not D4's.

### 11.10 Citations

| id | file | line | anchor |
|---|---|---|---|
| D4-C1 | `.github/workflows/deterministic-manufacturing.yml` | 417 | `- run: pnpm exec playwright test` |
| D4-C2 | `.github/workflows/deterministic-manufacturing.yml` | 418 | `env:` |
| D4-C3 | `.github/workflows/deterministic-manufacturing.yml` | 419 | `SIRKIT_E2E_SKIP: "**/multi-tab.spec.ts,**/crash-recovery.spec.ts,**/keyboard-and-focus.spec.ts,**/minimum-width.spec.ts"` |
| D4-C4 | `.github/workflows/deterministic-manufacturing.yml` | 633 | `page-browser-e2e-b24:` |
| D4-C5 | `.github/workflows/deterministic-manufacturing.yml` | 635 | `timeout-minutes: 20` |
| D4-C6 | `.github/workflows/deterministic-manufacturing.yml` | 651 | `run: pnpm exec playwright test e2e/multi-tab.spec.ts e2e/crash-recovery.spec.ts e2e/keyboard-and-focus.spec.ts e2e/minimum-width.spec.ts` |
| D4-C7 | `.github/workflows/deterministic-manufacturing.yml` | 663 | `scripts/ci-job-headroom.ts .github/workflows/deterministic-manufacturing.yml page-browser-e2e-b24` |
| D4-C8 | `playwright.config.ts` | 21 | `testIgnore: (process.env.SIRKIT_E2E_SKIP ?? "").split(",").map((glob) => glob.trim()).filter(Boolean),` |
| D4-C9 | `app/lib/deployment/flag-inventory.ts` | 65 | `{ name: "SIRKIT_E2E_SKIP", kind: "tooling", default: "unset (ignores nothing)", direction: "disables",` |
| D4-C10 | `app/lib/deployment/environment-names.ts` | 137 | `undeclared("SIRKIT_E2E_SKIP", "platform", "playwright.config.ts",` |
| D4-C11 | `app/lib/qualification/__tests__/_ci-admission.ts` | 30 | `"page-browser-e2e", "page-browser-e2e-b24", "agent-boundary-suites"` |
| D4-C12 | `app/lib/qualification/__tests__/_ci-admission.ts` | 185 | `${E2E_SKIP_SUFFIX}` |
| D4-C13 | `app/lib/qualification/__tests__/_ci-admission.ts` | 299 | `export const E2E_SKIP_SUFFIX =` |
| D4-C14 | `app/lib/qualification/__tests__/_ci-admission.ts` | 311 | `function browserSplit(lines: readonly string[], playwrightRun: number, browserEnd: number, read: RepoReader)` |
| D4-C15 | `artifacts/ai-control-plane-b24/environments-and-deployment.md` | 404 | `[B24-D4, 2026-10-10] \| page-browser-e2e-b24 \|` |
| D4-C16 | `app/lib/pcb/board-persistence.ts` | 189 | `if (write.skip) return true;` |
| D4-C17 | `app/lib/pcb/board-persistence.ts` | 255 | `notOurs = known !== undefined && !untouched && known.boardJson !== null && storedJson !== known.boardJson;` |
| D4-C18 | `app/lib/pcb/board-persistence.ts` | 262 | `restored = stored && JSON.stringify(stored.board) === JSON.stringify(restoredBoard) ? stored : null;` |
| D4-C19 | `app/components/pcb/GrantedExecutionDialog.tsx` | 55 | `finalFocus={promptFocus}` |
| D4-C20 | `e2e/keyboard-and-focus.spec.ts` | 235 | `"focus returns to the prompt after Escape"` |
| D4-C21 | `app/lib/qualification/__tests__/b24-d0-ci-split.test.ts` | 90 | `const JOB_FIRST_LINE = 560;` |
| D4-C22 | `app/lib/agent/orchestration/__tests__/b21-f-page.test.ts` | 266 | `"two browser runs, one after the other").toEqual([` |
| D4-C23 | `artifacts/ai-control-plane-b21/evaluation-matrix.md` | 1183 | `\| C93 \|` |
| D4-C24 | `app/components/pcb/GrantedExecutionDialog.tsx` | 125 | `return prompt && !prompt.disabled ? prompt : false;` |
| D4-C25 | `app/components/pcb/PcbEditor.tsx` | 641 | `rememberStoredWorkingCopy(init.scope.projectId, board); adoptBoardLifecycle("checkpoint-restore", board);` |
| D4-C26 | `app/components/pcb/PcbEditor.tsx` | 668 | `rememberStoredWorkingCopy(syncIdentity.projectId, restored); adoptBoardLifecycle("checkpoint-restore", restored);` |
| D4-C27 | `app/lib/pcb/board-persistence.ts` | 261 | `export function rememberStoredWorkingCopy(projectId: string, restoredBoard: PcbBoard): void {` |
