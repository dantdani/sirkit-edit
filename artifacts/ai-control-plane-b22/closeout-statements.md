# B22 closeout (1/2) - the sandbox and authority statements superseded, the stale titles retitled, the unused exports recorded or retired, the tripwire

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **RECORDED** (written down without a claim), **UNKNOWN**.

Base: `c9fbbb0` (B22-D), branch `chapter/b22-sandboxed-computation`, 2026-10-02. This commit closes the closeout half of D22-14 (under
OD-144) and D22-16's retitles, and records or retires the B22 exports no production source calls. No behaviour change, no assertion
weakened, no route (the census stays 165 = 162 canonical + 3 factories + 0 raw), no verdict - that is commit 2/2, the lead's. The B22
README, `discovery.md` and the program's records are the lead's reserved files: their row and closure clauses for this commit are in
the closeout report's "For the lead" section, not here. Sections 1 to 4 are re-derived from the tree by
`app/lib/computation/__tests__/b22-closeout-statements.test.ts` (the tripwire, section 5): section 1 by cases 6 and 9, section 2 by
cases 5 and 9, section 3 by case 8 and section 4 by case 7; case 5 also checks section 6's record of the one page that quotes retired
titles. Sections 0, 5, 6 and 7 are this commit's account and are not re-derived.

## 0. What commit 1/2 is

- **The scope** is the verified sweep (`closeout-scope/`: `sandbox-statements.json`, `stale-titles.json`, `dead-code.json`; read-only
  sweep and adversarial verification at `a269e7a`), each item re-verified by its TEXT at `c9fbbb0` before it was edited: B22-D moved
  lines in `named-computations.md` (+4 after `:178`), `diagnostic-runner.md` (+5 after `:308`), `simulation-authority.md` and
  `request-executors.ts`, and rewrote `readStrictRaw` to read through the output validator; no confirmed item's text was gone.
- **The note**: each stale statement keeps its own words and gains `[superseded <date> by the B22 closeout (<references>): ...]` on its
  own line - at the line's end, or right after the stale words where the line goes on - and adds or removes no line. The references are
  D22-14 and OD-144 for the sandbox, confinement, isolation, network, authority and PATH statements; D22-16 and OD-139 for the counts;
  the bullet's own defect or decision (D22-4, D22-5, D22-7, D22-8, D22-9, D22-10, OD-145, OD-150, OD-157) for the B22 pages' hand-off lists. No note
  reuses the B21 closeout's tag or a B22 increment's tag, none sits on or above a line the B21 tripwire pins, and none in `app/` names
  the removed executable constant, a process module or a spawn call.
- **The retitle**: a stale title is retitled to what its body asserts, with a same-line `[B22 closeout, <date>] retitled (D22-16): ...;
  assertions unchanged` comment; every `it(` count is unchanged. One page quotes retired titles: B22-B's own list in
  `named-computations.md` section 9 keeps its quotes as written, because `b22-b-catalog` case 7 pins them (section 6).
- **Lines**: no production file and no file a page cites by line gained or lost a line (CONFIRMED: `git diff --numstat` shows equal
  insertions and deletions in every edited file but the four B22 pages below and this new page). `named-computations.md`,
  `simulation-authority.md`, `diagnostic-runner.md` and `runtime-profiles.md` each gained one closing section, after every line a page
  case reads.

## 1. Dated notes, in place

**CONFIRMED** (the edits applied by script, each anchor checked to occur once on its line first; the tripwire pins every count and
case 9 re-derives every row): 83 notes - 8 production lines in 6 files, 15 in 11 test files and 60 in 28 pages (the docs and the root
README among them). The item is the sweep's id (`S*`, `A*`, `T*`, `X-*`); `S-tests` and `F1`..`F4` are this commit's own additions,
and `F5`, `F6` the review's (section 6). The review also reworded nine notes in place (S28 `:178`, `:390`, `:398`; S29 `:73`, `:75`,
`:78`; S30; S33 `:366`, `:651`): an INFERRED reading stays open, a `kill_unconfirmed` run is no exit and its directory is removed
again only once the child's close is observed, and on win32 Node adds eight server variables to the exact map.

### 1.1 Production

| item | file:line | references | the note says |
|---|---|---|---|
| S1 | `app/api/simulate/route.ts:4` | D22-14, OD-144 | no sandbox and nothing confined - this route starts no process; ngspice runs only through the diagnostic ... |
| S2 | `app/api/simulate/route.ts:14` | D22-14, OD-144 | 'no network' was the deck screens' prevention, never a denial - no OS limit stops a local ngspice opening ... |
| S18 | `app/model-simulation/page.tsx:8` | D22-14, OD-144 | local ngspice runs only from the digest-pinned install the server settings name (OD-135), never PATH - ... |
| S19 | `app/lib/model-simulation/provider.ts:6` | D22-14, OD-144 | the diagnostic runner runs only the digest-pinned install (OD-135), never NGSPICE_BIN or PATH; this list ... |
| S19 | `app/lib/model-simulation/provider.ts:15` | D22-14, OD-144 | no caller; a local ngspice gets the ngspice-local-diagnostic profile's exact map instead (LC_ALL=C, ... |
| S20 | `app/api/spice/models/smoke-test/route.ts:89` | D22-14, OD-144 | not isolated - the smoke run is a diagnostic local process on the diagnostic runner, with no isolation ... |
| S21 | `app/lib/pcb/autoroute/runner.ts:3` | D22-14, OD-144 | /api/simulate starts no process since B22-A3; ngspice runs through the diagnostic runner, whose per-run ... |
| S21 | `app/lib/pcb/fab/kicad-cli-runner.ts:2` | D22-14, OD-144 | the NGSpice route starts no process since B22-A3; ngspice runs through the diagnostic runner, whose tree ... |

### 1.2 Test files

| item | file:line | references | the note says |
|---|---|---|---|
| T12-5 | `app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts:4` | D22-16, OD-139 | the intentional agent-exposed set - 12 when written, 36 since B22-B |
| T12-7 | `app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts:312` | D22-16, OD-139 | since B17-F the pin counts the intentional agent-exposed set itself - 36 since B22-B |
| T33-1 | `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:168` | D22-16, OD-139 | the exposure list is 36 since B22-B; the label keeps its words |
| T33-1 | `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:170` | D22-16, OD-139 | the exposure list, 36 since B22-B |
| T33-1 | `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:171` | D22-16, OD-139 | the exposure list is 36 since B22-B; the label keeps its words |
| T33-5 | `app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts:140` | D22-16, OD-139 | outside the exposure list, 36 since B22-B |
| T33-6 | `app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts:6` | D22-16, OD-139 | the exposure list, 36 since B22-B |
| T33-9 | `app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts:27` | D22-16, OD-139 | with B22-B's five named computations, left out of the base the same way |
| X-2 | `app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts:526` | D22-16, OD-139 | and by B22-B's five named computations: the three reads offered on assistant-agent only, the two requests ... |
| A-2 | `app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts:55` | D22-16, OD-139 | with B22-B's five named computations, left out the same way |
| X-7 | `app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts:144` | D22-16, OD-139 | with B22-B's five named computations too (OD-139), each excluded from MCP with the reason `computation` |
| X-7 | `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts:14` | D22-16, OD-139 | the gate's list is now three process spawners and two thread starters - the diagnostic runner, ... |
| A-1 | `app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts:397` | D22-16, OD-139 | 47 x 5 since B22-B's five named computations - the count below is derived |
| S-tests | `app/lib/spice/__tests__/worker-integration.test.ts:21` | D22-14, OD-144 | no isolation boundary - the worker's points run on the diagnostic runner, a diagnostic local process (B22-A3) |
| S-tests | `app/lib/spice/__tests__/worker-integration.test.ts:78` | D22-14, OD-144 | not isolated - the smoke run is a diagnostic local process with no isolation boundary (B22-A3) |

### 1.3 Pages

| item | file:line | references | the note says |
|---|---|---|---|
| S3 | `artifacts/ai-control-plane-b16-0-24/simulate-process-security-proof.md:5` | D22-14, OD-144 | never a sandbox or a confined process. Since B22-A3 the route starts no process, and the diagnostic runner ... |
| S4 | `artifacts/ai-control-plane-b16-0-24/simulate-process-security-proof.md:30` | D22-14, OD-144 | prevention only - no OS denies the local ngspice process the network (the profile's network limit is ... |
| S5 | `artifacts/ai-control-plane-b16-0-24/unknowns-and-owner-decisions.md:27` | D22-14, OD-144 | authoritative execution was never available: the legacy path is a diagnostic local process (OD-136), and ... |
| S6 | `artifacts/ai-control-plane-b16-0-24/README.md:8` | D22-14, OD-144 | no sandbox - /api/simulate starts no process, and the diagnostic runner it calls has no isolation boundary ... |
| S7 | `artifacts/ai-control-plane-b16-0-24/final-verdict.md:10` | D22-14, OD-144 | not confined - a diagnostic local process with no isolation boundary; production simulation authority BLOCKED |
| S8 | `artifacts/ai-control-plane-b16-0-24/human-truth-contract.md:48` | D22-14, OD-144 | no local execution was ever authoritative, and the route's runner is gone: ngspice runs through the ... |
| S9 | `artifacts/ai-control-plane-b16-0-24/simulate-input-confinement.md:10` | D22-14, OD-144 | the install the server settings pin, digest-checked before every run (B22-A3) |
| S9 | `artifacts/ai-control-plane-b16-0-24/simulate-input-confinement.md:11` | D22-14, OD-144 | the profile's -b -n deck.cir (B22-A3) |
| S9 | `artifacts/ai-control-plane-b16-0-24/simulate-input-confinement.md:13` | D22-14, OD-144 | the diagnostic runner's per-run directory, with no isolation boundary (B22-A3) |
| S9 | `artifacts/ai-control-plane-b16-0-24/simulate-input-confinement.md:14` | D22-14, OD-144 | the profile's exact map (B22-A3; Node's eight win32 additions recorded, OD-156) |
| S9 | `artifacts/ai-control-plane-b16-0-24/simulate-input-confinement.md:22` | D22-14, OD-144 | the route spawns nothing; the executable, argument vector, directory and environment are the diagnostic ... |
| S10 | `artifacts/ai-control-plane-b16-0-24/simulator-output-and-cleanup-proof.md:7` | D22-14, OD-144 | the diagnostic runner's channels, 64 KiB each (B22-A1, B22-A3) |
| S10 | `artifacts/ai-control-plane-b16-0-24/simulator-output-and-cleanup-proof.md:22` | D22-14, OD-144 | the cleanup is the diagnostic runner's finally over its per-run directory (B22-A3) |
| S10 | `artifacts/ai-control-plane-b16-0-24/simulator-output-and-cleanup-proof.md:36` | D22-14, OD-144 | a per-run directory only, the diagnostic runner's, with no isolation boundary (B22-A3) |
| S11 | `artifacts/ai-control-plane-b16-0-24-1/superseded-claims.md:21` | D22-14, OD-144 | not the simulate spawn confinement: the route no longer spawns, and the diagnostic runner's process is not ... |
| S12 | `artifacts/ai-control-plane-b16-0-23/final-verdict.md:10` | D22-14, OD-144 | not sandboxed - every ngspice process is the diagnostic runner's (B22-A3, OD-136), with no isolation ... |
| S13 | `artifacts/ai-control-plane-b16-0-23/smoke-test-truthfulness-proof.md:4` | D22-14, OD-144 | not isolated - the smoke test calls the diagnostic runner (the pinned install, the profile's argv and ... |
| S13 | `artifacts/ai-control-plane-b16-0-23/smoke-test-truthfulness-proof.md:22` | D22-14, OD-144 | the smoke test spawns nothing: one run on the diagnostic runner with the profile's -b -n deck.cir in its ... |
| S14 | `artifacts/ai-control-plane-b16-0-23/unknowns-and-owner-decisions.md:35` | D22-14, OD-144 | no ngspice child inherits the server environment - every one gets the diagnostic runner's exact map ... |
| S15 | `artifacts/ai-control-plane-b16-0-23/pre-edit-counterexamples.md:50` | D22-14, OD-144 | no longer - the diagnostic runner passes the profile's exact map (B22-A3) |
| S16 | `artifacts/ai-control-plane-b16-0-23/reports-and-bundles-proof.md:30` | D22-14, OD-144 | the bundle reads no file: the raw file is kept only as rawOutput's digest, and artifactId is opaque (B22-A3) |
| S17 | `artifacts/ai-control-plane-b16-0-20/zero-process-zero-network-proof.md:17` | D22-14, OD-144 | readiness and execute bind the provider and environment to the server's copies by id and digest (B22-C, ... |
| S22 | `README.md:63` | D22-14, OD-144 | runs are diagnostic local processes with no isolation boundary; a bundle carries the raw file's digest ... |
| S24 | `docs/STATUS.md:48` | D22-14, OD-144 | not PATH - the digest-pinned install the server settings name (OD-135) |
| S25 | `docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:22` | D22-14, OD-144 | not PATH - the diagnostic runner's digest-pinned install (B22-A3); still no validated sandbox (LB-10) |
| S25 | `docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:102` | D22-14, OD-144 | not PATH - the digest-pinned install (B22-A3); still no validated sandbox or image digest (LB-10) |
| S26 | `artifacts/ai-control-plane-b20/mcp-server-proposals.md:182` | D22-16, OD-139 | the gate's list is now the diagnostic runner, FreeRouting's and kicad-cli's runners and the engine host ... |
| T33-10 | `artifacts/ai-control-plane-b21/orchestration-contracts.md:195` | D22-16, OD-139 | 36 since B22-B |
| T33-10 | `artifacts/ai-control-plane-b21/orchestration-contracts.md:198` | D22-16, OD-139 | the exposure list, 36 since B22-B |
| S27 | `artifacts/ai-control-plane-b21/orchestration-contracts.md:199` | D22-16, OD-139 | 36 since B22-B |
| T33-10 | `artifacts/ai-control-plane-b21/orchestration-contracts.md:205` | D22-16, OD-139 | and B22-B's three named computation reads |
| S27 | `artifacts/ai-control-plane-b21/orchestration-contracts.md:206` | D22-16, OD-139 | 36 since B22-B |
| S27 | `artifacts/ai-control-plane-b21/specialist-roles.md:306` | D22-16, OD-139 | the exposure list, 36 since B22-B |
| A3 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:40` | D22-5, D22-8 | since B22-A3 one runner passes the profile's exact map, which SEC-1's suite pins, and the worker's whole ... |
| S28 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:178` | D22-8 | since B22-A3 the run directory keeps no whole stdout.log or stderr.log - nothing writes either there, and ... |
| S28 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:199` | D22-5 | closed by B22-A3 - one runner passes the profile's exact map, no HOME or USERPROFILE in it, and every run ... |
| A2 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:237` | D22-8 | B22-A3 changed ngspice only - FreeRouting's shared tmpdir() cwd and uuid files are unchanged and stay open |
| S28 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:390` | D22-4 | closed in part - the model checksum hashes the emitted text (B22-C) and every run passes -n so ngspice ... |
| S28 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:392` | D22-5 | the ngspice half closed by B22-A3 - the exact map without HOME or USERPROFILE, -n on every run, the ... |
| S28 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:394` | D22-7 | closed by B22-C - the job store attaches the result and its evidence before it publishes the terminal status |
| S28 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:398` | D22-8 | the ngspice parts closed by B22-A3 - no whole raw read, per-run directories removed in the runner's ... |
| S28 | `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:399` | OD-150 | every evidence reference is labelled caller-supplied (B22-C, D22-21); resolving references to server-held ... |
| S29 | `artifacts/ai-control-plane-b22/isolation-verdict.md:72` | D22-14, OD-144 | for ngspice the diagnostic runner enforces it (B22-A3); kicad-cli and FreeRouting unchanged |
| S29 | `artifacts/ai-control-plane-b22/isolation-verdict.md:73` | D22-14, OD-144 | for ngspice the diagnostic runner passes it (B22-A3), and on win32 Node adds eight server variables to the ... |
| S29 | `artifacts/ai-control-plane-b22/isolation-verdict.md:75` | D22-14, OD-144 | for ngspice the diagnostic runner removes each in its finally and, after a kill_unconfirmed, again once ... |
| S29 | `artifacts/ai-control-plane-b22/isolation-verdict.md:78` | D22-14, OD-144 | for ngspice the diagnostic runner's tree kill - a run is terminal once the child's close is observed or, ... |
| S30 | `artifacts/ai-control-plane-b22/threat-model.md:28` | D22-14, OD-144 | ngspice runs use per-run mkdtemp directories under sirkit-ngspice-runs, removed in the runner's finally ... |
| F6 | `artifacts/ai-control-plane-b22/threat-model.md:130` | D22-9, OD-145 | neither B22-B nor B22-D took them (`adversarial-matrix.md` section 8, finding 2); open |
| S31 | `artifacts/ai-control-plane-b22/runtime-profiles.md:10` | D22-14, OD-144 | the diagnostic runner executes it (B22-A3), and execute and readiness read the registry (B22-C) |
| S32 | `artifacts/ai-control-plane-b22/named-computations.md:178` | D22-10 | the legacy parsers no longer drop either - D22-10 closed by B22-C |
| F2 | `artifacts/ai-control-plane-b22/named-computations.md:365` | D22-16, OD-139 | each item above is retitled or noted in place by the closeout, its assertions unchanged ... |
| S33 | `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md:310` | D22-5 | since B22-A3 one diagnostic runner passes the profile's exact map, and the suite pins that map |
| S33 | `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md:366` | D22-5 | closed by B22-A3 for the map - the exact map holds neither; on win32 Node adds eight server variables to ... |
| S33 | `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md:649` | D22-5 | one diagnostic runner since B22-A3, passing the profile's exact map |
| S33 | `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md:651` | D22-4 | closed by B22-A1 for the card and token readings the screens implement - they refuse an XSPICE file ... |
| A1 | `artifacts/ai-control-plane-b22/diagnostic-runner.md:319` | OD-157 | B22-C added no run-plan seed preflight - a Studio plan whose solver profile sets seed= or rndseed still ... |
| F5 | `artifacts/ai-control-plane-b22/diagnostic-runner.md:326` | D22-9, OD-145 | neither B22-B nor B22-D took them - both runners still kill the direct child and resolve before its exit ... |
| F1 | `artifacts/ai-control-plane-b22/diagnostic-runner.md:328` | D22-14, OD-144 | done: the header and the B16.0.24 records carry the closeout's dated notes |
| F3 | `artifacts/ai-control-plane-b22/simulation-authority.md:212` | D22-14, OD-144 | done: each carries the closeout's dated note |
| F4 | `artifacts/ai-control-plane-b22/simulation-authority.md:267` | D22-14, OD-144 | done: each carries the closeout's dated note |

## 2. Retitles, assertions unchanged

**CONFIRMED** - 20 cases in 15 suites, each retitled to what its body asserts with the same-line retitle note; the retired wording
may never return (tripwire case 5), and each suite's `it(` count is the one it had on `c9fbbb0`.

| item | suite:line | retired wording | `it(` blocks |
|---|---|---|---|
| T12-1 | `app/lib/auth/__tests__/b16-0-20-simulation-confinement-gate.test.ts:102` | "tools EXACTLY 12;" | 9 |
| T12-2 | `app/lib/auth/__tests__/b16-0-21-tranche14-confinement-gate.test.ts:116` | "tools EXACTLY 12;" | 9 |
| T12-3 | `app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts:134` | "tools remain EXACTLY 12 agent-exposed;" | 10 |
| T12-4 | `app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts:151` | "exactly 12 agent-exposed tools;" | 14 |
| X-5 | `app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts:141` | "the executable/env/limits are module constants, not body-derived"; then the first retitle's "the pinned install and the profile's exact map" (the review's tests-4) | 14 |
| T12-5 | `app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts:24` | "31: agent exposure remains exactly 12" | 5 |
| T12-6 | `app/lib/pcb/proposal/__tests__/b15-2-2-exact-outline-and-shape.test.ts:254` | "exposure is exactly 12 with exactly ONE PCB propose tool (B15.3 supersession of the B15.2.2 11-tool pin)" | 14 |
| T12-7 | `app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts:315` | "the agent registry exposes exactly 12 tools and exactly ONE PCB propose tool" | 20 |
| T33-3 | `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:134` | "the coordinator's own row (33 ids) is over" | 10 |
| T33-1 | `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:161` | "naming an id outside the 33 (a real registry id and an invented one)" | 10 |
| T33-2 | `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:272` | "the 33 approve nothing; / since no id of the reviewed 33 matches a pattern today" | 10 |
| T33-4 | `app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts:63` | "subset of the 33 within the A4L bound / (identity, 33 ids)" | 5 |
| T33-8 | `app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts:73` | "(a subset of the 33)" | 15 |
| T33-7 | `app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts:241` | "an id outside the 33 or a malformed id / every one of the 33 exposed ids is accepted / an execution, a view-session ..." | 15 |
| T33-9 | `app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts:134` | "5. the agent set is still B3's 32 without A4's one addition (33 with it) and assistant-agent discovery under the B04 ..." | 8 |
| X-1 | `app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts:194` | "the 24 agent tools it leaves out are the granted executions, the external reads, the open-editor tools and the seven ..." | 22 |
| X-2 | `app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts:504` | "and A4's one descriptor is the only difference" | 22 |
| X-3 | `app/lib/computation/__tests__/b22-a2-runtime-profile.test.ts:551` | "the ngspice allowlist of all three spawners, kicad-cli's allowlist" | 18 |
| X-4 | `app/lib/computation/__tests__/b22-a2-process-census.test.ts:305` | "are exactly the ones the census labels, each naming child_process" | 7 |
| A-3 | `app/lib/agent/__tests__/b09-1-boundary.test.ts:254` | "all eleven exposed schemas pass the wire subset" | 18 |

The review (tests-4) retitled X-5 a second time, assertions unchanged: its first retitle named the runner's pinned install and exact
map, which the case never reads (it reads only `app/api/simulate/route.ts`); it now names the route's own checks, and the first
retitle's wording is retired beside the original (case 5).

## 3. Exports with no production caller: recorded or retired

**CONFIRMED** on `c9fbbb0` by `git grep` and by tripwire case 8, which re-derives every row from the tree: a recorded export is still
exported, no other production source names it (comments stripped), a vocabulary has a type read from it, a test names each seam and
oracle, and a dormant module has no production importer but its dormant sibling; a retired one is gone, its tombstone in place. The
sweep counted 241 `export` lines B22 added to production files; every one not listed here is used at run time inside its own module
(the verified sweep, `dead-code.json`). Each recorded export is also written up, with why it exists, in the closing section of the B22
page the row names. The deliveries OD-141, D22-19 and OD-159 describe as delivered and unbound - the evidence store, the deck validator,
the request store and its executors - are recorded, never retired (case 8 pins that too). The line in each reason is the export's.

| module | export | member | kind | decision | page | why |
|---|---|---|---|---|---|---|
| `app/lib/computation/deck-validator.ts` | `validateLoweredDeck` | - | extension point | RECORD | `simulation-authority.md` | `:94` - the independent CD-10 deck check the authoritative path will need, delivered unbound (D22-19 in part); `b22-c-deck-validator` case 8 pins that nothing calls it |
| `app/lib/computation/deck-validator.ts` | `pinnedContentSha256` | - | extension point | RECORD | `simulation-authority.md` | `:77` - the model-pin half of the same check, unbound with it |
| `app/lib/computation/deck-validator.ts` | `DECK_VALIDATION_CODES` | - | vocabulary | RECORD | `simulation-authority.md` | `:33` - the validator's closed codes as data beside `DeckValidationCode` |
| `app/lib/computation/evidence-store.ts` | `createComputationEvidenceStore` | - | extension point | RECORD | `simulation-authority.md` | `:232` - the durable aggregate's store, delivered unbound (OD-141's stated deviation: no route binds a repository); the job store's optional `evidenceStore` takes it when bound |
| `app/lib/computation/evidence-store.ts` | `evidenceAggregateKey` | - | extension point | RECORD | `simulation-authority.md` | `:206` - the store's aggregate key, reached only through the unbound store |
| `app/lib/computation/evidence-store.ts` | `evidenceScopeKey` | - | extension point | RECORD | `simulation-authority.md` | `:209` - the store's scope key, reached only through the unbound store |
| `app/lib/computation/evidence-store.ts` | `ComputationEvidenceIntegrityError` | - | extension point | RECORD | `simulation-authority.md` | `:198` - the store's refusal of a record whose digests disagree on load, reached only through the unbound store |
| `app/lib/computation/evidence-store.ts` | `COMPUTATION_EVIDENCE_RECORD_SCHEMA` | - | extension point | RECORD | `simulation-authority.md` | `:37` - the stored record's schema id, reached only through the unbound store |
| `app/lib/computation/evidence-store.ts` | `EVIDENCE_SCOPE_SUFFIX` | - | extension point | RECORD | `simulation-authority.md` | `:40` - the store's scope suffix, reached only through the unbound store |
| `app/lib/computation/output-validator.ts` | `waveformArtifactOf` | - | extension point | RECORD | `simulation-authority.md` | `:266` - builds the CD-10 waveform artifact on demand; the parse path builds none (OD-143) |
| `app/lib/computation/output-validator.ts` | `SIMULATION_OUTPUT_VALIDATOR` | - | documentary constant | RECORD | `simulation-authority.md` | `:38` - the validator's id as data; `runtime-profile.ts` restates the literal and `b22-c-output-validator` pins both to one id |
| `app/lib/computation/output-validator.ts` | `SIMULATION_OUTPUT_REFUSALS` | - | vocabulary | RECORD | `simulation-authority.md` | `:35` - the closed refusal codes as data beside `SimulationOutputRefusal` |
| `app/lib/computation/requests.ts` | `*` | - | dormant contract | RECORD | `named-computations.md` | every export (`ComputationRequestStore` at `:150` among them) - the inert sealed request, its store and its evidence shape; imported only by `request-executors.ts`, itself unimported; bound only through a reviewed census move with an approval route (OD-159) |
| `app/lib/computation/requests.ts` | `COMPUTATION_EVIDENCE_SCHEMA` | - | dormant contract | RECORD | `named-computations.md` | `:19` - the evidence store's name and value for a different shape: the dormant shape needs its own id before anything persists it (OD-159); renaming it moves `b22-b-approval`'s pin, so it stays here |
| `app/lib/computation/request-executors.ts` | `*` | - | dormant contract | RECORD | `named-computations.md` | every export (`createComputationRequestExecutors` at `:142`, `buildCircuitAnalysisDeck` at `:33`) - the executors an approved request would run; no production importer (OD-159) |
| `app/lib/computation/request-executors.ts` | `readStrictRaw` | - | dormant contract | RECORD | `named-computations.md` | `:64` - stays exported: `b22-d-adversarial` case 8 runs it in the one parser corpus (B22-D item 16); since B22-D it reads through the output validator |
| `app/api/chat/computation-runtime.ts` | `setComputationPortFactory` | - | test seam | RECORD | `named-computations.md` | `:28` - `b22-b-chat-runtime`'s port double; the chat route binds its own port |
| `app/api/chat/computation-runtime.ts` | `resetComputationPortFactory` | - | test seam | RECORD | `named-computations.md` | `:33` - the deterministic reset of that seam |
| `app/lib/engineering/tool-registry.ts` | `TOOL_AUTHORITY_SOURCES` | - | vocabulary | RECORD | `named-computations.md` | `:98` - the authority sources as data beside `ToolAuthoritySource`; B22-B added `computation-engine` |
| `app/lib/agent/gateway.ts` | `computationService` | - | injection seam | RECORD | `named-computations.md` | `:489` - an `AgentGatewayOptions` injection point like `readService`, `proposalService` and `layoutProposalService`, which no caller sets either |
| `app/lib/computation/diagnostic-runner.ts` | `__setDiagnosticRunnerHostForTests` | - | test seam | RECORD | `diagnostic-runner.md` | `:744` - the runner suites' scripted host; production never replaces it |
| `app/lib/computation/diagnostic-runner.ts` | `__resetDiagnosticRunnerCachesForTests` | - | test seam | RECORD | `diagnostic-runner.md` | `:749` - the reset of the cached digest, the check in flight and the version lines between cases |
| `app/lib/computation/diagnostic-runner.ts` | `diagnosticRunnerState` | - | test oracle | RECORD | `diagnostic-runner.md` | `:739` - the load and digest counts the runner suites assert; no diagnostics surface reads it |
| `app/api/simulate/route.ts` | `readBoundedRawFile` | - | re-export seam | RECORD | `diagnostic-runner.md` | `:152` - re-exported for the B16.0.24.1 suite that pins it; the production read is the runner's |
| `scripts/print-install-tree-digest.ts` | `*` | - | operator tool | RECORD | `diagnostic-runner.md` | how the owner pins the install (OD-135); the runner's refusal text points to it; no package script names it |
| `app/lib/computation/runtime-profile.ts` | `isDeepFrozen` | - | test oracle | RECORD | `runtime-profiles.md` | `:585` - `b22-a2-runtime-profile`'s deep-freeze check; production freezes with the private `deepFreeze` |
| `app/lib/computation/catalog.ts` | `ArtifactParser` | - | type name | RETIRE | `named-computations.md` | `:41` - referenced nowhere, not even by a test; one tombstone comment holds its line |
| `app/lib/spice/waveforms.ts` | `parseNgspiceAsciiRaw` | `options` | parameter | RETIRE | `simulation-authority.md` | `:27` - no caller passed it (the worker and every test pass the raw text alone); a same-line tombstone; `:28` keeps its validator call |
| `app/lib/spice/waveforms.ts` | `parseNgspiceAsciiRawResult` | `options` | parameter | RETIRE | `simulation-authority.md` | `:70` - the same parameter of the worker's form; a same-line tombstone; the type import only it needed went with it (`:3`) |
| `app/lib/computation/simulation-authority-server.ts` | `serverSimulationEnvironments` | `read` | parameter | RETIRE | `simulation-authority.md` | `:11` - neither the execute nor the readiness route nor any test passed it; a same-line tombstone (and the type import at `:8`) |

Also **RECORDED**, outside the table: the mock key `b16-0-2-spice-scope-isolation.test.ts:20` sets for the worker's executable export
that B22-A3 removed - dead, kept so the range the discovery cites (`:72-233`) does not move, and noted in place on its line (the
sibling in `b16-0-23-tranche-parity.test.ts:27` already was).

Not done here, each the map's optional step and the lead's call: giving the dormant request evidence its own schema id (a pin move of
`b22-b-approval`); binding `runtime-profile.ts`'s restated validator literal to `SIMULATION_OUTPUT_VALIDATOR.id` (an in-line edit with
no behaviour change); adding `computation` and `computationService` to `b21-d3-pin-facts`' closed list (a reviewed pin move of a B21
suite; its `Object.keys` equality already guards both).

## 4. The B16.0.23 and B16.0.24 simulator stop-condition lines

**RECORDED** - the B21 precedent: the stop lines stay as written, with one dated note here instead of a note in place (the B21 tripwire
reads the lines directly above them by number, so nothing may be added above them or written on them):

> [B22 closeout, 2026-10-02] The B16.0.23, B16.0.24 and B16.0.24.1 stop-condition lines that list simulator-runner or
> simulator-platform expansion as not started are true for their own chapters and stay as written. Since B22 (`0432fb8`..`c9fbbb0`)
> the legacy ngspice paths run on the diagnostic runner (diagnostic only, with no isolation boundary), runtime profiles pin each
> executable, and an unqualified OCI design is recorded; production simulation authority stays BLOCKED (OD-134, LB-10).

The seven lines, each re-read at `c9fbbb0` with the edits (tripwire case 7 re-reads every one):

- `artifacts/ai-control-plane-b16-0-23/README.md:17`
- `artifacts/ai-control-plane-b16-0-23/final-verdict.md:37`
- `artifacts/ai-control-plane-b16-0-23/unknowns-and-owner-decisions.md:52`
- `artifacts/ai-control-plane-b16-0-24/README.md:14`
- `artifacts/ai-control-plane-b16-0-24/final-verdict.md:39`
- `artifacts/ai-control-plane-b16-0-24/unknowns-and-owner-decisions.md:47`
- `artifacts/ai-control-plane-b16-0-24-1/final-verdict.md:29`

## 5. The tripwire

**CONFIRMED** - `b22-closeout-statements.test.ts`, nine cases (case 9 the review's), riding the `app/lib/computation/__tests__`
directory filter (no CI change); it reads files only (B11.5 case 12) and starts no process:

1. no production source or test file states a superseded claim uncorrected - the ngspice runner as a sandbox, confined, isolated or
   networkless; local execution as authoritative; the executable chosen from PATH; the simulate route as the process pattern; the agent
   set, the registry or the spawners counted as before B22; one addition as the only difference - unless the closeout's note is on the
   line (or, for the one wrapped statement, on the next), or it is one of four statements true as written (the allow-list);
2. no page (the artifacts but the lead's records, the docs, the root README) states any of those claims - since the review also the
   counts, the spawners and 'no network' in one sentence with ngspice, the diagnostic runner or the simulator - without the note in
   the statement's own block, unless it is one of the 18 dated records the page allow-list names by text (the finder's gate records,
   B21's dated rows and citation rows, lines B22-A3 and B22-B corrected in place, B22-B's list of stale titles, and two true
   statements about the compiler and SEC-1's probe decks) or a B15/B16 chapter's own dated "exactly 12"; what each admits is pinned
   (20 and 38);
3. both allow-lists are exact and cannot rot, and the scans bite: with every note stripped they report exactly the 22 code statements
   and the 21 page statements the closeout noted; an ordinary count of 12 ("exactly 12 pads") is not reported while every retired
   "12" title wording is; an unnoted count, spawner or 'no network' statement added to a page or a route comment is reported; an
   allowed line moved to another file, and a page note moved away from its statement, are reported;
4. all eight production notes keep what they must say (the route starts no process; no isolation boundary; no OS limit; the
   digest-pinned install; authority stays BLOCKED), no other production line carries one, and no note spells what a raw-source gate
   forbids;
5. the 24 retired wordings never return in a title of their 15 suites, 20 cases carry the retitle note, every `it(` count is
   unchanged, and the only page lines quoting a retired title are B22-B's three in `named-computations.md` section 9, which section 6
   records;
6. the 60 page statements carry the note in their own block, nine of those notes keep what their statement needs (an INFERRED reading
   stays open, `kill_unconfirmed`, Node's eight win32 variables), no closeout note anywhere calls a run terminal or cleaned up "on
   every path" without `kill_unconfirmed` or drops HOME or USERPROFILE without the eight, and every test file and page keeps its pinned
   number of notes (75);
7. section 4's dated note covers its seven stop lines, each still as written;
8. section 3's record, re-derived from the tree: each retired parameter's tombstone on its own signature line, every retirement check
   shown to bite (a dropped tombstone, a parameter taken again, a type declared again), and the dead mock key's annotation;
9. sections 1 and 2 re-derived row for row: each row's file:line carries the note with the row's references and words (or the retitle
   note, in a suite of the row's `it(` count), every note and retitle in the tree has its row, and every closeout tag in `app/` is
   one of the 20 retitles, the 4 tombstones or the mock key's annotation.

**Failing first** (`close1-red-pre-edit`): at `c9fbbb0` with only this suite added, 8 of 8 failed - case 1 reported 42 code lines
(the 22 statements noted here and the 20 titles retitled here), case 2 the 13 page statements, case 3 the wrapped statement's missing
note, case 4 the first production statement without its note, case 5 the first retired title (`tools EXACTLY 12;`), case 6 all 58 page
statements, cases 7 and 8 the missing page (ENOENT). After the notes, the retitles, the records and this page: 8 of 8 passed
(`close1-green`).

**The review's reproduction** (`close1fix-red-1`): the strengthened suite on the tree as first delivered failed 5 of 9 - case 3
reported the three ordinary "exactly 12" lines and missed the stale page line, both its claims, and 'no network' beside ngspice on a
page and in a route comment (regressions-1, tests-2); case 5 found the X-5 title still saying "the pinned install and the profile's
exact map" and section 0 still denying that any page quotes a retired title (tests-4, coverage-2); case 6 reported 27 problems - T7 and the
`diagnostic-runner.md` hand-off without a note, and every note that dropped the open XSPICE reading, the osdi load, `kill_unconfirmed`
or Node's eight win32 variables (coverage-4, security-1..3, coverage-3); case 8 missed a dropped `parseNgspiceAsciiRawResult` tombstone
(coverage-5, tests-3); case 9 found the head claiming every section is pinned and 58 rows in section 1.3 (coverage-1). The checks
that passed there (the provider note's caveat, the mock key's annotation, a parameter or type re-declared) were shown to bite by a
deliberate breakage of each source, restored by hash (section 7).

## 6. Skipped, rejected, and left as written

- **Rejected by the verification, not edited**: S23 (`docs/spice-studio.md` calls the output an evidence report and names no title;
  nothing in it became untrue); S35 (the SPICE runs' "in-process durable" labels predate B22 and B22-C recorded their relabel as open,
  `simulation-authority.md` section 11 - it is D22-12's, for commit 2/2's unknowns, not a superseded statement); X-6 (`b16-0-24`'s
  "isolated, env-allowlisted" title: the per-run directory sense, and the profile's map is an allowlist in its own vocabulary); DC-4 and
  DC-17 as written (replaced by DC-4R and DC-17R: recorded, not retired).
- **Narrowed by the verification**: S20 drops `app/lib/spice/diagnostics.ts:69` ("isolated" there means testing the model on its own);
  S27 drops `orchestration-contracts.md:204` ("every one in the 33" stays literally true: the five verifiers are in both lists); S19
  notes the PATH sentence only ("No OS sandbox ..." stays true); S8 keeps "it was not blocked" (OD-136 retired no entry point).
- **Left as written, quoting retired titles**: B22-B's own list of the stale titles it left to the closeout,
  `named-computations.md` section 9 (`:359`, `:361`, `:362`), quotes three titles as they read before this commit; `b22-b-catalog` case 7 pins two of those
  quotes, so the lines stay as written, and F2's note (`:365`) records that each item is retitled or noted in place (the review's
  coverage-2; tripwire case 5 pins that these are the only such page lines).
- **Optional, left as written**: S17's second page (`execution-authorization-proof.md:3-7`: "UNCHANGED" is that tranche's own claim);
  the visible UI strings S18 and S20 name (rewording a visible string is the lead's call; each line carries a code-comment note).
- **Added by this commit** (each in section 1): `worker-integration.test.ts:21` and `:78` (the tripwire's "isolated ngspice" and
  "isolated smoke test" vocabulary found them; both titles of an opt-in live suite, noted, not retitled); the B22 pages' own hand-offs
  to the closeout (`diagnostic-runner.md:328`, `named-computations.md:365`, `simulation-authority.md:212`, `:267`; F1..F4), each now
  done; S28's `:178` note also states that the run directory keeps no whole `stdout.log`/`stderr.log` since B22-A3 (`:173-174`,
  the same bullet); A-3 (`b09-1-boundary`'s "all eleven exposed schemas", stale before B22, retitled on the B20 precedent).
- **Added by the review**: F5 and F6 - FreeRouting's and kicad-cli's direct-child kills, handed to "B22-B/D" by
  `diagnostic-runner.md:325-326` and threat-model T7, were taken by neither (`adversarial-matrix.md` section 8, finding 2): each now
  carries the closeout's dated note saying so, open (D22-9, OD-145).
- **Left as written as dated records** (the sweep's list): B16.0.24 `changed-files.md:12`, `superseded-claims.md:33-36`,
  `pre-edit-counterexamples.md:38-48`, `behavioral-parity-matrix.csv:6`, `route-migration-manifest.csv:6`; B16.0.23
  `route-migration-manifest.csv:12`; the gate records that say "still exactly the five spawners" (`deck-and-secret-corrections.md:372`,
  `:588`, `runtime-profiles.md:349`, the SEC-1 page's `:407`); `diagnostic-runner.md`'s "revision 2" lines; the B21 "Citations, as of
  base" rows and OD-120 headings; B20 `final-verdict.md:31`; the B15/B16 chapters' "exactly 12" verdicts (`human-truth-gates.md`,
  `final-verdict.md`, `test-and-validation-report.md`); `b20-b4-process-gate.test.ts:19` (B4-era history, the tripwire's allow-list);
  `progress/` logs; and the lead's reserved records.
- **Found, for the lead (not edited)**: OD-157's last clause (a reserved record) still promises that an early 422 at `POST
  /api/spice/runs` is B22-C's preflight; B22-C added none, and `simulation-authority.md` neither records one nor lists it open (A1,
  noted in place on `diagnostic-runner.md:319`): the job store refuses no `seed=` or `rndseed` option, so a Studio plan that sets one
  still fails each point at the runner. `output-bounds.ts:11`,
  `b22-a1-tool-output-bounds.test.ts:6` and `deck-and-secret-corrections.md:204` still cite `/api/simulate`'s `readBoundedRawFile` at
  `route.ts:222-254`; since B22-A3 the reader is the runner's (outside this commit's lists). FreeRouting's and kicad-cli's
  direct-child kills stay open (now noted in place, F5 and F6). The XSPICE card and token readings stay INFERRED with no live case
  in either live suite (the D22-4 notes say so since the review).

## 7. Gates

**CONFIRMED** (2026-10-02, each run under the global lock with its exit code captured, on the tree with every edit above; logs
`close1-*` in the session's `b22/logs`):

- The tripwire alone: red 8 of 8 on `c9fbbb0` (`close1-red-pre-edit`, section 5), green 8 of 8 after the edits (`close1-green-1`) and
  again after the lint fix below (`close1-green-2`).
- A - `app/lib/computation/__tests__` (every B22 suite, the tripwire included): 26 files passed and 2 skipped (the two opt-in live
  suites), 299 tests passed and 18 skipped; exit 0.
- B - `app/lib/spice/__tests__` and `app/api/simulate/__tests__`: 7 files passed and 1 skipped (the live worker suite), 296 passed and 3
  skipped; exit 0.
- C - `app/api/__tests__` (the B16.0.23/B16.0.24 parity suites, the B16.1c route census): 27 files, 1,059 passed; exit 0.
- D - `app/lib/agent/__tests__` (B11.5 among them): 36 files, 415 passed; exit 0.
- E - `app/lib/agent/orchestration/__tests__` (`b21-closeout-statements`, the B21 page suites): 49 files, 460 passed; exit 0.
- F - `app/lib/engineering/__tests__` (the B17-A control inventory, the B20 exposure suites): 99 files, 1,107 passed; exit 0.
- G - `app/lib/auth/__tests__` (the B16 confinement gates whose titles moved): 41 files, 479 passed and 9 skipped; exit 0.
- H - `app/lib/mcp` and `app/api/mcp/__tests__` (the B20 process gate and withheld-proposals page cases, the D2 sweep): 52 files, 920
  passed; exit 0.
- I - `app/lib/pcb/proposal/__tests__`, `app/lib/model-simulation/__tests__`, `runner-security.test.ts` and the CI job-scope guard:
  10 files, 141 passed; exit 0.
- J - the B14.4 AST import gates, run alone: 1 file, 22 passed; exit 0.
- `tsc --noEmit -p tsconfig.json`: exit 0. `eslint` on the 30 changed or new TypeScript files: the first run found one error in the new
  suite (`@next/next/no-assign-module-variable`, a loop variable named `module` in case 8), renamed in place; the second run exit 0.
- Generators, each under the lock with the tree's status, tracked diff and every untracked file's hash compared before and after:
  `generate-b17-control-inventory`, `generate-b16-0-artifacts`, `-b16-0-1-`, `-b16-0-2-`, `-b16-0-4-` (165 + 165 rows), `-b16-0-7-`,
  `generate-b16-0-8-baseline` (3 -> 3), `generate-tool-registry-artifacts`, `generate-action-toolability-matrix`,
  `generate-read-invocation-artifacts`, `generate-agent-artifacts`, `generate-b10-artifacts`, `generate-b11-artifacts`,
  `generate-b21-artifacts`, `generate-b20-mcp-parity`, `generate-b20-mcp-tool-manifest`, `generate-b20-mcp-server-registry` - all 17
  exit 0 with zero drift. No route added: the census stays 165 = 162 canonical + 3 factories + 0 raw.
- Files are LF only with no control byte; the reserved files are untouched.

**After the review's fixes** (logs `close1fix-*`; the same lock, exit codes captured; the review's 12 confirmed findings, each
reproduced first - section 5):

- The tripwire alone: red 5 of 9 on the tree as first delivered (`close1fix-red-1`), green 9 of 9 after the fixes (`close1fix-green-2`).
- Deliberate breakages, all in one run, each source restored and its SHA-256 verified (`close1fix-breakage`): the dead mock key's
  annotation removed (case 8 reported it), `parseNgspiceAsciiRawResult`'s own tombstone removed while `parseNgspiceAsciiRaw`'s stayed
  (case 8), the provider note's win32 caveat removed (cases 4 and 6), a section 1.2 row's line changed to `:999` (case 9), the stale
  count, spawner count and 'no network' beside ngspice appended to `simulation-authority.md` (case 2, three reports) and 'no network'
  beside ngspice appended to `/api/simulate`'s source (cases 1 and 3) - 7 of 9 red; and an "exactly 12 pads" comment appended to a
  test file was NOT reported (case 1 listed only the route line).
- A: 26 files passed and 2 skipped, 300 passed and 18 skipped. B: 7 files and 1 skipped, 296 passed and 3 skipped. C: 27 files, 1,059
  passed. D: 36 files, 415 passed. E: 49 files, 460 passed. F: 99 files, 1,107 passed. G: 41 files, 479 passed and 9 skipped. H: 52
  files, 920 passed. I: 10 files, 141 passed. J (the AST gates, alone): 1 file, 22 passed. Every group exit 0.
- `tsc --noEmit -p tsconfig.json`: exit 0. `eslint` on the 30 changed or new TypeScript files: exit 0.
- The same 17 generators: all exit 0 with zero drift; the census stays 165 = 162 canonical + 3 factories + 0 raw.
- Only the review's eight files changed (this page, the tripwire, `b16-0-24-tranche17-confinement-gate.test.ts`, and the B22 pages
  `sec-1-spice-deck-injection.md`, `deck-and-secret-corrections.md`, `isolation-verdict.md`, `threat-model.md`,
  `diagnostic-runner.md`), each in place: the six existing files kept their line counts (only the new tripwire and this page grew);
  LF only, no control byte.
- **Not run, by rule**: the opt-in live suites (skipped), no browser spec, no full suite, and no suite that starts a real process
  (`autoroute-boundary-integrity`, the stage 9 benchmark). No ngspice, java, docker, wsl or other real process was started.
