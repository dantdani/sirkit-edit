# B22 - test and validation report

Labels as in `README.md`: **CONFIRMED** (executed and measured), **INFERRED**, **PROPOSED**, **RECORDED**, **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION**. Every suite below runs offline in the default run: no suite calls a provider or starts ngspice,
kicad-cli, Java, docker or WSL, and every write goes to a temporary tree or an fs fake. Each process spawn is a fake at the seam its
suite names: the diagnostic runner's at `node:child_process` (`sec-1-deck-injection`, `b22-a1-diagnostic-bounds`, `b22-a1-model-screen`,
`b22-a3-diagnostic-runner`, `b22-d-adversarial`), kicad-cli's and FreeRouting's at the bare `child_process` specifier
(`b22-a1-tool-output-bounds`, `b22-a1-secret-env`), the job store's at its worker module `@/app/lib/spice/server/worker`
(`b22-c-job-store-terminal`), and the diagnostic runner module itself where a suite needs no spawn (`b22-b-approval`,
`b22-c-output-validator`). Three B22-B suites start real Node worker threads inside the test process, on real time: `b22-b-bounded-host`
(the production engine entry in case 1, test fixture entries under `__tests__/fixtures` in cases 1-5; the host's id check stays closed),
`b22-b-exposure` cases 7 (the default port over the real engine host, end to end) and 9 (a real busy-loop fixture worker, cancelled),
and `b22-b-chat-runtime` cases 2 and 3 (the chat route's port over the real engine host). `b22-b-bounded-host` case 1 first asserts that
the vitest process carries no V8 heap-size flag in its `execArgv` or `NODE_OPTIONS`, so it would fail under a runner that sets one - the
lead's `heavy.sh` exports `NODE_OPTIONS=--max-old-space-size=4096`; `run.sh`, which every vitest gate in this report used, sets none
(INFERRED from the code; not run that way). Two B22 suites run a real ngspice and are opt-in, never in CI: `b22-a3-runner-live` (`SIRKIT_B22_LIVE_RUNNER=1`, 5 cases) and
`b22-d-adversarial-live` (the same flag, 13 cases); the lead ran each once on the pinned install (5 of 5 on 2026-10-01; 12 of 13 on
2026-10-02, case 4 NOT CONTAINED - `adversarial-matrix.md` section 10). They are skipped in every run this report records.

## 1. Suites (case counts as `it(` blocks on the tree, and as the final run executed them)

An `it.each` table - typed (`it.each<...>(`) or not - counts as one `it(` block in the source (the A1 page's own counter,
`/^\s*it(?:\.each)?[(<]/gm`, `b22-a1-page` case 6) and as one test per row in a run, so four suites run more tests than they have blocks
(`b22-a1-model-screen`, `b22-a1-spice-ai-approval`, `b22-a1-tool-output-bounds`, `sec-1-deck-injection`). The run column is
**CONFIRMED** from the final run's gate A (section 2), which holds every suite below.

| increment | suite | `it(` blocks | tests in the final run |
|---|---|---|---|
| SEC-1 | `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` | 47 | 268 |
| A1 | `app/lib/computation/__tests__/b22-a1-diagnostic-bounds.test.ts` | 9 | 9 |
| A1 | `app/lib/computation/__tests__/b22-a1-model-screen.test.ts` | 23 | 81 |
| A1 | `app/lib/computation/__tests__/b22-a1-page.test.ts` | 7 | 7 |
| A1 | `app/lib/computation/__tests__/b22-a1-secret-env.test.ts` | 2 | 2 |
| A1 | `app/lib/computation/__tests__/b22-a1-spice-ai-approval.test.ts` | 4 | 18 |
| A1 | `app/lib/computation/__tests__/b22-a1-tool-output-bounds.test.ts` | 18 | 20 |
| A2 | `app/lib/computation/__tests__/b22-a2-blocked-runner.test.ts` | 6 | 6 |
| A2 | `app/lib/computation/__tests__/b22-a2-process-census.test.ts` | 7 | 7 |
| A2 | `app/lib/computation/__tests__/b22-a2-runtime-profile.test.ts` | 18 | 18 |
| A3 | `app/lib/computation/__tests__/b22-a3-diagnostic-runner.test.ts` | 14 | 14 |
| A3 | `app/lib/computation/__tests__/b22-a3-runner-live.test.ts` | 5 | 5 (5 skipped: opt-in live) |
| A3 | `app/lib/computation/__tests__/b22-a3-single-spawner.test.ts` | 4 | 4 |
| B | `app/lib/computation/__tests__/b22-b-approval.test.ts` | 8 | 8 |
| B | `app/lib/computation/__tests__/b22-b-bounded-host.test.ts` | 9 | 9 |
| B | `app/lib/computation/__tests__/b22-b-catalog.test.ts` | 7 | 7 |
| B | `app/lib/computation/__tests__/b22-b-chat-runtime.test.ts` | 4 | 4 |
| B | `app/lib/computation/__tests__/b22-b-exposure.test.ts` | 9 | 9 |
| B | `app/lib/computation/__tests__/b22-b-no-generic-exec.test.ts` | 5 | 5 |
| C | `app/lib/computation/__tests__/b22-c-ai-evidence.test.ts` | 4 | 4 |
| C | `app/lib/computation/__tests__/b22-c-authority.test.ts` | 8 | 8 |
| C | `app/lib/computation/__tests__/b22-c-deck-validator.test.ts` | 8 | 8 |
| C | `app/lib/computation/__tests__/b22-c-evidence-store.test.ts` | 8 | 8 |
| C | `app/lib/computation/__tests__/b22-c-job-store-terminal.test.ts` | 10 | 10 |
| C | `app/lib/computation/__tests__/b22-c-output-validator.test.ts` | 10 | 10 |
| C | `app/lib/computation/__tests__/b22-c-wording.test.ts` | 5 | 5 |
| D | `app/lib/computation/__tests__/b22-d-adversarial-live.test.ts` | 13 | 13 (13 skipped: opt-in live) |
| D | `app/lib/computation/__tests__/b22-d-adversarial.test.ts` | 10 | 10 |
| closeout | `app/lib/computation/__tests__/b22-closeout-statements.test.ts` | 9 | 9 |

**Total: 29 suites - 28 B22 suites under `app/lib/computation/__tests__` and SEC-1's under `app/lib/spice/__tests__` - with
291 `it(` blocks and 586 tests in the final run** (568 run and passed, 18 skipped: the two opt-in live suites). By increment, as `it(`
blocks / tests run: SEC-1 47 / 268, A1 63 / 137, A2 31 / 31, A3 23 / 23 (5 skipped), B 42 / 42, C 53 / 53, D 23 / 23 (13 skipped),
closeout 9 / 9. The B22 suites alone: 28 suites, 244 blocks, 318 tests (300 run, 18 skipped) - the figure the closeout (1/2)'s ledger
entry gives as "A 300 (+18 skipped)". Each increment's page and README row counts agree with the run column (A1 137 after the A1 lead's
three cases; A2 31; A3 14 + 4 + 5; B 42; C 53; D 10 + 13; closeout 9; SEC-1 268), and the A1 page's block column with this one (23 and 4
for the two suites with typed tables).

Load-sensitive cases the increments recorded (none failed in the final run): the single synchronous AST cases of
`b14-4-ast-import-gates` (gate F2, run alone here, as the lead's chains run it) and `b20-b4-process-gate` (gate E) block a vitest
worker's RPC under load ("Timeout calling onTaskUpdate", B22-A3's lead gates: each passes alone); `b22-a3-diagnostic-runner` case 10's
intermittent timeout was a test bug (an exact call count skipped between polls under load) fixed in B22-B by at-least waits, the order
still asserted. By reading the suites (no increment recorded these, and none failed): `b22-b-exposure` cases 6 (a cancellation answered
within 2 s) and 9 (the cancelled worker stopped within the kind's budget) assert real-time upper bounds, and the real-worker cases named
above (`b22-b-bounded-host` cases 1-5, `b22-b-exposure` case 7, `b22-b-chat-runtime` cases 2 and 3) run on real time, so load can slow
them. No "onTaskUpdate" or unhandled error appears in any final-run log.

## 2. The final validation run at HEAD `85439e7` (2026-10-02, local)

The lead's gate chain (`scratchpad/b22/c-lead-gates.sh`), its gates in the same order, its output under `scratchpad/b22/closeout2/gates/`
(`closeout2/c2-final-run.sh`), on a clean tree at `85439e7` (`git status` empty before and after: 0 lines each), one heavy job at a time
through the lead's lock scripts (vitest with 2 workers through `run.sh`; tsc, eslint and tsx with a 4 GB heap through `heavy.sh`;
Playwright through `pw.sh` under the same lock), then the full existing browser suite and the orchestration config, one after the other.
Every lock-script exit line was captured but the orchestration config's (below). Three stated deviations: gate J (`app/lib/pcb`, which
B22-A1 changed and the lead's B22-D and closeout (1/2) chains ran) is appended after gate I; eslint lints the 130 files B22 changed
since `main` `d0d2ec8` - 121 TypeScript and 9 .mjs (`app/lib/computation/engine-worker.mjs` and eight test fixtures under
`app/lib/computation/__tests__/fixtures/`), selected by `git diff --name-only --diff-filter=d d0d2ec8..HEAD | grep -E '\.(ts|tsx|mjs)$'`
(at a clean HEAD the chain's working-tree list is empty, and an empty list would lint the whole project); and the chain records each
gate's start and end time. The vitest gates ran from 07:10:46 to 07:19:05 (gate J's end); the whole chain, tsc, eslint and the 20
generators included, ended at 07:19:53. **CONFIRMED** (every number below is from the run's logs).

| # | gate | test files | tests | duration | exit |
|---|---|---|---|---|---|
| A | computation, SPICE, simulate, CD-10 and firmware bring-up, the CI job-scope guard (every B22 and SEC-1 suite) | 37 passed, 3 skipped (40) | 631 passed, 21 skipped (652) | 35.99s | 0 |
| B | `app/lib/engineering/__tests__` | 99 passed (99) | 1107 passed (1107) | 66.69s | 0 |
| C | `app/lib/agent/__tests__` (the B11 suites among them, B11.5 case 12 included) | 36 passed (36) | 415 passed (415) | 30.16s | 0 |
| D | `app/lib/agent/orchestration/__tests__` (B21, its closeout tripwire among them) | 49 passed (49) | 460 passed (460) | 50.77s | 0 |
| E | `app/lib/mcp` (the B20 page citations, the MCP server and its process gate) | 45 passed (45) | 825 passed (825) | 68.73s | 0 |
| F | `app/api/chat`, `app/api/mcp`, the import gates, the route matrices and route tree, the wrapper and body gates, the B16.0.24.1 correction and tranche parity | 39 passed (39) | 357 passed (357) | 45.35s | 0 |
| H | `app/api/__tests__` | 27 passed (27) | 1059 passed (1059) | 31.46s | 0 |
| F2 | `b14-4-ast-import-gates`, alone | 1 passed (1) | 22 passed (22) | 15.29s | 0 |
| G | the registry-dependent set (the retitled B15/B16 suites, the confinement gates, the auth composition with the route census) | 27 passed (27) | 375 passed (375) | 37.15s | 0 |
| I | `app/lib/auth/__tests__` | 41 passed (41) | 479 passed, 9 skipped (488) | 37.07s | 0 |
| J | `app/lib/pcb` (appended; its `autoroute-boundary-integrity` started the real bundled FreeRouting twice - below) | 130 passed, 1 skipped (131) | 989 passed, 4 skipped (993) | 64.85s | 0 |

Vitest: **6,719 tests passed and 34 skipped across the eleven gates, no failure** (a file can sit in more than one gate). Every skip is
an opt-in case skipped without its setting: in gate A the two B22 live suites (5 + 13) and `app/lib/spice/__tests__/worker-integration`
(3, `SPICE_WORKER_LIVE`); in gate I LB-1's live authentication qualification (`b16-1b-live-qualification`, 9 of its 10 cases); in gate J
the two database-qualification cases (`electrical-identity-boundary`, `ingest-integrity`) and the kicad-cli oracle's two (no `KICAD_CLI`).
The numbers equal the closeout (1/2)'s lead chain on the same tree, gate for gate.

- **tsc** `--noEmit -p tsconfig.json`: exit 0, no output.
- **eslint** on the 130 files B22 changed since `main` (121 TypeScript, 9 .mjs; the selection above, `gates/eslint-files.txt`): exit 0,
  no output - all clean. B22 did not change `app/page.tsx` (its pre-existing react-hooks errors, recorded by B21, are outside this
  list).
- **Generators**: all 20 of the chain's generators ran with exit 0 (among them B11 19 of 19 cases and 61 of 61 checks; B09 36 exposed
  tools of 47 registered; B04 47 descriptors, 41 callable, 6 not callable, 36 agent-exposed; B21 12 matrix rows and 7 orchestration
  replays pinned; B17-A 628 controls on 62 surfaces; the B20 MCP manifest 9 exposed, 38 excluded; the B16.0.2 classification CSV), and
  the tree's status and its diff hash were identical before and after: **zero drift**.
- **Route census**: 165 = 162 canonical + 3 factories + 0 raw (`b16-1b-auth-composition`, gates G and I; `b16-1c-invariant-tripwires`,
  gates F and H) - unchanged by B22, which added no route.
- **Production simulation authority** (gate A): `b22-a2-blocked-runner` - `executeAuthoritativeSimulation` throws, the execute route's
  501 text, its 409 and its AI 403 byte-for-byte in the source, a self-declared validated body refused 409 with a closed code (case 4,
  B22-C's reviewed pin move) and every runtime profile refused 409; `b22-c-authority` case 2 - the server's own copies pass the binding
  and still end 409 with no code, no server provider or profile validated.
- **Browser, the full existing suite** (`playwright.config.ts`, `e2e/`): 48 of 48 passed (Playwright: 4.3 min; `pw-existing.log`),
  07:22:09 to 07:26:26, **256 s of wall time** (the lock script's own line; exit 0).
- **Browser, the orchestration config** (`playwright.orchestration.config.ts`, `e2e-orchestration/`, the flag on, run after the existing
  suite): 4 of 4 passed (Playwright: 2.5 min; tests 1-3 F2's, test 4 F2b's; `pw-orchestration.log`). `pw.sh`'s own `playwright-exit=`
  and wall line was not printed for this run, as at B21's closeout: its output stops at the cleanup line (`leftover-count=0`), and its
  lock directory was left behind with its holder gone (removed after the run, the holder's pid checked dead). The wrapper did record
  `orchestration exit=0` (`c2-browser.sh`'s `C2=$?`, `browser-summary.txt`, 07:28:59), but `pw.sh` never reached its `exit $CODE`, so
  that 0 is the status Git Bash reported for a `pw.sh` shell stopped from outside - not Playwright's own code (how Git Bash reports a
  shell stopped that way was not measured: UNKNOWN). INFERRED cause: `pw.sh`'s last step stops every process whose command line matches
  `playwright`, which includes `pw.sh`'s own shell when its arguments name `playwright.orchestration.config.ts` (the existing-suite run
  names no config and printed its line) - named for the lead. So the result is Playwright's own summary line ("4 passed (2.5m)"), and
  the wall time is measured from the run's start stamp (07:26:27) to the Playwright log's last write (07:28:58): **151 s of wall time**.
- **OD-30's budget**: 256 + 151 = 407 s, about 6.8 minutes of the page-browser-e2e job's 30 minutes (locally; CI ran both configs in
  that job in 19 min 56 s on `85439e7`).
- **Evidence PNGs**: the two runs rewrote 32 tracked PNGs (the existing suite 25 - 5 under `artifacts/ai-control-plane-b17/evidence`,
  20 under `artifacts/ai-control-plane-b18/evidence`; the orchestration config the 7 under `artifacts/ai-control-plane-b21/evidence`)
  and no other tracked file; all 32 restored from HEAD by blob hash (`git cat-file blob` of `HEAD:<path>`, then `git hash-object` equal
  to the blob id, 32 of 32), `git status` empty afterwards (07:29:04).
- **Provider and process calls**: no provider was called in any gate. One vitest gate started a real engineering process: gate J's
  `app/lib/pcb/__tests__/autoroute-boundary-integrity.test.ts`, which has no opt-in guard, resolves the FreeRouting runtime
  (`FREEROUTING_JAVA`, else `JAVA_HOME`, else the bundled JRE, else PATH; the file's existence checked, never its digest - D22-2 open)
  and ran the real bundled FreeRouting 2.2.4 on Java twice under the agent (**CONFIRMED** from `J.log`: `RC02_REAL_SIMPLE` in 2,859 ms
  and `RC02_REAL_CROSSING` in 2,894 ms; 2 tests passed in 5,802 ms). That breaches lead lesson (6) - agents never run java or any real
  process - and is named for the lead: the closeout (1/2)'s own gates listed this suite as not run, by rule, while the lead's B22-D and
  closeout (1/2) chains ran `app/lib/pcb` whole (section 4). No other suite in any gate started ngspice, kicad-cli, Java, docker or WSL
  (the kicad-cli oracle and the live suites skipped; every other spawn a fake, above). The browser runs are the fixture runtime's: every chat turn is the scripted fixture agent's
  (`SIRKIT_FIXTURE_AGENT=scripted`), and under the fixture runtime the LLM router answers a provider request `missing_credentials`
  whether or not a key is configured, so a `missing_credentials` line in the logs is that answer, not a measured absence of keys. Whether
  the server held a provider key is UNKNOWN (not measured; both configs pass the shell's environment to `next dev`, blanking only
  `DATABASE_URL`); no environment file was read. No browser spec reaches a simulation route (`e2e/` and `e2e-orchestration/` name none).
- **Review round re-run** (2026-10-02 08:09:03 to 08:19:51, after the review's documentation fixes; `closeout2/fix/c2fix-gates.sh`,
  output under `closeout2/fixgates/`): gates A-I in the same order with identical counts (A 631 passed and 21 skipped; B 1,107; C 415; D
  460; E 825; F 357; H 1,059; F2 22; G 375; I 479 passed and 9 skipped), and gate J re-run with
  `--exclude '**/autoroute-boundary-integrity.test.ts'`, so no Java started (129 files passed and 1 skipped; 987 tests passed and 4
  skipped) - 6,717 passed and 34 opt-in skipped, every exit 0, no "onTaskUpdate" or unhandled error; tsc 0; eslint 0 on the same 130
  files; all 20 generators exit 0 with the status, the tracked diff and every untracked file's hash unchanged: **zero drift**. No
  browser run was repeated: the fixes change documents only.

## 3. CI on every B22 commit

Read with `gh run list --branch chapter/b22-sandboxed-computation` and `gh run view <id> --json jobs` (read-only). Every first-parent
commit since `main` was pushed and ran both workflows on PR #13 (`pull_request`): `deterministic-manufacturing` (jobs prompt-to-gerber,
database-delivery, page-browser-e2e) and `benchmark-quality` (benchmark-core; benchmark-nightly skipped on pull requests).

| commit | date | subject | deterministic-manufacturing | its jobs: prompt-to-gerber / database-delivery / page-browser-e2e | benchmark-quality |
|---|---|---|---|---|---|
| `0432fb8` | 2026-10-01 | B22 discovery: sandboxed engineering computation and simulation, re-verified on the SEC-1 tree | success (`36841906592`) | 12m19s / 2m08s / 21m59s, each success | success (`36841906506`) |
| `50fe156` | 2026-10-01 | B22-A1: the security corrections SEC-1 left - the model screen, kicad-cli's environment, output caps, SPICE AI approval levels | success (`36857031349`) | 12m17s / 2m13s / 20m37s, each success | success (`36857031381`) |
| `c037627` | 2026-10-01 | B22-A2: the threat model, immutable runtime profiles, the process census and the isolation verdict | success (`36879227233`) | 12m26s / 2m17s / 18m22s, each success | success (`36879226845`) |
| `e483838` | 2026-10-01 | B22-A3: the diagnostic-only local runner - one ngspice spawner, pinned, bounded, killable, never authoritative | success (`36925548722`) | 12m43s / 2m17s / 20m05s, each success | success (`36925550635`) |
| `b4c7be7` | 2026-10-02 | B22-B: named computations, never generic execution - the closed catalog, reviewed exposure, the bounded engine host | success (`36966823307`) | 10m42s / 2m22s / 20m27s, each success | success (`36966823311`) |
| `a269e7a` | 2026-10-02 | B22-C: simulation authority - evidence, never authority; the 501 kept | success (`36978195852`) | 8m46s / 2m26s / 15m11s, each success | success (`36978195956`) |
| `c9fbbb0` | 2026-10-02 | B22-D: the adversarial matrix - every runbook :938 class, prevention offline, live on the diagnostic runner, OCI blocked | success (`36988717479`) | 13m28s / 1m55s / 20m34s, each success | success (`36988717506`) |
| `85439e7` | 2026-10-02 | B22 closeout (1/2): the sandbox and authority statements superseded, the stale titles retitled, the unused exports recorded or retired, the tripwire | success (`36999378260`) | 13m44s / 1m52s / 19m56s, each success | success (`36999378264`) |

No B22 run failed: every job of both workflows succeeded on all 8 commits (benchmark-core success, benchmark-nightly skipped,
each time). `85439e7` (the closeout (1/2), HEAD of the final run) completed green on 2026-10-02 at 11:28:40 UTC, its page-browser-e2e job
running both Playwright configs in 19 min 56 s.

SEC-1, before the branch: on `fix/spice-deck-injection` the merge commit `1ff9d81` failed `deterministic-manufacturing` (two B21 page
pins the merge with main moved) and `0d38504` fixed it - both workflows green on `0d38504` (`36832496451`, `36832496589`), then PR #12
merged normally as `d0d2ec8` (the ledger's SEC-1 entry). SEC-1's rounds `fe147c9` and `aafa2a8` ran no workflow (no run is listed for
them).

## 4. Gates as the ledger and the commit messages record them

Each increment's own gates are on its page and in its ledger entry; the lead's gates on the final tree are in its commit message (B22-A1
and B22-A2 state that their ledger entries defer to it). Quoted in substance; a figure the ledger states differently is named.

| increment | the lead's gates on the final tree (commit message) | the ledger's gate line |
|---|---|---|
| discovery `0432fb8` | documents only; every suite reading the records green (55 files, 803 tests: the SEC-1 suite, the B21 orchestration folder, the B20 and B18 record readers) | "Gates for this commit: documents only - no suite, generator or production file changed." |
| B22-A1 `50fe156` | computation/SPICE/simulate/guard 14 files 445 passed 3 skipped; every suite reading a changed file 28 files 415 passed 2 skipped (the opt-in kicad-cli oracle); import gates, census and the MCP server suites 31 files 341 passed (165 / 162 / 3 / 0); B21 orchestration and the record readers 53 files 527 passed; tsc 0; eslint 0 on every changed TypeScript file; the three route-source generators with no drift | the increment's gates (15 files 442 passed 3 skipped; 26 files 405 passed 2 skipped; 20 files 218 passed, census 165 / 162 / 3 / 0 with the process gate's spawner list unchanged; 49 files 460 passed); "Lead gates on the final tree are listed in the commit message" |
| B22-A2 `c037627` | computation/SPICE/CD-10/simulate/guard 19 files 489 passed 3 skipped; classification readers, 501 pins and confinement gates 14 files 264 passed; import gates, census and MCP server 31 files 341 passed (165 / 162 / 3 / 0); orchestration and record readers 53 files 527 passed; tsc 0; eslint 0; four generators with no drift | A 19 files 482 passed 3 skipped; B 34 files 448 passed (census 165 / 162 / 3 / 0, 501 pins, the process gate's spawners unchanged); C 49 files 460; tsc and eslint clean; four generators zero drift |
| B22-A3 `e483838` | 24 files 523 passed 8 skipped; `app/api` 26 files 1,053 passed and the identity-header gate alone 6 passed; auth 41 files 479 passed 9 skipped; MCP server and import gates 21 of 23 files in one run, two AST cases timing out under load ("onTaskUpdate"), each passing alone with exit 0; orchestration and record readers 55 files 540 passed; tsc 0; eslint 0; four generators with no drift | A 25 files 610 passed 8 skipped; B 1,053 passed, the identity gate alone 6; C 16 files 183; D 22 files 220; E 49 files 460; repeats 291 x3; tsc and eslint clean; four generators zero drift; census 165 / 162 / 3 / 0 - and the lead-gate line as the commit message gives it (the AST timeouts recorded, not dismissed) |
| B22-B `b4c7be7` | computation/SPICE/simulate/guard 25 files 535 passed (+ case 10 fixed: three loaded runs 554 passed with B11.5); engineering 99 files 1,107; agent 36 files 415 (B11.5 green); orchestration 49 files 460; `app/lib/mcp` 45 files 825; chat, api/mcp, census 165 / 162 / 3 / 0 and import gates 39 files 357; the B14.4 AST gate alone 22; registry-dependent set 27 files 375; tsc 0; eslint 0; all 20 generators with no drift | A 24 files 529; B 1,107; C 414 + the pre-existing B11.5 case 12 (fixed by the lead's close); D 460; E 825; F 288; G 375; tsc and eslint (57 files) clean; zero drift |
| B22-C `a269e7a` | 37 files 612 passed 8 skipped; engineering 99 files 1,107; agent 36 files 415; orchestration 49 files 460; `app/lib/mcp` 45 files 825; chat, api/mcp and import gates 39 files 357; `app/api` 27 files 1,059; the B14.4 AST gate 22; registry-dependent set 27 files 375; auth 41 files 479 passed 9 skipped; tsc 0; eslint 0; all 20 generators with no drift | A 589 (+8 skipped); B 1,117; C 479 (+9 skipped); D 1,107; E 415; F 460; G 825; H 51; tsc and eslint (31 files) clean; 20 generators zero drift; census 165 / 162 / 3 / 0 |
| B22-D `c9fbbb0` | 39 files 622 passed 21 skipped; `app/lib/pcb` 131 files 989 passed 4 skipped; engineering 99 files 1,107; agent 36 files 415; orchestration 49 files 460; `app/lib/mcp` 45 files 825; chat, api/mcp and import gates 39 files 357; `app/api` 27 files 1,059; the B14.4 AST gate 22; registry-dependent set 27 files 375; auth 41 files 479 passed 9 skipped; tsc 0; eslint 0; all 20 generators with no drift | A 622 (+21 skipped); J 105 (+2 skipped); B 1,107; C 415; D 460; E 825; F 314; F2 22; H 1,059; I 479 (+9 skipped); tsc and eslint (11 files) clean; 7 generators zero drift; census 165 / 162 / 3 / 0 |
| closeout (1/2) `85439e7` | 40 files 631 passed 21 skipped; `app/lib/pcb` 131 files 989 passed 4 skipped; engineering 99 files 1,107; agent 36 files 415; orchestration 49 files 460; `app/lib/mcp` 45 files 825; chat, api/mcp and import gates 39 files 357; `app/api` 27 files 1,059; the B14.4 AST gate 22; registry-dependent set 27 files 375; auth 41 files 479 passed 9 skipped; tsc 0; eslint 0; all 20 generators with no drift | A 300 (+18 skipped) - the B22 suites alone; B 296 (+3 skipped); C 1,059; D 415; E 460; F 1,107; G 479 (+9 skipped); H 920; I 141; J 22; tsc and eslint (30 files) clean; "17 generators, zero drift" (the commit message's lead chain ran all 20) |

The final run in section 2 repeats the closeout (1/2)'s lead chain on the same tree with identical numbers in every gate.
