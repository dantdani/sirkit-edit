# B24 - Test and validation report (closeout commit 2/2)

Labels: **CONFIRMED** (read at the cited file:line at `26dc8b8`, or executed and measured in this commit's own gates, section 7),
**INFERRED** (a reading, nothing executed), **RECORDED** (taken from a record without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied; never faked, never claimed). Base: `26dc8b8`
(closeout commit 1/2), the final SHA of the chapter's code; closeout commit 2/2 changes no production code - it adds records and
reports and changes one test file, `b24-f-verdict-lines`, which prompt-to-gerber runs (section 7; [B24-closeout review, 2026-10-11]
correctness-2), so its own CI run confirms section 2 before the merge. Sections 1, 2 and the
integrity figures of section 5 are the lead's final run and the lead's reading of CI (RECORDED here from the lead's measurements and
logs, `b24/logs/final-*.log`, `b24/logs/final-run-summary.txt` and `b24/integrity-*.txt` in the lead's scratchpad; never re-run). Read
by `b24-f-verdict-lines` 2 (scopes 1 and 2 of `final-verdict.md` are computed from sections 1 and 2), 4, 7 and 8.

## 1. The final run at `26dc8b8` (the lead's, 2026-10-10)

On this machine (win32, Node v24.15.0), through the session's lock scripts, one heavy job at a time. A gate passes only on exit 0
(lead decision D5; `b24-f-verdict-lines` 2 computes scope 1 from this table).

| gate | what ran | excluded, and why | result | exit |
|---|---|---|---|---|
| vitest | `vitest run --maxWorkers=2` over the whole repository | the three real-process suites `autoroute-boundary-integrity`, `autonomous-layout-qualification` and `manufacturing-release-gate`: they need java, FreeRouting or kicad-cli, and every gate of the program excludes them | 864 files passed, 11 skipped (875); 9,733 tests passed, 68 skipped (9,801); 1,164 s | 0 |
| tsc | `tsc --noEmit -p tsconfig.json` | - | 0 errors | 0 |
| eslint | `eslint .`, the whole repository | - | 68 problems: 33 errors, 35 warnings; none introduced by B24 (1.1) | 1 |
| browser, page-browser-e2e | Playwright 1.63, the fixture runtime, `next dev`: page-browser-e2e's default step with `SIRKIT_E2E_SKIP` set to the workflow's value (`.github/workflows/deterministic-manufacturing.yml:417-419`) | B24's four browser specs, which run in their own job (next row) | 55 passed (8.6 min) | 0 |
| browser, page-browser-e2e-b24 | the job's run line, `multi-tab`, `crash-recovery`, `keyboard-and-focus`, `minimum-width` (`.github/workflows/deterministic-manufacturing.yml:651`) | - | 13 passed (4.5 min) | 0 |
| browser, orchestration | `playwright.orchestration.config.ts`, as page-browser-e2e's second browser step runs it (`.github/workflows/deterministic-manufacturing.yml:422`) | - | 4 passed (2.7 min) | 0 |

Scope 1 (deterministic local readiness) is therefore NOT READY on the eslint row; every other row exits 0. The 11 skipped files and
68 skipped tests are not itemised in the lead's measurement (INFERRED: the opt-in live suites and the flagged non-live gates, which
skip without their flags; the skip list was not re-read here).

### 1.1 eslint, the whole repository (exit 1; none of it introduced by B24)

The lead's reading of `eslint .` at `26dc8b8`: 68 problems, 33 errors and 35 warnings. The errors are in 13 files:

- three files B24 touched hold only errors recorded before B24: `app/page.tsx`'s 14 react-hooks errors (recorded by B21,
  `artifacts/ai-control-plane-b21/final-verdict.md:133-135`; fixed on the unmerged `fix/b21-page-react-hooks-refs`, `5dfae2b`),
  `app/components/bom/BomView.tsx`'s 4 set-state-in-effect errors (present at `3773c6a`'s and main's bytes) and
  `app/components/pcb/PcbEditor.tsx`'s one react-hooks/purity error at its line 1422 (recorded at B23's closeout);
- ten files B24 did not change (`git diff --name-only 57c3b29..26dc8b8`): `AssignmentQueuePanel.tsx` 2, `CommandPalette.tsx` 2,
  `SilkTool.tsx`, `useLivePreview.ts`, `useSilkTool.ts`, `TextInspector.tsx`, `ViaInspector.tsx`, `NumberField.tsx` and
  `PadstackEditor.tsx` 1 each, `b14-replacement-proposal.test.ts` 2 and `b16-0-2-session-identity.test.ts` 1.

The warnings in the two B24-touched files that hold any (`kicad-cli-oracle.test.ts` and `e2e-prompt-to-gerber.ts`, one
unused-disable warning each) are identical at `57c3b29`'s bytes (the lead linted main's version, restored by sha256). CI runs no eslint
step (OD-221); its default adds one only after the page fix merges through its own pull request.

### 1.2 The browser runs

Run as CI splits them (OD-30; B24-D4): page-browser-e2e's default step with B24's four specs set aside (55 passed, 8.6 min),
page-browser-e2e-b24's run line over those four (13 passed, 4.5 min: `multi-tab` 3, `crash-recovery` 2, `keyboard-and-focus` 5,
`minimum-width` 3 by their `test(` blocks, section 3) and the orchestration configuration (4 passed, 2.7 min), each exit 0. The runs
rewrote the tracked evidence PNGs; the lead restored all 32 by blob hash, 0 mismatched after, and the tree was clean after the run (0
entries). Every browser run is the fixture runtime's under `next dev`: no provider, database or network resource is reached.

## 2. CI at `26dc8b8` (runs 38104126392 and 38104126347)

deterministic-manufacturing (run 38104126392) and benchmark-quality (run 38104126347), the lead's reading. A job passes only on
`success` (`b24-f-verdict-lines` 2 computes scope 2 from this table and holds each workflow's rows to its pull-request jobs, and the
table to this heading's SHA; [B24-closeout review, 2026-10-11] correctness-4, security-5: the two benchmark-quality jobs were one
merged row). Headroom is the job's limit less its time; OD-30's line is five minutes, and the four jobs with a headroom step
(`.github/workflows/deterministic-manufacturing.yml:345`, `:436`, `:628`, `:663`) fail under it, so their success means their step
read at least five minutes (INFERRED from the job's result; the steps' own lines were not read here).

| workflow | job | time | limit | headroom | result |
|---|---|---|---|---|---|
| deterministic-manufacturing | prompt-to-gerber | 10 min 13 s | 25 min (`.github/workflows/deterministic-manufacturing.yml:26`) | 14 min 47 s | success |
| deterministic-manufacturing | database-delivery | 3 min 01 s | 15 min (`.github/workflows/deterministic-manufacturing.yml:349`) | 11 min 59 s | success |
| deterministic-manufacturing | page-browser-e2e | 21 min 54 s | 30 min (`.github/workflows/deterministic-manufacturing.yml:402`) | 8 min 06 s | success |
| deterministic-manufacturing | production-smoke | 2 min 28 s (its `next build` and `next start` probes) | 20 min (`.github/workflows/deterministic-manufacturing.yml:445`) | 17 min 32 s | success |
| deterministic-manufacturing | secret-scan | 33 s | 10 min (`.github/workflows/deterministic-manufacturing.yml:540`) | 9 min 27 s | success |
| deterministic-manufacturing | agent-boundary-suites | 4 min 45 s | 20 min (`.github/workflows/deterministic-manufacturing.yml:566`) | 15 min 15 s | success |
| deterministic-manufacturing | page-browser-e2e-b24 | 6 min 31 s | 20 min (`.github/workflows/deterministic-manufacturing.yml:635`) | 13 min 29 s | success |
| benchmark-quality | benchmark-core | not in the lead's reading | 20 min (`.github/workflows/benchmark.yml:15`) | - | success |
| benchmark-quality | benchmark-latency | not in the lead's reading | 30 min (`.github/workflows/benchmark.yml:98`) | - | success |

benchmark-quality's pull-request jobs are these two: benchmark-nightly runs on schedule and dispatch only
(`.github/workflows/benchmark.yml:48`), so a pull-request run holds no row of it. Their `success` is the lead's reading of the run,
its jobs green and the workflow `success` (**RECORDED**); their times are not in it.

- **The latency gate (lead decision D3).** benchmark-latency's `b24-latency-gate` answers `baseline_missing` while the latest
  `latency-baseline.json` version is the declared-without-values v1 (OD-212, OD-30): a recorded, non-blocking BLOCKED state, never
  counted as pass or as red; `unmeasured`, `sample_shortfall` and regressions block (`performance-reliability-report.md` section 1).
  The workflow's success therefore says no gate blocked, not that latency passed.
- **The earlier chapter runs.** Every commit from `6e4e1bb` on was green in every job that ran: B24-D4 run 38076687384, B24-E run
  38086426338, B24-F run 38096591308 (the lead's reading).
- **Not in CI.** [B24-closeout review, 2026-10-11] security-6: CI runs a selection of the suite, never the whole of it (`ci-admission.md`
  section 12): 302 of the 878 vitest test files (every `.test.ts` or `.test.tsx` file in an `app` `__tests__` folder, as vitest
  collects them) are selected by no job at `26dc8b8` - the three real-process suites, 64 of the 73 `b16-0-*` suites (the B16.0
  security gates, exact-origin CSRF, route authorization, the trusted request context and the bounded JSON reader among them; OD-228
  (f)) and 235 others. All but the three ran only in the lead's local final run (section 1), so a change that breaks one of them can
  merge with every CI job green. **CONFIRMED** (derived by B24-B1's job-scope rule, which CI's guard shares; `b24-f-verdict-lines` 2
  recomputes both counts). No CI job runs eslint (OD-221); benchmark-nightly's corpus run is not recorded (D24-41's residual).

## 3. The B24 suites the chapter added (by increment)

Every test file the range `57c3b29..26dc8b8` adds (`git diff --name-only --diff-filter=A`), with its increment (the commit that added
it) and its cases read from the file: `it(` blocks for a vitest suite (the B21-B23 pages' counter, `/^\s*it(?:\.each)?[(<]/gm`), and
`test(` blocks for a Playwright spec. A block inside a loop runs once per item: `b24-d3-bom-dialogs`' cases 1-4 run for each of the
four BOM dialogs. The CI selection is read from the workflows at `26dc8b8`: prompt-to-gerber's directory filter
`app/lib/qualification/__tests__` (`.github/workflows/deterministic-manufacturing.yml:229`), database-delivery's explicit PGlite entries
(`.github/workflows/deterministic-manufacturing.yml:377-384`), page-browser-e2e-b24's run line (`:651`). **CONFIRMED** (read).

| increment | suite | cases | selected by |
|---|---|---|---|
| A1 | `app/lib/qualification/__tests__/b24-a1-configuration.test.ts` | 14 | prompt-to-gerber |
| A1 | `app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts` | 20 | prompt-to-gerber |
| A1 | `app/lib/qualification/__tests__/b24-a1-flags.test.ts` | 10 | prompt-to-gerber |
| A1 | `app/lib/qualification/__tests__/b24-a1-readiness.test.ts` | 11 | prompt-to-gerber |
| A2 | `app/lib/qualification/__tests__/b24-a2-env-names.test.ts` | 10 | prompt-to-gerber |
| A2 | `app/lib/qualification/__tests__/b24-a2-headers.test.ts` | 13 | prompt-to-gerber |
| A2 | `app/lib/qualification/__tests__/b24-a2-origin-allowlist.test.ts` | 7 | prompt-to-gerber |
| A2 | `app/lib/qualification/__tests__/b24-a2-secret-rotation.test.ts` | 11 | prompt-to-gerber |
| A2 | `app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts` | 26 | prompt-to-gerber |
| A3 | `app/lib/qualification/__tests__/b24-a3-abuse-controls-page.test.ts` | 8 | prompt-to-gerber |
| A3 | `app/lib/qualification/__tests__/b24-a3-abuse-limits.test.ts` | 11 | prompt-to-gerber |
| A3 | `app/lib/qualification/__tests__/b24-a3-credit-census.test.ts` | 8 | prompt-to-gerber |
| A3 | `app/lib/qualification/__tests__/b24-a3-embedding-admission.test.ts` | 9 | prompt-to-gerber |
| A3 | `app/lib/qualification/__tests__/b24-a3-placement-bound.test.ts` | 7 | prompt-to-gerber |
| A3 | `app/lib/qualification/__tests__/b24-a3-principal-limits.test.ts` | 10 | prompt-to-gerber |
| A3 | `app/lib/qualification/__tests__/b24-a3-signin-message.test.ts` | 2 | prompt-to-gerber |
| A4 | `app/lib/qualification/__tests__/b24-a4-database-tls.test.ts` | 7 | prompt-to-gerber |
| A4 | `app/lib/qualification/database/__tests__/b24-a4-restore.test.ts` | 7 | database-delivery |
| A4 | `app/lib/qualification/database/__tests__/b24-a4-rls-default-deny.test.ts` | 9 | database-delivery |
| A4 | `app/lib/qualification/database/__tests__/b24-a4-rollback.test.ts` | 7 | database-delivery |
| A4 | `app/lib/qualification/database/__tests__/b24-a4-test-isolation.test.ts` | 16 | database-delivery |
| B1 | `app/lib/qualification/__tests__/b24-b1-catalog.test.ts` | 11 | prompt-to-gerber |
| B1 | `app/lib/qualification/__tests__/b24-b1-score-separation.test.ts` | 5 | prompt-to-gerber |
| B2 | `app/lib/qualification/__tests__/b24-b2-ci-admission.test.ts` | 9 | prompt-to-gerber |
| B2 | `app/lib/qualification/__tests__/b24-b2-corpus-nightly.test.ts` | 5 | prompt-to-gerber (its corpus cases skip there); benchmark-nightly with its flag (`.github/workflows/benchmark.yml:64`) |
| B2 | `app/lib/qualification/__tests__/b24-b2-power-ground.test.ts` | 10 | prompt-to-gerber |
| B3 | `app/lib/qualification/__tests__/b24-b3-live-suite-honesty.test.ts` | 10 | prompt-to-gerber |
| B3 | `app/lib/qualification/__tests__/b24-b3-model-in-loop.test.ts` | 9 | prompt-to-gerber |
| B3 | `app/lib/qualification/__tests__/b24-b3-scenario-map.test.ts` | 6 | prompt-to-gerber |
| C1 | `app/lib/qualification/__tests__/b24-c1-durable-trace.test.ts` | 16 | prompt-to-gerber |
| C1 | `app/lib/qualification/__tests__/b24-c1-llm-call-record.test.ts` | 15 | prompt-to-gerber |
| C1 | `app/lib/qualification/database/__tests__/b24-c1-durable-records-pglite.test.ts` | 6 | database-delivery |
| C2 | `app/lib/qualification/__tests__/b24-c2-attribution.test.ts` | 14 | prompt-to-gerber |
| C2 | `app/lib/qualification/__tests__/b24-c2-cost.test.ts` | 5 | prompt-to-gerber |
| C2 | `app/lib/qualification/__tests__/b24-c2-redaction.test.ts` | 11 | prompt-to-gerber |
| C2 | `app/lib/qualification/__tests__/b24-c2-retention.test.ts` | 7 | prompt-to-gerber |
| C2 | `app/lib/qualification/database/__tests__/b24-c2-retention-pglite.test.ts` | 6 | database-delivery |
| C3 | `app/lib/qualification/__tests__/b24-c3-recorded-limits.test.ts` | 11 | prompt-to-gerber |
| C3 | `app/lib/qualification/__tests__/b24-c3-trace-read.test.ts` | 10 | prompt-to-gerber |
| C3 | `app/lib/qualification/database/__tests__/b24-c3-trace-read-pglite.test.ts` | 4 | database-delivery |
| D0 | `app/lib/qualification/__tests__/b24-d0-ci-split.test.ts` | 12 | prompt-to-gerber |
| D1 | `app/lib/qualification/__tests__/b24-d1-latency-policy.test.ts` | 10 | prompt-to-gerber |
| D1 | `app/lib/qualification/__tests__/b24-d1-latency-workflow.test.ts` | 1 | prompt-to-gerber (skips there); benchmark-latency with its flag (`.github/workflows/benchmark.yml:113`) |
| D1 | `app/lib/qualification/__tests__/b24-d1-latency.test.ts` | 7 | prompt-to-gerber (skips there); benchmark-latency with its flag (`.github/workflows/benchmark.yml:113`) |
| D1 | `app/lib/qualification/__tests__/b24-d1-threshold-census.test.ts` | 7 | prompt-to-gerber |
| D2 | `app/lib/qualification/__tests__/b24-d2-board-read.test.ts` | 10 | prompt-to-gerber |
| D2 | `app/lib/qualification/__tests__/b24-d2-crash-recovery.test.ts` | 10 | prompt-to-gerber |
| D2 | `app/lib/qualification/__tests__/b24-d2-memory.test.ts` | 4 | prompt-to-gerber (skips there); benchmark-latency with its flag (`.github/workflows/benchmark.yml:113`) |
| D2 | `app/lib/qualification/__tests__/b24-d2-process-cleanup.test.ts` | 8 | prompt-to-gerber |
| D2 | `app/lib/qualification/__tests__/b24-d2-working-copy.test.ts` | 13 | prompt-to-gerber |
| D2 | `app/lib/qualification/database/__tests__/b24-d2-restart-pglite.test.ts` | 1 | database-delivery |
| D2 | `e2e/crash-recovery.spec.ts` | 2 | page-browser-e2e-b24 |
| D2 | `e2e/multi-tab.spec.ts` | 3 | page-browser-e2e-b24 |
| D3 | `app/lib/qualification/__tests__/b24-d3-accessible-names.test.ts` | 11 | prompt-to-gerber |
| D3 | `app/lib/qualification/__tests__/b24-d3-bom-dialogs.test.tsx` | 6 | prompt-to-gerber |
| D3 | `e2e/keyboard-and-focus.spec.ts` | 5 | page-browser-e2e-b24 |
| D3 | `e2e/minimum-width.spec.ts` | 3 | page-browser-e2e-b24 |
| D4 | `app/lib/qualification/__tests__/b24-d4-browser-split.test.ts` | 8 | prompt-to-gerber |
| E | `app/lib/qualification/__tests__/b24-e-production-auth-config.test.ts` | 8 | prompt-to-gerber |
| E | `app/lib/qualification/__tests__/b24-e-register.test.ts` | 10 | prompt-to-gerber |
| E | `app/lib/qualification/__tests__/b24-e-statements.test.ts` | 7 | prompt-to-gerber |
| E | `e2e-production-auth/production-auth.spec.ts` | 4 | none: its config throws `PRODUCTION_AUTH_NOT_EXERCISED` while the staging list is empty (LB-1, LB-13) |
| F | `app/lib/qualification/__tests__/b24-f-generator-inventory.test.ts` | 6 | prompt-to-gerber |
| F | `app/lib/qualification/__tests__/b24-f-maps.test.ts` | 10 | prompt-to-gerber |
| F | `app/lib/qualification/__tests__/b24-f-registers.test.ts` | 10 (1-6 B24-F's, 7-10 closeout 1/2's) | prompt-to-gerber |
| F | `app/lib/qualification/__tests__/b24-f-verdict-lines.test.ts` | 11 | prompt-to-gerber |

**Totals: 61 vitest suites with 563 `it(` blocks (53 under `app/lib/qualification/__tests__`, 8 PGlite suites under
`app/lib/qualification/database/__tests__`) and 5 Playwright specs with 17 `test(` blocks.** By increment, suites / blocks: A1 4 / 55,
A2 5 / 67, A3 7 / 55, A4 5 / 46, B1 2 / 16, B2 3 / 24, B3 3 / 25, C1 3 / 37, C2 5 / 43, C3 3 / 25, D0 1 / 12, D1 4 / 25, D2 6 / 46
and 2 specs / 5, D3 2 / 17 and 2 specs / 8, D4 1 / 8, E 3 / 25 and 1 spec / 4, F 4 / 37. Closeout commit 1/2 added cases 7-10 to
`b24-f-registers` and no suite; commit 2/2 adds none (it moves `b24-f-verdict-lines`' pins in place and, in its review round,
strengthens its cases 2, 7 and 11 - no case added; section 7). The chapter also edited earlier suites in place (each increment's page
records its pin moves). [B24-closeout review, 2026-10-11] correctness-3: `b24-f-verdict-lines` 7 re-derives this table - its vitest rows
the B24 suites under `app`, each row's cases from its file, its CI cell by the job-scope rule, the totals and the increments.

## 4. The counts at `26dc8b8`, from their pins

| count | value | pin |
|---|---|---|
| route methods (census) | 168 = 165 canonical + 3 factories + 0 raw | `app/api/__tests__/b16-1c-invariant-tripwires.test.ts:48` |
| tools | 48 registry / 37 agent-exposed / 9 MCP-exposed / 28 agent-only | `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241` |
| action records | 107 | `app/lib/manufacturing-providers/__tests__/b23-a-tier3-vocabulary.test.ts:272` |
| SQL migrations | 32 | `app/lib/db/__tests__/b16-b-migrations.test.ts:39` |

Each equals the generated `current-system-map.md` section 1 at `26dc8b8` (byte-pinned by `b24-f-maps`); B24 moved the census 166 ->
168 (B24-A1, OD-198), the tools 47 / 36 / 9 / 27 -> 48 / 37 / 9 / 28 (B24-D2a, OD-213), the action records 106 -> 107 (B24-A1) and the
migrations 31 -> 32 (B24-A4), each by review. **CONFIRMED** (each pin read at `26dc8b8`; the generated map regenerated unchanged by this
commit's generator runs and byte-pinned by `b24-f-maps` in its qualification gate, section 7); the pins' own suites ran in the lead's
final run (RECORDED, section 1).

## 5. The secret scan of history and the two other integrity measurements (the lead's)

- **History scan.** B24-A2's scanner, `pnpm exec tsx scripts/scan-secrets.ts --history 26dc8b8`, over every commit reachable from the
  final SHA: origin/main's whole history (333 commits) and the chapter's 21, 354 commits, each blob and path once - exit 0; 8,528 entries
  scanned or skipped, 0 oversized skipped, 0 blobs git did not return, 28 allowlisted lines (the reviewed allowlist, B24-A2F's
  history-only entries among them), 0 hits. It finds what its rules match (B24-A2's patterns) and proves no absence of a secret its rules
  do not describe; the history before B24 was never scanned before this run. [B24-closeout review, 2026-10-11] security-1: its range
  does not reach the 167 commits of the five pushed, unmerged branches (`final-verdict.md` section 5.3); [B24-closeout lead, 2026-10-11] scanned since by the lead, `scan-secrets.ts --history origin/main..origin/<branch>` for each: 1,505 entries, 6 allowlisted lines, 0 hits, every run exit 0.
- **The protected original** and **the history's dates**: `final-verdict.md` section 5.3 answers both lines with their methods.

## 6. What was not run

- **Every live and physical gate** (`qualification-matrix.md` part 2): no model provider was called, no staging or production
  sign-in was made (the production-auth harness has an empty staging list), no distributor, external MCP server, manufacturer or quote
  service was reached, no qualified OCI platform, live router or kicad-cli ran, no real database was touched, and no board was made or
  tested - each BLOCKED-LIVE-QUALIFICATION as the register holds it (LB-1, LB-2, LB-3, LB-5, LB-6, LB-7, LB-8, LB-9, LB-10, LB-11,
  LB-12, LB-13, LB-14, LB-15, LB-16, LB-17); LB-4 is the one QUALIFIED row (2026-09-24, a non-isolated server).
- **Production mode beyond CI's production-smoke.** No local `next build` or `next start` belongs to the final run (the browser runs use
  `next dev` under the fixture runtime), and nothing was deployed to a host: staging and production stay LB-13's.
- **The three real-process suites** (section 1), and the opt-in suites that skip without their flags.
- **benchmark-nightly** (schedule and dispatch only): no run of it at `26dc8b8` is recorded.
- [B24-closeout review, 2026-10-11] **In CI, 302 of the 878 vitest test files** (section 2's Not-in-CI bullet): all but the three
  real-process suites ran in the lead's local final run only.
- [B24-closeout review, 2026-10-11] **A secret scan of the five pushed, unmerged branches** (167 commits; section 5): not run by the builder; [B24-closeout lead, 2026-10-11] scanned since by the lead, `scan-secrets.ts --history origin/main..origin/<branch>` for each: 1,505 entries, 6 allowlisted lines, 0 hits, every run exit 0.

## 7. Closeout commit 2/2's own gates (records, reports and one test file)

Every run went through the lock scripts (two vitest workers), with no `DATABASE_URL`, no browser and no outside service; the logs stay
outside the repository (`b24/logs/close2-*`). **CONFIRMED** (executed).

| run | what | result |
|---|---|---|
| `close2-base-qualification` | before any edit, on `26dc8b8`: `app/lib/qualification/__tests__` and the B21, B22 and B23 closeout tripwires | 53 files passed, 3 skipped (56); 552 tests passed, 15 skipped; exit 0 |
| `close2-red-1-verdict-lines` | `b24-f-verdict-lines` with its pins moved (cases 1, 2, 7, 11 and the scans of 4, 7, 8), the pages not yet filled | red: 1 (scope 1's pending state outside the closed set), 2 (no final-run table), 7 (two pending lines), 11 (no status line); 7 passed; exit 1 |
| `close2-green-1-verdict-lines` | the same suite on the first filled pages | 9 passed, 2 red: 3 (the database/RLS line named LB-4, a QUALIFIED row, where case 3 admits only BLOCKED-LIVE-QUALIFICATION ids; the line now names Q10's blocking LBs, and the status-line rule takes the LBs of the rows that do not pass) and 8 (a runbook line citation, 1159, whose word "runbook" stood on the line before it); exit 1 |
| `close2-green-2-verdict-lines` | after those two fixes | 11 passed; exit 0 |
| `close2-break-1` | two planted breakages in the real pages: the eslint row's exit set to 0 in this report, LB-16 dropped from the MCP status line | each caught: case 2 "deterministic local readiness: NOT READY, not READY", case 11 "MCP: LB-16 unnamed"; both files restored, sha256 equal |
| `close2-after-qualification` | `app/lib/qualification/__tests__` and the B21, B22 and B23 closeout tripwires on the filled pages | 53 files passed, 3 skipped (56); 552 tests passed, 15 skipped; exit 0 (the case count unchanged: no case added) |
| `close2-tsc-1`, `close2-eslint-1` | tsc; eslint on the one changed TypeScript file | 0; 0 |
| `close2-gen-*` | all 28 generators, twice | 56 runs, exit 0; zero drift but `gen-demo-fixtures`' known CRLF rewrite of `app/lib/pcb/demo/fixtures.ts` (content identical; its LF bytes restored from `26dc8b8`, blob hash equal); every generated output, `current-system-map.md` and `generator-inventory.md` among them, unchanged |
| `close2-secret-scan` | the tree secret scan (tracked and untracked files) | 4,199 entries, 8 allowlisted lines, 0 hits; exit 0 |
| `close2-readers` | the other suites that walk the pages or the test files: `b20-b4-withhold-proposals`, `b11-5-capture-exactness`, `b19-e-ci-job-scope`, `b20-b4-stop-evidence` | 4 files, 49 passed; exit 0 |
| `close2-ast-gates` | `b14-4-ast-import-gates`, alone | 22 passed (22.3 s); exit 0 |
| the counts | `current-system-map.md` regenerated, unchanged | census 168 / 165 / 3 / 0; tools 48 / 37 / 9 / 28; 107 action records; 32 migrations |
| `close2-final-pages`, `-2`, `-3` | after the last edits of the pages (the third after the register's D24-39 and D24-40 notes): `b24-f-verdict-lines`, `b24-f-registers`, `b24-f-maps`, `b24-f-generator-inventory`, `b24-e-statements`, `b24-e-register` and the B21, B22 and B23 closeout tripwires | 9 files, 81 passed; exit 0 |
| `close2fix-red-1` | [B24-closeout review, 2026-10-11] the review round (correctness-1 to -6, security-1, -5, -6), test-first: `b24-f-verdict-lines` with cases 2, 7 and 11 strengthened, on the pages as they stood | red: 2 (benchmark-quality's two jobs one merged row), 7 (D24-39 and D24-40 still `this commit (B24-Fb)`), 11 (PROTECTED ORIGINAL MODIFIED answered NO beside a listing of 67 modified files, its INFERRED attribution unlabelled; SECRETS EXPOSED naming no 167 unscanned pushed commits); 8 passed; exit 1 |
| `close2fix-red-2-soft` | the same, every assertion soft for one diagnostic run (the strict file restored, sha256 equal) | also red: five unqualified every-job claims; scope 2, the Not-in-CI bullet and the final report naming no 302 of 878 vitest files outside CI and no 64 of 73 `b16-0-*` suites; three records-only lines about commit 2/2; D24-3 `in part` where its clause gives closed offline. Green on the old pages: 5.2's computed column, the unknowns page's OD rows and the suite table (no present error; `close2fix-break-*` proves each check) |
| `close2fix-green-1`, `-2` | after the page fixes (the first caught one more unqualified every-job claim, in this report) | 11 passed; exit 0 |
| `close2fix-break-A` to `-D` | eight planted breakages in the real pages, each restored after its run (sha256 equal): OD-229 `applied`; the benchmark-quality rows deleted; 5.2's provider line `BLOCKED-LIVE-QUALIFICATION`; OD-241's heading cited one line low; section 2's heading at `7ce1236`; the defect tally `27 closed offline`; the verdict's CI line without its pull-request qualifier; `b24-f-maps` 9 cases | each caught: case 7 (OD-229's state, OD-241's heading, the defect counts, `b24-f-maps` 9 stated and 10 read), case 2 (benchmark-quality rows none; no table under section 2's heading; `final-verdict.md:19`), case 11 (provider computed `BLOCKED-LIVE-QUALIFICATION`, the rule `NOT READY`) |
| `close2fix-tsc-1`, `close2fix-eslint-1` | tsc; eslint on the one changed TypeScript file | 0; 0 |
| `close2fix-gen-*` | all 28 generators, twice | 56 runs, exit 0; zero drift but `gen-demo-fixtures`' CRLF rewrite of `app/lib/pcb/demo/fixtures.ts` (content identical; its LF bytes restored from `26dc8b8`, the tree then equal to the pre-run snapshot) |
| `close2fix-secret-scan` | the tree secret scan | 4,199 entries, 8 allowlisted lines, 0 hits; exit 0 |
| `close2fix-readers`, `close2fix-ast-gates` | the four reader suites; `b14-4-ast-import-gates` alone | 4 files, 49 passed; 22 passed (45.3 s); exit 0 each |
| `close2fix-final-qualification`, `-2` | `app/lib/qualification/__tests__` and the B21, B22 and B23 closeout tripwires, after the last edit of every page | the first red on case 2 alone: three every-job claims quoted in this section's own rows, rephrased; the second 53 files passed, 3 skipped (56); 552 tests passed, 15 skipped; exit 0 (no case added; no onTaskUpdate timeout) |
| `close2fix-final-pages` | the nine page suites of `close2-final-pages`, after the last edit of this page | 9 files, 81 passed; exit 0 |
