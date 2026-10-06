# B23 - test and validation report

Labels as in `README.md`: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED**, **PROPOSED**,
**RECORDED**, **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Every B23 suite runs offline in the default run, and none contacts a
provider: every manufacturer, assembler, distributor or quote provider is an in-process fake. The DFM and quote flow runs behind the
real egress boundary against `__tests__/_b23-b2-fake-provider.ts` - a forged registry row no reviewed registry holds, a transfer
descriptor reviewed against it, a fake resolver answering one public address and a fake transport that parses each request in the
process, so nothing connects anywhere. The order contract runs against an injected fake port (`_b23-c-ordering-fixture.ts`); the
release, observation and evidence suites build their inputs in memory (`_b23-b-release-fixture.ts`, `_b23-b3-observation-fixture.ts`,
`_b23-d-evidence-fixture.ts`). Every credential a suite needs is an obvious fake assembled at run time. One suite runs an in-process
PostgreSQL (PGlite): `database/__tests__/b23-b-exchange-ledger-pglite`, in CI's database-delivery job. No B23 suite starts Java,
ngspice, kicad-cli, docker or WSL.

## 1. Suites (case counts as `it(` blocks on the tree, and as the final run executed them)

An `it.each` table counts as one `it(` block in the source (the B21 and B22 pages' counter, `/^\s*it(?:\.each)?[(<]/gm`) and as one
test per row in a run. No B23 suite holds a typed `it.each<...>(` table; six untyped tables in four suites make those suites run more
tests than they have blocks: `b23-a-provider-registry` (15 blocks, 94 tests: 14 plus an 80-row table), `b23-a-cd12-stubs` (3, 9),
`b23-b-exchange-route` (12, 14) and `b23-b-revalidation` (7, 23). The run column is **CONFIRMED** from the final run's gate M
(section 2), which holds every suite below (`app/lib/manufacturing-providers`); none skipped a test.

| increment | suite | `it(` blocks | tests in the final run |
|---|---|---|---|
| A1 | `app/lib/manufacturing-providers/__tests__/b23-a-provider-admission.test.ts` | 11 | 11 |
| A1 | `app/lib/manufacturing-providers/__tests__/b23-a-provider-registry.test.ts` | 15 | 94 |
| A2 | `app/lib/manufacturing-providers/__tests__/b23-a-cd12-stubs.test.ts` | 3 | 9 |
| A2 | `app/lib/manufacturing-providers/__tests__/b23-a-no-order-structural.test.ts` | 6 | 6 |
| A2 | `app/lib/manufacturing-providers/__tests__/b23-a-route-vocabulary.test.ts` | 8 | 8 |
| A2 | `app/lib/manufacturing-providers/__tests__/b23-a-tier3-vocabulary.test.ts` | 9 | 9 |
| B1 | `app/lib/manufacturing-providers/__tests__/b23-b-approval-plan.test.ts` | 18 | 18 |
| B1 | `app/lib/manufacturing-providers/__tests__/b23-b-exchange-route.test.ts` | 12 | 14 |
| B1 | `app/lib/manufacturing-providers/__tests__/b23-b-outbound-package.test.ts` | 10 | 10 |
| B1 | `app/lib/manufacturing-providers/__tests__/b23-b-page.test.ts` | 5 | 5 |
| B1 | `app/lib/manufacturing-providers/__tests__/b23-b-provider-panel.test.tsx` | 9 | 9 |
| B1 | `app/lib/manufacturing-providers/__tests__/b23-b-revalidation.test.ts` | 7 | 23 |
| B2 | `app/lib/manufacturing-providers/__tests__/b23-b-bounded-upload.test.ts` | 10 | 10 |
| B2 (B3 +4) | `app/lib/manufacturing-providers/__tests__/b23-b-dfm-quote-flow-page.test.ts` | 10 | 10 |
| B2 | `app/lib/manufacturing-providers/__tests__/b23-b-egress-import-gate.test.ts` | 6 | 6 |
| B2 | `app/lib/manufacturing-providers/__tests__/b23-b-exchange-ledger.test.ts` | 28 | 28 |
| B2 | `app/lib/manufacturing-providers/__tests__/b23-b-provider-meter.test.ts` | 7 | 7 |
| B2 | `app/lib/manufacturing-providers/database/__tests__/b23-b-exchange-ledger-pglite.test.ts` | 5 | 5 |
| B3 | `app/lib/manufacturing-providers/__tests__/b23-b-no-auto-accept.test.ts` | 9 | 9 |
| B3 | `app/lib/manufacturing-providers/__tests__/b23-b-observation.test.ts` | 9 | 9 |
| B3 | `app/lib/manufacturing-providers/__tests__/b23-b-stale-quote.test.ts` | 14 | 14 |
| C | `app/lib/manufacturing-providers/__tests__/b23-c-order-contract.test.ts` | 16 | 16 |
| C | `app/lib/manufacturing-providers/__tests__/b23-c-ordering-disabled.test.tsx` | 7 | 7 |
| C | `app/lib/manufacturing-providers/__tests__/b23-c-purchase-authorization.test.ts` | 11 | 11 |
| C | `app/lib/manufacturing-providers/__tests__/b23-c-webhook-verification.test.ts` | 7 | 7 |
| D | `app/lib/manufacturing-providers/__tests__/b23-d-assembled-release-blocked.test.ts` | 6 | 6 |
| D | `app/lib/manufacturing-providers/__tests__/b23-d-latent-claim-paths.test.ts` | 6 | 6 |
| D | `app/lib/manufacturing-providers/__tests__/b23-d-physical-evidence-contract.test.ts` | 16 | 16 |
| closeout (1/2) | `app/lib/manufacturing-providers/__tests__/b23-closeout-statements.test.ts` | 8 | 8 |
| lead (`f0e7bae`) | `app/lib/manufacturing-providers/__tests__/b23-lead-wrapper-signal-retention.test.ts` | 1 | 1 |

**Total: 30 suites - 29 under `app/lib/manufacturing-providers/__tests__` and the PGlite suite under its `database/__tests__` - with
289 `it(` blocks and 392 tests in the final run, all passed.** By increment, as suites / `it(` blocks / tests run: A1 2 / 26 / 105, A2
4 / 26 / 32, B1 6 / 61 / 79, B2 6 / 66 / 66 (B3's four page cases among them), B3 3 / 32 / 32, C 4 / 41 / 41, D 3 / 28 / 28, the
closeout (1/2) 1 / 8 / 8, the lead's `f0e7bae` 1 / 1 / 1. The README's rows agree with the run column for A1 (94 + 11), A2 (32), B1
(79), B3 (32 and the page's +4), C (41), D (28) and the closeout (8); its B2 row gives `b23-b-exchange-ledger` 22, the PGlite suite 4
and `b23-b-dfm-quote-flow-page` 5 - the counts before B2's lead round, which made them 28, 5 and 6 (the page suite is 10 with B3's
four). B3 also added two cases to `app/api/pcb-sync/__tests__/b16-a-manufacturing-summary.test.ts` (the D23-17 counterexample); that
suite is outside the lead's chain and ran in gate S (section 2).

Load-sensitive cases the increments recorded, none failed in the final run: the single synchronous AST cases of
`b14-4-ast-import-gates` (gate F2, run alone) and `b20-b4-process-gate` (gate E) blocked a vitest worker's RPC under load ("Timeout
calling onTaskUpdate") until the lead's `9cb675d` and `4a988c8` made them yield (case 1 of `b20-b4-process-gate` still runs about 34 s
synchronously, recorded); `b23-b-page` case 4 timed out at vitest's 5 s default in CI on `0cd3f59` and carries a 120 s budget since
`a02c9fb`; `b22-a3-diagnostic-runner` case 13 lost its abort to a garbage collection in CI on `9cb675d`, root-caused and fixed in
`f0e7bae`, and now forces the collection on every run. No "onTaskUpdate" and no unhandled error appears in any final-run log.

## 2. The final validation run at HEAD `b6c6b0d` (2026-10-05/06, local)

The lead's gate chain (`scratchpad/b23/lead-gates.sh closeout2`, its output under `scratchpad/b23/logs/closeout2-*`), on a clean tree
at `b6c6b0d` (`git status` empty before and after: 0 lines), one heavy job at a time through the lead's lock scripts (vitest with 2
workers through `run.sh`; tsc, eslint and tsx with a 4 GB heap through `heavy.sh`; Playwright through `pw2.sh` under the same lock),
then the full existing browser suite and the orchestration config, one after the other. The chain excludes the three Java-capable
`app/lib/pcb` suites from gate J (`autoroute-boundary-integrity`, `autonomous-layout-qualification`, `manufacturing-release-gate`): no
gate log names any of them, and no real router ran. The vitest gates ran from 23:44:58 to 23:56:08; tsc 23:56:09 to 23:56:17; the
chain's eslint 23:56:17 to 23:57:09; the 21 generators 23:57:09 to 23:57:40; the chain ended at 23:57:41. Three stated additions,
under the same lock: eslint on the files B23 changed (after the chain, below), gate S (after the browser runs and the PNG restore),
and gate S2 (after the review round, at 00:40:10 on 2026-10-06: HEAD still `b6c6b0d`, the tree holding only the closeout's five
uncommitted documents, so the code it ran was `b6c6b0d`'s). **CONFIRMED** (every number below is from the run's logs).

| # | gate | start | test files | tests | duration | exit |
|---|---|---|---|---|---|---|
| M | `app/lib/manufacturing-providers` (every B23 suite), `app/lib/acquisition/__tests__`, `app/lib/release-engineering`, `app/lib/net`, `app/lib/distributors` | 23:44:58 | 65 passed, 1 skipped (66) | 821 passed, 2 skipped (823) | 119.96 s | 0 |
| A | computation, SPICE, simulate, model simulation, firmware bring-up, the CI job-scope guard | 23:46:59 | 37 passed, 3 skipped (40) | 632 passed, 21 skipped (653) | 40.68 s | 0 |
| J | `app/lib/pcb`, without the three Java-capable suites | 23:47:42 | 127 passed, 1 skipped (128) | 977 passed, 4 skipped (981) | 50.96 s | 0 |
| B | `app/lib/engineering/__tests__` | 23:48:34 | 99 passed (99) | 1107 passed (1107) | 70.10 s | 0 |
| C | `app/lib/agent/__tests__` (B11.5 case 12 among them) | 23:49:46 | 36 passed (36) | 415 passed (415) | 32.74 s | 0 |
| D | `app/lib/agent/orchestration/__tests__` (B21's closeout tripwire among them) | 23:50:20 | 49 passed (49) | 460 passed (460) | 54.84 s | 0 |
| E | `app/lib/mcp` (the B20-B4 process gate; the agent-tool counts, `b20-c1-three-way-parity.test.ts:241`) | 23:51:16 | 45 passed (45) | 825 passed (825) | 77.20 s | 0 |
| F | `app/api/chat`, `app/api/mcp`, the import gates, the route matrices and route tree, the wrapper and body gates, the B16.0.24.1 correction and tranche parity | 23:52:35 | 39 passed (39) | 357 passed (357) | 55.97 s | 0 |
| H | `app/api/__tests__` (the B16.1c census tripwires) | 23:53:33 | 27 passed (27) | 1059 passed (1059) | 35.46 s | 0 |
| F2 | `b14-4-ast-import-gates`, alone | 23:54:10 | 1 passed (1) | 22 passed (22) | 34.51 s | 0 |
| G | the registry-dependent set (the confinement gates, the auth composition with the route census) | 23:54:46 | 27 passed (27) | 375 passed (375) | 40.71 s | 0 |
| I | `app/lib/auth/__tests__` | 23:55:28 | 41 passed (41) | 479 passed, 9 skipped (488) | 40.15 s | 0 |
| S | added: six named places outside the chain - `app/lib/workflow/prompt-to-gerber/__tests__`, whose acceptance replays pin the 555 release identity; `app/api/pcb/qualify`; `app/api/pcb/release`; `app/api/pcb-sync/__tests__`, B3's two `b16-a-manufacturing-summary` cases among them; `app/lib/pcb-sync/__tests__`; `manufacturing-workflow-panel.test.tsx` (the first entries of CI's prompt-to-gerber job) | 00:07:20 | 19 passed (19) | 177 passed, 1 skipped (178) | 16.23 s | 0 |
| S2 | added after the review round: the eleven suites outside every gate above that directly read a file B23 changed (the selection below) - `b18-a-autonomy-route`, `b18-b-execution-grant-route`, `b16-0-1-signin`, `b16-0-2-bom-ownership`, `b19-bom-quota`, `b16-0-2-engineering-export`, `b19-e-successor-rebind`, `pcb-sync-authority` (B3's `client.ts` and `handler.ts`), `b19-e-adopt-exact-revision`, `b19-e-publication-fake-vendors`, `b19-e-bom-sources` - and `app/api/passive-policy/__tests__/route-security`, which the review named (it reaches `route-policy.ts` through its handler: `handler.ts` -> `_scope.ts` -> `app/lib/auth/authorize.ts:21`, its route's policy row; [B23 closeout lead, 2026-10-06] corrected from "through its route", since the suite imports `../handler`, never `route.ts`) | 00:40:10 | 12 passed (12) | 100 passed, 1 skipped (101) | 11.79 s | 0 |

Vitest, the lead's twelve gates: **7,529 tests passed and 36 skipped, no failure** (a file can sit in more than one gate). Every skip
is an opt-in case skipped without its setting: in gate M `b19-e-live-contract` (2, `SIRKIT_LIVE_ACQUISITION_CONTRACT`); in gate A the
two B22 live suites (`b22-a3-runner-live` 5, `b22-d-adversarial-live` 13) and `app/lib/spice/__tests__/worker-integration` (3); in gate
J `electrical-identity-boundary` (1), `ingest-integrity` (1) and the kicad-cli oracle (2); in gate I LB-1's live authentication
qualification (`b16-1b-live-qualification`, 9 of its 10). The numbers equal the closeout (1/2)'s lead chain (`co1`, run on that
commit's working tree before it was committed), gate for gate. Gate S, run after the browser runs and the PNG restore: 177 passed and 1 opt-in
skipped (`app/api/pcb-sync/__tests__/route.test.ts`'s database qualification, `SIRKIT_DB_QUALIFICATION`); its `acceptance-pipeline` (11
of 11) replays the prompt-to-gerber run and compares it with the committed identities (`fixtures/expected-identities.json`: the 555
release `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd`), so the pinned release identity holds at HEAD.

Gate S2 (`closeout2fix-gate-S2.log`): 100 passed and 1 opt-in skipped (`pcb-sync-authority`'s database qualification,
`SIRKIT_DB_QUALIFICATION`), no "onTaskUpdate" and no unhandled error. Its selection is CONFIRMED by `scratchpad/b23/co2fix/readers.mjs`
(reads only; `closeout2fix-readers-before-S2.txt`, then `closeout2fix-readers.txt` with the S2 log): 269 suites import, spell the
path of, or are a file B23 changed; 257 of them ran in the chain and gate S, the eleven others ran in gate S2, and the one left is the
Java-capable `manufacturing-release-gate.test.ts`, excluded by rule (the lead ran it once in B23-D, 5 of 5). Seven of the eleven are
in a CI job (six in prompt-to-gerber, `b19-e-publication-fake-vendors` in database-delivery; both green on `b6c6b0d`);
`b16-0-1-signin`, `b16-0-2-bom-ownership`, `b16-0-2-engineering-export` and `pcb-sync-authority` are in none. Before S2 those four
last ran in B23's own reader runs: the three route-policy readers (with `route-security`) in the closeout (1/2)'s reader gate
(`co1fix-gate-readers.log`, 28 files, 320 passed, 1 skipped), and `pcb-sync-authority` in B3's fix round (`b3f-14`, 2026-10-04
20:46, 35 minutes before `8bca09e` was committed); no commit after `8bca09e` touches `client.ts` or `handler.ts`. Not selected: a
suite that reaches a B23-changed file only through its imports. 124 suites outside every gate do (`scratchpad/b23/co2fix/transitive.mjs`,
`closeout2fix-transitive.txt`: a suite that imports a canonical route reaches `route-handlers.ts` through its wrapper, for one), and
a CI filter admits 61 of them (CI green on `b6c6b0d`); as in every B23 increment, the rest of the suite was not run locally.

After the review round's corrections (documents only: the four artifacts and the README row), the lead's chain re-ran on that tree,
HEAD still `b6c6b0d` (`lead-gates.sh closeout2fix`, `closeout2fix-lead-*`, 00:53:57 to 01:06:05): every gate's file and test counts
equal the table above (7,529 passed, 36 skipped, every gate exit 0, no "onTaskUpdate"), tsc 0, the whole-project eslint the same 69
problems line for line (exit 1), and the 21 generators exit 0 with zero drift (status and diff hash equal before and after). Then
eslint on the 92 files B23 changed: exit 0 (`closeout2fix-eslint-b23files.log`), and the three page tripwires with every B23 page
suite, B11.5 and `b20-b4-withhold-proposals` on the corrected pages: 33 files, 432 passed (`closeout2fix-pagechecks-final.log`). The
browser configs were not re-run: no source, spec or UI changed since their runs, and no browser spec reads a B23 page.

- **tsc** `--noEmit -p tsconfig.json`: exit 0, no output.
- **eslint, as the chain ran it: exit 1 - recorded, not a B23 finding.** On a clean tree the chain's file list (`git diff --name-only`
  plus untracked files) is empty, and `eslint` with no file argument lints the whole project: 69 problems (33 errors, 36 warnings) in
  37 files, the 33 errors in 14 of them (`closeout2-lead-eslint.log`, 533 lines). None of the 37 files was changed by B23 (`git
  log 43cb1b0..HEAD -- <file>` empty for each), and `eslint.config.mjs`, `package.json` and `tsconfig.json` are unchanged since
  `43cb1b0`: the 37 files and the configuration are byte-identical to `main`, so the same problems stand on `main` (INFERRED: `main`
  was not linted here). The errors: 30 react-hooks errors (`set-state-in-effect` 14, `refs` 15, `purity` 1) - 14 in `app/page.tsx`
  (its react-hooks errors recorded since B21), 4 in `app/components/bom/BomView.tsx` and 12 in ten PCB editor components and hooks -
  two `prefer-const` errors in `b14-replacement-proposal.test.ts` and one `@next/next/no-assign-module-variable` in
  `b16-0-2-session-identity.test.ts`. No CI workflow runs eslint (`grep lint .github/workflows/*.yml` is empty). Every earlier B23
  chain ran on a working tree with the increment's changes, so its eslint covered those files only; B22's closeout met the same
  empty list and linted its changed files instead.
- **eslint on the files B23 changed** (the stated addition, B22's selection: `git diff --name-only --diff-filter=d 43cb1b0..HEAD |
  grep -E '\.(ts|tsx|mjs)$'`, 92 files - 87 TypeScript, 5 TSX, no .mjs; `co2/eslint-files.txt`): exit 0, no output (23:58:39 to
  23:58:45, `closeout2-eslint-b23files.log`).
- **Generators**: all 21 of the chain's generators ran with exit 0 (among them B01 106 action records and 152 route coverage entries;
  B09 36 statically exposed tools of 47 registered; B04 47 descriptors, 41 callable, 6 not callable, 36 agent-exposed; B11 19 of 19
  cases and 61 of 61 checks; B16.0.4 166 rows; B16.0.7 166 methods = 163 canonical wrappers, 3 factories, 0 raw; B17-A 631 controls on
  63 surfaces; B19 source registry 1.1.0, 4 sources; the B20 MCP parity 9 of 36 agent-exposed, 27 agent-only; the B20 manifest 9
  exposed, 38 excluded; B21 12 matrix rows and 7 orchestration replays pinned; the B23 provider registry 1.0.0, 9 providers), and the
  tree's status and its diff hash were identical before and after (both empty): **zero drift**.
- **Route census**: 166 = 163 canonical + 3 factories + 0 raw (`b16-1c-invariant-tripwires`, gates F and H; `b16-1b-auth-composition`,
  gates G and I) - moved once in B23, by B23-B1's review (OD-174).
- **Agent-tool counts**: 47 registered, 36 agent-exposed, 9 MCP-exposed, 27 agent-only (`b20-c1-three-way-parity.test.ts:241`, gate
  E) - unchanged by B23.
- **Browser, the full existing suite** (`playwright.config.ts`, `e2e/`): 48 of 48 passed (Playwright: 4.3 min;
  `closeout2-pw-existing.log`), 23:59:02 to 00:03:20, **257 s of wall time** (`pw2.sh`'s own line, `playwright-exit=0 wall=257s`; the
  wrapper's exit 0).
- **Browser, the orchestration config** (`playwright.orchestration.config.ts`, `e2e-orchestration/`, run after the existing suite): 4
  of 4 passed (Playwright: 2.5 min; tests 1-3 F2's, test 4 F2b's; `closeout2-pw-orch.log`), 00:03:35 to 00:06:05, **149 s of wall
  time** (`pw2.sh`'s own line, `playwright-exit=0 wall=149s` - printed since B23-B1's lead close made the wrapper spare its own shell;
  the wrapper's exit 0).
- **OD-30's budget**: 257 + 149 = 406 s, about 6.8 minutes of the page-browser-e2e job's 30 minutes (locally; CI ran both configs in
  that job in 20 min 25 s on `b6c6b0d`).
- **Evidence PNGs**: the two runs rewrote 32 tracked PNGs (the existing suite 25 - 5 under `artifacts/ai-control-plane-b17/evidence`,
  20 under `artifacts/ai-control-plane-b18/evidence`; the orchestration config the 7 under `artifacts/ai-control-plane-b21/evidence`)
  and no other tracked file; all 32 restored from HEAD by blob hash (`git cat-file blob` of `HEAD:<path>`, then `git hash-object` equal
  to the blob id, 32 of 32; none was byte-identical before the restore), `git status` empty afterwards (00:07:13).
- **Provider and process calls**: no provider was called in any gate, and no gate started Java, ngspice, kicad-cli, docker or WSL (the
  three Java-capable suites excluded; the kicad-cli oracle and every live suite skipped; every other spawn a fake at its suite's seam).
  The browser runs are the fixture runtime's: every chat turn is the scripted fixture agent's, and no browser spec reaches a provider
  exchange (`e2e/` and `e2e-orchestration/` name no `provider-exchange` path, and neither log holds a request to one). The server's
  `missing_credentials` lines (3 in the existing suite's log, 1 in the orchestration log) are the fixture runtime's answer to a model
  request, as B22's report records it, not a measured absence of keys; whether the server held a provider key is UNKNOWN (not
  measured); no environment file was read.

## 3. CI on every B23 commit

Read with `gh run list --branch chapter/b23-external-manufacturing` and `gh run view <id> --json jobs` (read-only). Both workflows run
on PR #14 (`pull_request`), opened as a draft on 2026-10-02 at 14:24:59 UTC after `3806cba` was pushed: `deterministic-manufacturing`
(jobs prompt-to-gerber, database-delivery, page-browser-e2e) and `benchmark-quality` (benchmark-core; benchmark-nightly skipped on
pull requests). `e8c7928` was pushed with `3806cba` before the PR existed and has no run of its own.

| commit | subject | deterministic-manufacturing | its jobs: prompt-to-gerber / database-delivery / page-browser-e2e | benchmark-quality |
|---|---|---|---|---|
| `e8c7928` | B22 closeout tripwire: explicit timeouts | no run (pushed with `3806cba`, before the PR) | - | no run |
| `3806cba` | B23 discovery | success (`37019715431`) | 13m39s / 2m25s / 20m05s, each success | success (`37019714642`) |
| `4a988c8` | B20-B4 process gate yields | success (`37031824874`) | 13m23s / 1m37s / 20m20s, each success | success (`37031824849`) |
| `9cb675d` | B14.4 AST gate yields | **failure** (`37035281416`) | **failure** 13m33s (the vitest step: `b22-a3-diagnostic-runner` case 13, "timed out waiting for the abort's tree kill", as the ledger records it) / 2m19s success / 17m59s success | success (`37035281458`) |
| `79fa18b` | B23-A1 | success (`37035444941`) | 13m26s / 2m20s / 19m53s, each success | success (`37035444805`) |
| `f0e7bae` | route wrappers keep the Request alive (fixes `9cb675d`'s failure) | success (`37173485652`) | 12m53s / 2m15s / 19m57s, each success | success (`37173485653`) |
| `da36d51` | B23-A2 | success (`37173545599`) | 11m52s / 1m30s / 20m19s, each success | success (`37173545557`) |
| `0c78e93` | B23-B1 | success (`37182295085`) | 11m13s / 2m20s / 12m18s, each success | success (`37182295081`) |
| `0cd3f59` | B23-B2 | **failure** (`37236111734`) | **failure** 15m08s (the vitest step: `b23-b-page` case 4, "Test timed out in 5000ms") / 1m38s success / 19m51s success | success (`37236111729`) |
| `a02c9fb` | explicit budgets for two CPU-bound cases (fixes `0cd3f59`'s failure) | **failure** (`37250973885`) | **failure** 1m31s (`tsc --noEmit`: TS2554, a second timeout on `b23-b-approval-plan` case 18) / 1m37s success / 17m48s success | **failure** (`37250973897`: benchmark-core at `tsc --noEmit`) |
| `8bca09e` | B23-B3 | **failure** (`37251095483`) | **failure** 1m29s (`tsc --noEmit`, the same TS2554) / 2m48s success / 15m31s success | **failure** (`37251095427`: benchmark-core at `tsc --noEmit`) |
| `d5f5512` | restores case 18 (fixes `a02c9fb`'s and `8bca09e`'s failures) | success (`37259304694`) | 15m41s / 1m58s / 11m40s, each success | success (`37259304701`) |
| `4e71563` | B23-C | success (`37263704935`) | 16m15s / 2m18s / 17m57s, each success | success (`37263704951`) |
| `dfd51e3` | B23-D | success (`37285145957`) | 14m49s / 1m45s / 13m50s, each success | success (`37285145923`) |
| `b6c6b0d` | closeout (1/2) | success (`37410317063`) | 17m31s / 2m23s / 20m25s, each success | success (`37410317237`) |

Four commits ran red, and each failure has a later fixing commit with every job green: `9cb675d`'s (an abort lost to a garbage
collection in the route wrappers; the next commit `79fa18b` already ran green, and the lead root-caused it and fixed it in `f0e7bae`,
whose run is green); `0cd3f59`'s (a CPU-bound case on the 5 s default; budgeted by `a02c9fb`); `a02c9fb`'s and `8bca09e`'s (tsc TS2554
from `a02c9fb`'s second timeout, which also stopped those runs before their tests; restored by `d5f5512`, green). The failing step of
each red job is CONFIRMED from `gh run view --json jobs`; the failing case of `9cb675d` and `0cd3f59` is as the ledger and the fixing
commits record it (the job logs were not read). The failed step names are the vitest step for `9cb675d` and `0cd3f59` and `Run pnpm
exec tsc --noEmit` for `a02c9fb` and `8bca09e`. Every run since `d5f5512` is green. `b6c6b0d` (the closeout (1/2), HEAD of the final
run) completed green on 2026-10-06 at 04:03:53 UTC, its page-browser-e2e job running both Playwright configs in 20 min 25 s.

## 4. Gates as the ledger and the commit messages record them

Each increment's own gates are on its page and in its ledger entry; the lead's gates on the final tree are in its commit message
(B23-A1 and B23-A2's ledger entries defer to it). Quoted in substance; a figure the records state differently is named.

| commit | the lead's gates on the final tree (commit message) | the ledger's gate line |
|---|---|---|
| `e8c7928` | the three page-scanning tripwires 3 files 27 of 27 (case 3 5,353 ms); eslint on the file 0 | "The three page-scanning tripwires then passed 27 of 27." |
| `3806cba` | documents only; the tripwires 3 files 27 of 27; the record readers 54 files 534 tests | "Gates for this commit: documents only." |
| `4a988c8` | the gate alone 5 of 5, exit 0 (56 s); the four reader suites 4 files 34 of 34 | A1's lead close (2): the gate alone passes 5 of 5 with exit 0 |
| `9cb675d` | the gate alone exit 0 twice (53.8 s, 57.0 s) and, with case 1 yielding, 67.1 s; beside B11.5 2 files 40 of 40, exit 0, twice | A1's lead close (2): alone exit 0 twice, beside B11.5 40 of 40, tsc and eslint 0 |
| `79fa18b` A1 | M 37 files 534 passed 2 skipped; A 632 passed 21 skipped; J 129 files 987 passed 4 skipped (without `autoroute-boundary-integrity` only); B 1,107; C 415; D 460; E 825; F 357; H 1,059; G 375; I 479 passed 9 skipped; F2 22 of 22 but exit 1 (onTaskUpdate, fixed by `9cb675d`); tsc 0; eslint 0; 21 generators no drift; census 165/162/3/0 | "Lead gates on the final tree are in the commit message"; 105 tests green. B1's lead close (1) records that this gate J ran `autonomous-layout-qualification`, which printed three real golden FreeRouting runs |
| `f0e7bae` | the chain `a2r` on the tree with A2's files: M 42 files 567 passed 2 skipped; A 632 / 21; J 129 files 987 / 4; B 1,107; C 415; D 460; E 825; F 357; H 1,059; F2 22; G 375; I 479 / 9; tsc 0; eslint 0; 21 generators no drift | A2's lead close: the same chain re-run after a session restart, every set exit 0 |
| `da36d51` A2 | the same `a2r` chain; after the records the page tripwires and readers 197 of 197 | review round: providers + acquisition 350 passed 2 skipped; engineering 1,107; agent + orchestration 875; mcp + auth 1,304 passed 9 skipped; api + chat 1,208; computation + release-engineering 310 passed 18 skipped; b14-4 22; 21 route-reader files 264 passed 1 skipped; closeouts 19; tsc 0; eslint 0 on 20 files; 8 generators (the classification's two columns the only drift); then the lead round's 42 of 42 |
| `0c78e93` B1 | `b1`: M 646 passed 2 skipped; A 632 / 21; J 977 / 4 (three Java-capable suites excluded from here on); B 1,107; C 415; D 460; E 825; F 357; H 1,059; F2 22; G 375; I 479 / 9; tsc 0; eslint 0; 21 generators no drift; tripwires and readers 276 of 276 | review round 281 of 281 and six more sets, tsc 0, eslint 0 on 24 files; lead round readers 263 then 268, tsc 0, eslint 0 on 5 files; browser 48 of 48 (4.9 min) and 4 of 4 (2.5 min), 32 PNGs restored by blob hash |
| `0cd3f59` B2 | `b2` (resumed from F2 after a session restart): M 54 files 708 passed 2 skipped; A 632 / 21; J 127 files 977 / 4; B 1,107; C 415; D 460; E 825; F 357; H 1,059; F2 22; G 375; I 479 / 9; tsc 0; eslint 0; 21 generators; 333 of 333 | review round readers 396 then 413, database-delivery 139 passed 12 skipped, six more sets, tsc 0, eslint 0 on 17 files; lead round readers 377 then 403, manufacturing-providers 279, eslint 0 on 8 files; no UI change, no browser run |
| `a02c9fb` | `b23-b-page` 5 of 5, `b23-b-approval-plan` 18 of 18; eslint on both 0; tsc not run (C's lead close (1)) | B3's lead close (5) |
| `8bca09e` B3 | `b3`: M 744 passed 2 skipped; A 632 / 21; J 977 / 4; B 1,107; C 415; D 460; E 825; F 357; H 1,059; F2 22; G 375; I 479 / 9; tsc 0; eslint 0; 21 generators; browser 48 of 48 and 4 of 4; 369 of 369. The chain's tsc ran at 21:08:42, before `a02c9fb` was committed (21:19:14); CI's tsc on `8bca09e` failed with `a02c9fb`'s TS2554 | B3's lead close (3)-(4): the same, browser 4.5 min and 2.5 min |
| `d5f5512` | tsc exit 0 (on the tree with C's files); `b23-b-approval-plan` 18 of 18 | C's lead close (1): "Rule since: tsc runs before every commit that touches a `.ts` file." |
| `4e71563` C | `c`: M 785 passed 2 skipped; A 632 / 21; J 977 / 4; B 1,107; C 415; D 460; E 825; F 357; H 1,059; F2 22; G 375; I 479 / 9; tsc 0; eslint 0; 21 generators; browser 48 of 48 and 4 of 4; 410 of 410 | the low round: manufacturing-providers 351, engineering 1,107, agent + orchestration 875, mcp 825, b14-4 22, pages and closeouts 105; lead close (3)-(4): browser 7.5 min and 2.7 min |
| `dfd51e3` D | `d`: M 813 passed 2 skipped; A 632 / 21; J 977 / 4; B 1,107; C 415; D 460; E 825; F 357; H 1,059; F2 22; G 375; I 479 / 9; tsc 0; eslint 0; 21 generators; browser 48 of 48 and 4 of 4; 436 of 436 | increment 391 then 394, 396 after the two low rounds; lead close: `manufacturing-release-gate.test.ts` once, 5 of 5 (10.7 s); browser 7.3 min and 2.7 min (31 PNGs rewritten, 32 equal by blob hash) |
| `b6c6b0d` closeout (1/2) | `co1` (resumed from H after a session restart): M 821 passed 2 skipped; A 632 / 21; J 977 / 4; B 1,107; C 415; D 460; E 825; F 357; H 1,059; F2 22; G 375; I 479 / 9; tsc 0; eslint 0; 21 generators; 444 of 444 | thirteen sets (30 / 400, 1 / 5, 2 / 19 ...), tsc 0, eslint 0 on nine files, 21 generators; no UI change, no browser run |

The final run in section 2 repeats the closeout (1/2)'s lead chain with identical numbers in every vitest gate, tsc and the
generators; its eslint step differs only because the tree was clean (section 2).
