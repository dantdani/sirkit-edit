# B22-B - named computations, never generic execution

Labels: **CONFIRMED** (read at the cited file, or executed by a suite named here at its seams), **INFERRED** (a conclusion from
reading code or documentation; never executed), **RECORDED** (written down from a document or a record, without a claim of our
own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Branch `chapter/b22-sandboxed-computation`, base `e483838` (B22-A3), 2026-10-01. Runbook B22-B `:908-920` ("Expose operations such
as: run a pinned SPICE analysis; evaluate an approved equation/model; parse a bounded approved file; run a pinned placement/routing
experiment; compare deterministic artifacts." and "Do not expose `shell`, `exec`, arbitrary Python/JavaScript, arbitrary package
installation, unrestricted filesystem or arbitrary URLs to the product agent."); discovery D22-15, D22-16 (pin moves), D22-17
(host), D22-22 (recorded); section 9.5 items 10, 26 and 27; OD-139, OD-140, OD-149 as applied, OD-158 (stated here, section 3) and OD-159 (proposed, section 11).
Nothing here started ngspice, java, a container or any real process: the circuit analysis runs at the diagnostic runner's module
seam, and the engine host runs real worker threads over Sirkit's own closed engines and the test fixtures only. Production
simulation authority stays BLOCKED (the CD-10 501 and `executeAuthoritativeSimulation` unchanged). [B22-B review, 2026-10-02] An
adversarial review CONFIRMED 18 findings against this work; each was fixed test-first (section 8, "Third run"), the records
below carry its dated notes, and the final runs (section 10) are the fix run's.

## 1. The closed catalog (OD-139)

`app/lib/computation/catalog.ts` holds exactly the runbook's five operation kinds, in its order, deep-frozen and validated at load
(`computationCatalogViolations`; a violation throws, so a broken catalog never loads). Every id lives under `sirkit.computation.*` and
spells none of `spice`, `simulate`, `exec`, `process`, `shell`, `file.`, `order`, `ship`, `qualif`. CONFIRMED by `b22-b-catalog`.

| kind | runbook | class | backing | runs in | profile | output validator | budget | agent |
|---|---|---|---|---|---|---|---|---|
| `sirkit.computation.circuit-analysis` | :912 | propose | process-backed | diagnostic-runner | `ngspice-local-diagnostic` | `sirkit.computation-validator.circuit-waveform/1` | 10000 ms | dormant |
| `sirkit.computation.analytical-equation` | :913 | read | in-process | engine-host | - | `sirkit.computation-validator.analytical-quantities/1` | 5000 ms | exposed |
| `sirkit.computation.artifact-parse` | :914 | read | in-process | engine-host | - | `sirkit.computation-validator.artifact-statistics/1` | 10000 ms | exposed |
| `sirkit.computation.layout-experiment` | :915 | propose | process-backed | engine-host | `engine-host:placement-experiment/1` | `sirkit.computation-validator.layout-experiment/1` | 60000 ms | dormant |
| `sirkit.computation.artifact-compare` | :916 | read | in-process | engine-host | - | `sirkit.computation-validator.artifact-comparison/1` | 5000 ms | exposed |

- **Evaluate an approved equation/model**: the analytical reference provider's three microcases (its `supportedFeaturesAndLimits`:
  resistor divider, first-order RC, single pole) - `resistor-divider` (vin, r1, r2), `rc-step` (vin, r, c, time),
  `one-pole-lowpass` (r, c, frequency) - evaluated closed-form by the engine host. The provider is reported `unreviewed` and never
  authoritative: a tool call carries no human reviewer (`provider.ts`'s rule), and no result is a simulation.
- **Compare deterministic artifacts**: two results the server holds for THIS run, named by their SHA-256 `resultDigest`; per shared
  quantity both values and the absolute and relative difference; `comparable` (same microcase) and `identical` (same digest).
- **Parse a bounded approved file**: one artifact the server holds for this run, named by its digest - the run's verified canonical
  board, by the canonical revision digest a read already reported (at most 8 MiB of canonical JSON), or a held result. Two closed
  parsers: `board-statistics` (layers, footprints, nets, tracks, vias, zones, texts, track length per layer) and `result-fields`.
  RECORDED: no other server-held file exists for a chat run in B22-B; a SPICE raw file or a Gerber parse joins only through the
  evidence aggregate (OD-141, B22-C).
- **Run a pinned SPICE analysis**: the same three microcase circuits, written by the server from bounded numbers (formatted by the
  server, `toExponential(9)`; no caller text), seeded with the profile's seed, screened by SEC-1's final screen, run once on the
  B22-A3 diagnostic runner after a human approves the exact request (section 5).
- **Run a pinned placement/routing experiment**: the experiment profile `engine-host:placement-experiment/1` in the bounded engine
  host (a seed and at most 60 s). Routing stays FreeRouting's (a process; LB-3/LB-8); placement is the experiment. Its engine has no
  worker entry in this build (section 4), so an approved request is refused `ENGINE_UNAVAILABLE`, never run on the request's thread.

Every result is evidence, never engineering authority: the in-process results carry the labels `computation_evidence` and
`not_authoritative` and the sentence "computation evidence - never engineering authority"; the process-backed evidence carries
`diagnostic_only` and `environment_dependent` and "diagnostic evidence - never engineering authority".

## 2. Closed inputs (OD-149: no model-generated scripts)

Checked STRUCTURALLY over every schema (`closedInputViolations`, `b22-b-catalog` case 2, a counterexample for every rule): every object
closed (`additionalProperties: false`) with only the closed keywords; every string a closed enum or a declared artifact-digest field;
every number bounded on the server (`numberFields`: unit, minimum, maximum, integrality); no array and no nested object; no field
named like argv, a path, a directory, a file, a URL, a link, a host, a deck, a netlist, a script, code, a command, an expression, a
formula, a source, a program, eval, a shell, exec, a module, an import, require, spawn, a process or the environment. The wire
schema carries only the provider wire subset (no bound keyword travels: `toStrictSchema` accepts each), so the server holds every
bound (`validateComputationInput`): exact own keys, a plain object only, closed enums, the digest grammar
`^(?:eng1-[0-9a-f]{16}|dw1-[0-9a-f]{64})$`, finite numbers within bounds, a microcase's own parameters only (a strict provider's
`null` is absence). No kind, schema or validator accepts code or a script, and none could (no free string exists).

Each output passes the kind's typed validator (closed keys, closed quantity names and units, finite values, counts, at most 16 list
entries, the two labels, the fixed authority sentence, SHA-256 digests, the kind's output byte budget); a result that fails is
refused whole, never trimmed. The validators are TypeScript, independent of the engines (plain JavaScript in the worker).

## 3. Exposure: the reviewed moves (D22-15, D22-16)

- **New binding status `bound-computation`** and authority **`computation-engine`** (`tool-registry.ts`), modelled on
  `bound-external-read`: a bound computation is a Tier 0 read, no approval tier, no side effect beyond the run's derived cache,
  exactly the `computation-engine` authority - which is its alone. The three reads resolve only through the allowlist in
  `app/lib/agent/computation-reads.ts` (`ComputationReadService`), which the gateway reaches BEFORE the B05 read service; the port is
  `app/lib/computation/computation-port.ts`, injected by the chat route through its one approved boundary
  `app/api/chat/computation-runtime.ts`. The server's computation fact and the authority agree in both directions
  (`verifyAgentContextIntegrity`); the authority counts on the assistant-agent channel only (`tool-discovery.ts`).
- **OD-158 (stated choice, default applied): the port is bound to a chat run only when the server sets
  `SIRKIT_NAMED_COMPUTATIONS=1`.** Default off: production chat is unchanged until the owner qualifies it, because the engine host
  resolves its worker entry beside itself (`new URL("./engine-worker.mjs", import.meta.url)`) and how `next build` bundles that file
  is **UNKNOWN** (no build was run in B22-B). Off, the fact is false and the three reads are withheld from every run.
  [B22-B review, 2026-10-02] regressions-1, coverage-3: opting in binds the port only where the host can run - the server process
  carries no V8 heap-size flag (`computationEngineServable`, section 4); otherwise the resolver returns null, so the fact is false and
  the reads are withheld instead of offered and refused on every call. CONFIRMED from the installed Next 16.2.6
  (`node_modules/next/dist/cli/next-dev.js:224-231`, `:267`): `next dev` - the repository's `dev` script and Playwright's web server -
  writes `--max-old-space-size` (half the machine's memory) into its server's NODE_OPTIONS unless that variable already sets one or
  `NEXT_DISABLE_MEM_OVERRIDE` is set, so under `next dev` the named computations need `NEXT_DISABLE_MEM_OVERRIDE=1` as well;
  `next start` adds no such flag (INFERRED from `next-start.js`, which sets no NODE_OPTIONS). A refusal of the host itself
  (`ENGINE_HEAP_LIMIT_OVERRIDDEN`, `ENGINE_UNAVAILABLE`) reaches the model as the closed status `engine_unavailable`, never as an
  implementation failure. `b22-b-exposure` case 6 and `b22-b-chat-runtime` (through `POST /api/chat`) pin both.
- **The two process-backed kinds are registered, never exposed, never callable** (`binding: unbound`, notes naming the human
  approval they wait for). Approving a request needs an authenticated route; B22-B adds none (the census stays 165 = 162 + 3 + 0),
  so - the task's stop condition - their exposure waits for a reviewed census move (For the lead).
- **MCP**: a new structural reason `computation`, right after `never_exposed`, withholds every `sirkit.computation.*` descriptor and
  every `bound-computation` binding, exposed or not ("an MCP call may start neither", b20-b4-process-gate). The reviewed MCP lists
  (`mcp-exposure-review.ts`) are unchanged.
- **B21 specialists**: no role row holds a computation id (the coordinator's row IS the exposure list); `deriveSpecialistContext`
  and `withdrawAuthority` drop the `computation-engine` authority and the fact, so no specialist and no follow-up coordinator turn
  discovers one; the coordinator row's note now states no count. [B22-B review, 2026-10-02] coverage-6, tests-9: the follow-up
  turn's half is now pinned too - `b22-b-exposure` case 4 shows the read-only registry view holds the three reads and the withdrawn
  context is offered none of them (no fact, no authority, the integrity check holding).
- **The process census** (B22-A2, `b22-a2-process-census`): `/api/chat` now reaches `app/lib/computation/engine-host.ts`. The host
  and its worker entry are reviewed THREAD starters (`THREAD_STARTERS`, OD-140): they start a worker thread of the server process,
  never an external process, so the classification's `external_process` column for `/api/chat` stays `freerouting (java)` (the CSV
  is unchanged) while the census and `threat-model.md`'s table list the host as reached.

| ratchet | before | after | moved by |
|---|---|---|---|
| registry descriptors | 42 | 47 | the five kinds |
| agent-exposed | 33 | 36 | the three reads (`agent-exposure.ts`) |
| MCP-exposed | 9 | 9 | none |
| agent-only (exposed, not MCP) | 24 | 27 | the three reads |
| MCP structurally excluded | 26 | 31 | the five kinds, reason `computation` |
| B01 commands | +0 | +2 | `computation.named-read`, `computation.request` |

No gate regex and no `NEVER_EXPOSED_TOOL_PATTERNS` entry was widened: the six patterns are pinned unchanged and every exposed id
passes the b17-f, B16.0.20, B16.0.21, B16.0.23 and B16.0.24 gates as they stand (`b22-b-exposure` case 3). The never-execution sweep
(B18-C) and the never-reachable sweep (B20-D2) run over the whole registry, so they re-ran with the new descriptors; `b22-b-exposure`
case 5 re-runs both for the five ids directly.

## 4. The bounded engine host (OD-140; D22-17)

Read before writing it, **read 2026-10-01**: https://nodejs.org/api/worker_threads.html (v26.10.0) and the v24 page
(https://nodejs.org/docs/latest-v24.x/api/worker_threads.html, v24.21.0; this host runs v24.15.0). RECORDED from those pages:
- `worker.terminate()`: "Stop all JavaScript execution in the worker thread as soon as possible. Returns a Promise for the exit code
  that is fulfilled when the `'exit'` event is emitted." Whether it stops a synchronous loop is not stated; `b22-b-bounded-host`
  case 2 CONFIRMS it on this host (a loop that never yields is stopped at its 400 ms budget and its exit observed).
- `resourceLimits` (`maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`, `codeRangeSizeMb`, `stackSizeMb`): "Reaching these limits
  leads to termination of the `Worker` instance." and "These limits only affect the JS engine, and no external data, including no `ArrayBuffer`s." "Even if these limits are set, the process may still abort if it encounters a global out-of-memory situation."
  The v24 page adds, per property: `maxOldGenerationSizeMb` - "If the command-line argument `--max-old-space-size` is set, it
  overrides this setting." (and `--max-semi-space-size` for `maxYoungGenerationSizeMb`). V8 flags are process-wide, so a server
  started with such a flag (directly or through `NODE_OPTIONS`) would silently replace every engine's heap budget: the host refuses
  closed (`ENGINE_HEAP_LIMIT_OVERRIDDEN`, nothing starts) while the process carries one (`heapLimitOverrideFlags`, `b22-b-bounded-host`
  case 6; case 1 pins that the suite's own process carries none, so its real workers ran under the budget's limits). [B22-B, second
  run] Found when the Node pages were re-read on 2026-10-01 by this run (the quotes above were checked against both pages then).
  [B22-B review, 2026-10-02] security-1, tests-3: the check now covers the whole flag family. Node 24's `--max-old-space-size-percentage` sets the same V8 limit and, per `node --help` on v24.15.0, "takes precedence over --max-old-space-size"; the review measured a worker asking `maxOldGenerationSizeMb: 32` at a 44 MiB heap limit with no flag, 3,971 MiB under `--max-old-space-size-percentage=25` and 2,060 MiB under NODE_OPTIONS `"--max-old-space-size=2048"` (quoted), where the old check found nothing (RECORDED from the review; not re-run here). The check now matches `max-old-space-size`, `max-semi-space-size`, `max-heap-size` and the young-generation spelling, each with an optional `-percentage`, either separator, one or two dashes and any case. It reads NODE_OPTIONS conservatively: Node drops each double quote and in-string backslash before it splits on spaces, so every quote and backslash is removed and any whitespace splits. No flag Node would apply is missed, and a quoted value that merely contains such a flag's text is refused too (closed). Not detected: a flag set at run time through `v8.setFlagsFromString` (no Sirkit source calls it; INFERRED from a search of `app/`, `lib/`, `server/` and `scripts/`).
- `env`: "**Default:** `process.env`" - so the host passes an empty object. `execArgv`: "By default, options are inherited from the
  parent thread" - so the host passes none. `stdout`/`stderr: true`: not piped to the parent's streams.
- Inside a worker `process.exit()` "does not stop the whole program, just the single thread"; the pages state no isolation of the
  file system or network: a worker is a thread of the server process (INFERRED from both pages; nothing claims otherwise).

`app/lib/computation/engine-host.ts` is the ONE place Sirkit starts a `worker_threads` Worker; `engine-worker.mjs` is its one entry
(plain JavaScript, imports `worker_threads` and nothing else, loads no module, compiles nothing; its engine table is the host's
closed list minus the placement experiment). What each bound is held by:

| bound | held by | how |
|---|---|---|
| wall clock | host | the kind's budget (at most the engine's ceiling, at most the service's deadline): `terminate()` at the budget; an abort does the same |
| terminal state | host | an outcome is answered after the worker's `'exit'` is observed, or `confirmed: false` after 5 s (the slot stays held until the exit; [B22-B review] pinned by case 8 with a worker whose exit never comes) |
| no result after the budget | host | the first decided outcome wins; any later message is dropped |
| JS heap and stack | JS engine | `resourceLimits` from the budget (`heapMiB`; young 8 MiB, code 16 MiB, stack 4 MiB); an allocation without bound ends `resource-limit` (case 5); refused closed while the server process carries a V8 heap-size flag, which would override them (case 6) |
| output | host | plain JSON only (no Date, Map or class instance), within the kind's byte budget, else a closed failure |
| environment | host | `env: {}`, `execArgv: []` - the worker sees no server variable (case 1: zero keys) |
| concurrency | host | at most 2 engine workers per server process (`ENGINE_HOST_MAX_RUNNING`, one host per process shared by every chat request's port and the request executors); [B22-B review] security-2: at most 1 per tenant (`ENGINE_HOST_MAX_RUNNING_PER_HOLDER`; the port and the executors pass the request's server-derived tenant as the holder), so one tenant never holds both; one more is refused `ENGINE_HOST_BUSY` (no queue); cases 8 and 9 |
| external memory, CPU share, file system, network | none | a worker is a thread of the server process; `resourceLimits` do not bound ArrayBuffers |

It is not a sandbox and not an isolation boundary: it bounds the TIME and the JS heap of Sirkit's own closed engines, which only
ever receive server-validated closed inputs. **The placement experiment** has no worker entry in this build: the placement engine
is TypeScript whose module graph a worker cannot load without a build step B22-B does not add (`ENGINE_UNAVAILABLE`, recorded on the
profile). B20's F1 (the anonymous `/api/pcb/placement/preview` blocking the event loop) stays a separate queued fix: it is not the [B24-closeout, 2026-10-10] superseded: B24-A3's record, artifacts/ai-control-plane-b24/abuse-controls.md:334.
same seam (it needs that same engine entry).

## 5. The process-backed requests: inert until a human approves

`app/lib/computation/requests.ts`: `sealComputationRequest` turns a process-backed kind and its closed input into plain, frozen,
SHA-256-pinned data (kind, version, input, profile, validator, budget, server scope, the canonical revision it was sealed against,
the requester, created and expiry times) and runs nothing. `ComputationRequestStore`: `submit` (a recomputed digest, no duplicate);
`approve` - only a **human** (`actorKind: "human"`) with an approving role (`pcb_editor`, `reviewer`, `project_admin`) in the
request's own scope, over its exact digest, once, before its 15-minute expiry; `consume` - an approved request, once, with the
SERVER's executors (`request-executors.ts`), the record consumed before the executor runs. The AI cannot approve (an agent approver
is refused) and cannot consume (no agent path holds the executors; the two descriptors are unbound, never exposed or callable; the
gateway refuses them with every port bound). CONFIRMED by `b22-b-approval`.

The pinned SPICE executor writes the deck from numbers alone, seeds it (`seedDiagnosticDeck`), screens the seeded deck
(`assertCompiledDeckSafe`, exactly the compiler-style control block), runs it once on `runDiagnosticNgspice` (the tenant as the
holder, the kind's 10 s wall clock), reads the raw file with a strict reader that refuses a malformed, short or non-finite file whole
(no dropping, unlike the legacy parsers - D22-10 stays B22-C's for them) [superseded 2026-10-02 by the B22 closeout (D22-10): the legacy parsers no longer drop either - D22-10 closed by B22-C], and checks the summary with the circuit-waveform validator.
[B22-D, 2026-10-02] The strict reader is now read by B22-C's one output validator under its own bounds (64 variables, 100,000
points): its own reading disagreed with the other parsers on ten corpus files ([B22-D review] was "nine"; the red log lists ten),
ngspice's ` grid=3` attribute among them (`adversarial-matrix.md` G4; `b22-d-adversarial` case 8, which since the review also pins
those bounds at their edges).
CONFIRMED at the runner's module seam only; no ngspice ran. No production surface approves a request yet (no route). **UNKNOWN**
until a live run (the A3 opt-in suite's ground, the lead's): the vector names a real ngspice-46 writes for `write result.raw v(out)
i(V1)` (the strict reader looks for `v(out)` and `i(v1)`, lower-cased; a different spelling refuses the evidence `OUTPUT_INVALID`,
never a wrong number), and whether the transient's last point lands exactly on `time`.

## 6. Never generic execution

`b22-b-no-generic-exec` (the B14.4 AST helpers and the TypeScript parser): under `app/` the process and thread importers are exactly
the diagnostic runner (`child_process`), the engine host and its worker entry (`worker_threads`) and the two legacy runners B22-A3
left; the host constructs a Worker in one place from its closed entry table, never from source text and never with `eval`; the
worker entry loads and compiles nothing; no tool, computation, engine, validator, parser or microcase name spells a generic
operation; the MCP routes reach none of the computation runtime; no B11-scanned file names it. The process gate's `APP_SPAWNERS`
moved once, by review (OD-140; b20-b4-process-gate case 1), and its case 2 keeps the host out of the MCP closure.

## 7. The OD-82 / OD-87 precondition (D22-22): recorded, the reversal NOT performed

OD-82 parks routing over MCP until "a sandboxed routing worker exists under B22-B". OD-87 withholds placement over MCP and names
three ways the owner may choose otherwise (RECORDED from `OWNER_DECISIONS.md`, OD-87, "The owner may choose otherwise"; discovery 9.5
item 26, third bullet):
1. "a bounded engine host with kill semantics, stopped hard at the budget" (the runbook's experiment profile), which "deliberately changes `b20-b4-process-gate`";
2. "an accepted bound, after a real-board probe";
3. "serving placement only below a measured footprint cap".

[B22-B review, 2026-10-02] B22-B delivers only the first, and only as a host: the second and the third do not depend on the host and
stay open for the owner exactly as OD-87 left them. What B22-B now
provides toward them: the bounded engine host (a hard `terminate()` at the budget, the exit observed, no result after it, heap
limits, an empty environment, a per-process cap shared by tenant) and the reviewed process-gate move that admits it outside the MCP closure; the
experiment profile `engine-host:placement-experiment/1` (a seed, at most 60 s, 512 MiB). What it does NOT provide: a worker entry
for the placement engine (so the host cannot run placement yet), any routing worker (FreeRouting stays a process: LB-3/LB-8), and
any MCP serving path. The reversal itself is NOT performed: MCP stays read-only, `sirkit.placement.propose` and
`sirkit.routing.propose` stay withheld, and OD-83..86 and OD-88 stay reserved and unspent. The design those numbers wait for is now in
the repository, copied verbatim by the lead's instruction: `artifacts/ai-control-plane-b22/mcp-proposal-reversal-design.md`
(RECORDED; provenance in its header).

## 8. Test-first record

Every run under the global heavy-job lock (`run.sh`, two workers; `heavy.sh` for tsc, eslint and tsx), every exit code captured; no
live suite, no browser spec, no full suite; no real process started (the engine host's real workers run Sirkit's own engine table
and the suites' fixtures inside the test process).

**Two runs.** B22-B's first implementer was cut off by a session end during its final gate round and left the work uncommitted. A
second run adopted it: the working tree was compared with the lead's snapshot first (the tracked diff byte-identical to
`tracked.patch`, all 24 untracked files identical to `untracked.tar`, a SHA-256 manifest of the 67 changed files kept), nothing was
treated as proven, the red evidence was re-established, the unfinished work was found by the gates and finished, and every gate ran
again. The first run's records below are RECORDED from its logs; the second run's are its own.

- **Baseline** (first run, RECORDED) on the clean tree `e483838` before any edit: A (computation, spice, the CI guard) 18 files
  passed, 2 skipped, 487 passed, 8 skipped, exit 0; E (`app/lib/mcp`) 45 files, 825 passed, exit 0; F (`app/api/chat`, `app/api/mcp`,
  the census tripwires, the B14.4, B15.3 and B18-B import gates) 33 files, 288 passed, exit 0; G (the registry-dependent auth, atomic,
  acquisition, execution-grant, proposal, project, view-session and workflow suites) 21 files, 268 passed, exit 0; D (B21
  orchestration) 49 files, 460 passed, exit 0; C (`app/lib/agent/__tests__`) 1 failed / 414 passed, exit 1 - `b11-5-capture-exactness`
  case 12 on the clean tree (six writes in the A1, A2 and A3 suites; RECORDED by B22-A3, not B22-B's); B (`app/lib/engineering/__tests__`)
  99 files, 1,107 passed, exit 0.
- **Red, first run** (RECORDED): the five suites with no production module, five files failed to load, exit 1; then with the
  computation modules written and nothing registered or exposed, 15 failed / 16 passed of 31, exit 1 (three of the failures were
  test bugs, fixed before any registry edit, and one a host defect: an outcome answered before the worker's exit, so the slot was
  still held - the host now answers after the exit).
- **Red, re-established by the second run** on the HEAD sources (the fourteen touched production files written back from `e483838`,
  the nine new production modules moved out; the adopted files then restored and all 67 checked by SHA-256): (A) no new module -
  the five suites failed to load (`Cannot find module` for the catalog, the engine host, the requests and the computation reads),
  no test ran, exit 1; (B) the nine new modules present, the HEAD wiring - 8 failed / 23 passed of 31, exit 1: `b22-b-exposure` cases
  1, 2, 3, 4, 6, 7 (registry 42, no `bound-computation`, agent set 33, no `computation-engine` authority, the reads not offered, the
  equation refused), `b22-b-approval` case 4 and `b22-b-no-generic-exec` case 4 (the two process-backed descriptors not registered).
- **Green on the adopted tree**: the five suites 31 passed, exit 0. **But the gates were not green**: the first gate round of the
  second run found the first run's unfinished work (section 9): A - `b22-a2-process-census` cases 1, 3, 5, 6, 7 (the engine host an
  unlabelled spawner on `/api/chat`); B - 7 failed (`b04-tool-registry`'s activated-binding tripwire, the `b17-f` and `b18-c` addition
  lists, three `b20-b1-mcp-exposure` cases, `b20-b3` case 4); C - 17 failed (`b09-3-closure`'s runtime gate, fifteen B11 replay-pin
  cases, and the pre-existing `b11-5` case 12); D - 3 failed (`b21-c-least-privilege` case 7, `b21-e4-page` case 3 - `route.ts` had
  566 lines where the B21-E4 page pins 562 - and `b21-f-evaluation` case 15, the B21 replay pins); E, F and G green.
- **A defect the second run found and closed, test-first**: the v24 Node page says a command-line `--max-old-space-size` overrides a
  worker's `maxOldGenerationSizeMb` (section 4). The host now refuses closed while the server process carries a V8 heap-size flag.
  Its counterexample is mutation M4 below (the refusal removed: `b22-b-bounded-host` case 6 fails).
- **Deliberate breakages** (`mutate.py`: each applied alone to the final source, its suite run under the lock, the file restored and
  checked by SHA-256 - every one identical): M1 no `terminate()` at the budget (bounded-host 2, 3, 4, 6, 7); M2 the server
  environment handed to the worker (bounded-host 1, 7); M3 a later event replaces the first outcome (bounded-host 3 - it SURVIVED
  the first pass, so case 3 now drives an engine error and an abort after the answer, then caught); M4 no refusal under a heap-size
  flag (bounded-host 6); M5 a free string admitted as an input (catalog 2); M6 an agent may approve (approval 3); M7 an unapproved
  request consumed (approval 2); M8 no MCP `computation` reason (exposure 1); M9 a specialist keeps the computation authority
  (exposure 4); M10 the port's answer reaches the model unvalidated (exposure 6); M11 the toolset offers the reads without the fact
  (exposure 6 - it SURVIVED the first pass: discovery withheld the reads first, so case 6 now hands the toolset a context that
  advertises the authority without the fact, then caught); M12 the integrity check accepts the authority without the fact
  (exposure 6); M13 the worker entry compiles code (no-generic-exec 3); M14 an unseeded, unscreened deck (approval 5); M15 the design
  copy loses its final blank line (catalog 6); M16 the computation authority counts on every channel (exposure 5); M17 a result held
  across runs (exposure 7). Seventeen of seventeen caught, each exit 1.

**Third run: the adversarial review** ([B22-B review, 2026-10-02]). A review CONFIRMED 18 findings against the second run's tree
(regressions-1, security-1, security-2, coverage-2..6 and 8, tests-2, -3 and -5..11; most rated low). Each was fixed test-first by a
run that wrote none of the earlier work. The tree was hashed at the start (78 changed files), and no file it did not write changed
while it worked.
- **Baseline**: the five suites, 31 passed, exit 0.
- **Strengthened suites first, on the reviewed code**: the five suites extended, plus a sixth, `b22-b-chat-runtime` (tests-2: the
  route's wiring through `POST /api/chat`, in the existing `app/lib/computation/__tests__` filter, so no CI line). 6 failed / 36
  passed of 42, exit 1:
  - `b22-b-bounded-host` case 6: `--max-old-space-size-percentage=50` found nothing (security-1, tests-3);
  - case 8: no per-tenant share (`ENGINE_HOST_MAX_RUNNING_PER_HOLDER` undefined; security-2);
  - case 9: the port and the executors passed no holder (security-2);
  - `b22-b-exposure` case 6: `ENGINE_HEAP_LIMIT_OVERRIDDEN` answered `implementation_failed` (regressions-1);
  - `b22-b-chat-runtime` case 4: opted in under `--max-old-space-size`, the three reads were still offered (regressions-1, coverage-3);
  - `b22-b-catalog` case 7: the records (coverage-4, -5, -8; the `next dev` precondition).
- **The 36 that passed hold every strengthened assertion of the test-strength findings** (coverage-2, -6; tests-2, -5..11): the code
  was right and untested, so each is proven below by a deliberate breakage instead.
- **Fixes**:
  - the heap-flag family, with NODE_OPTIONS read the way Node reads it;
  - a per-tenant share of 1 under the cap of 2, the holder passed by the port and the executors;
  - the resolver binds no port under a heap-size flag;
  - `engine_unavailable` for the host's own refusals;
  - the records: section 7's three OD-87 paths, the threat model's T10 row, its section 5 and its census paragraph, an isolation-verdict
    note, `specialist-roles.md`'s dated 36s, and the stale titles listed in section 9.
- **Green**: 42 passed, exit 0.
- **Deliberate breakages** (`mutate3.py`): each applied alone to the final source and its suite run under the lock, then the file
  restored and checked by SHA-256 (every one identical, and the whole tree's 80-file manifest identical after the pass):
  - M18 the chat port and M19 the executors each on a host of their own (bounded-host 9);
  - M20 the cap raised to 64 (bounded-host 8, 9);
  - M21 an unconfirmed exit reported confirmed, and M22 its slot freed early (bounded-host 8);
  - M23 no per-tenant share (bounded-host 8);
  - M24 NODE_OPTIONS quotes kept, and M25 the percentage flag missed (bounded-host 6);
  - M26 the port bound under a heap-size flag (exposure 6, chat-runtime 4);
  - M27 the host's refusal an implementation failure (exposure 6);
  - M28 `withdrawAuthority` keeping the fact and the authority (exposure 4);
  - M29 the route never stating the fact (chat-runtime 2, 3);
  - M30 a throwing factory reaching the route (chat-runtime 4);
  - M31 the service ignoring the run's cancellation, and M32 the port handed a signal nobody aborts (exposure 6, 9);
  - M33 the host never hearing the abort (exposure 9);
  - M34 consumed only after the executor (approval 7, 8), and M35 an approved request never expiring (approval 7);
  - M36 no 16-entry list bound (catalog 4);
  - M37 a held result never parsing (exposure 7);
  - M38 and M39 no eviction per run or per port, and M40 an over-limit board reaching the engine (exposure 8);
  - M41 the seeded deck unscreened (approval 8);
  - M42 a complex raw file read as real, M43 a run that did not exit read for evidence, M44 a time-zero step run, and M45 an executor
    that throws breaking the consumption (approval 8).

  Twenty-eight of twenty-eight caught, each exit 1.

## 9. Pin moves (each reviewed; the reason beside it)

No gate regex and no `NEVER_EXPOSED_TOOL_PATTERNS` entry was widened (`b22-b-exposure` case 3 pins the six patterns); no route was
added (165 = 162 + 3 + 0); the CD-10 501, its pin and `executeAuthoritativeSimulation` are unchanged; no B11-scanned file was touched;
SEC-1's pins (`sec-1-deck-injection`, the CI guard's SEC-1 case, the byte-pinned classification CSV) did not move. [B22-B review,
2026-10-02] The review's fixes moved no pin of another increment's suite: they extend B22-B's own five suites and add
`b22-b-chat-runtime`, and they add dated notes with no existing line moved: in place in `threat-model.md` (T10, section 5, the
census paragraph) and `specialist-roles.md` (four lines), and appended at the end of `isolation-verdict.md`.

- **Exposure ratchets** (D22-16; OD-139): `b21-a-contracts` (33 -> 36, twice), `b21-c-role-tools` (the coordinator row 36),
  `b21-e1-result-tool` (36, registry 47), `b20-a4-observation-descriptor` (36), `b20-c1-three-way-parity` (`{ registry: 47,
  agentExposed: 36, mcpExposed: 9, agentOnly: 27 }`), `b20-c3-a2-cross-check` and `b20-c3-descriptor-text-gate` (47),
  `b20-b4-withhold-proposals` (the base registry also leaves out the five; 36), `b20-b3-mcp-subset-move` (the base registry leaves
  out the five like A4's addition; case 4's added ids; case 5's 36), `b20-b1-mcp-exposure` (the closed MCP reason list gains
  `computation` after `never_exposed`; the excluded table; agent-only 27; the channel case compares over the base registry and pins
  the three reads offered on assistant-agent only and the two requests on no channel), `b20-d2-never-reachable-sweep` (E1's title
  says thirteen reasons; E3's groups gain `computation`), `b17-f-agent-exposure` and `b18-c-exposure-lift` (the three reads named as
  a later reviewed addition), `b04-tool-registry` (the activated-binding tripwire resolves a `bound-computation` read by its own
  allowlist, never a B05 binding), `b17-a-control-inventory` (`computation.named-read` runs only inside `POST /api/chat`, no control
  or route of its own), `b09-3-closure` (a computation read is conditional on the computation port alone), `b21-c-least-privilege`
  case 7 (the exposure list is the A4L bound + 4; any 33 of it still approve nothing). Each edit is in place on a cited line or at
  the end of the file: no cited line moved (`b21-c-page` names `b18-c-exposure-lift.test.ts:58`, `b17-f-agent-exposure.test.ts:92-93`,
  `b20-b3-mcp-subset-move.test.ts:136-137`, `b20-b1-mcp-exposure.test.ts:441-449`, `b04-tool-registry.test.ts:465-476`).
- **Process gates** (OD-140): `b20-b4-process-gate` - `APP_SPAWNERS` moved once to add the engine host and its worker entry (each
  names `worker_threads`), case 1's title follows, case 2 keeps both out of the MCP closure; `b22-a3-single-spawner` case 1 - the two
  thread starters join the computation tree, the ngspice spawner is still the runner alone; `b22-a2-process-census` - the two are
  reviewed `THREAD_STARTERS` (no `external_process` label: a thread, never a process; case 1 pins that each names `worker_threads`
  only and calls no `spawn`, `exec` or `fork`), `/api/chat` reaches the host (case 5), and `threat-model.md`'s census table lists it.
- **Generated artifacts**, each through its own generator: B04 (`tool-registry.csv`, `non-callable-coverage.csv`,
  `provider-schema-parity.json`), B01 (`ui-command-toolability-matrix.csv`), B09 (the exposed-tool manifest, the activation audit,
  the provider parity, the replay fixtures), B20 (`mcp-parity.json`/`.md`, `mcp-tool-manifest.csv`/`.json`), B11
  (`replay-trace-pins.json`, `evaluation-results.json`: every trace binds the registry digest, which moved; the 19 cases' tools and
  outcomes are unchanged) and B21 (`replay-trace-pins-b21.json`, which binds the B11 pins' SHA-256). Every other generator ran with
  zero drift (section 10).
- **Pages**: B20 `mcp-exposure.md` (47 descriptors, 38 excluded, the `computation` row, the agent-set sum 36) and
  `mcp-adversarial.md` (the D2 sweep's derived counts: 235 requests, 192 refusals); B21 `specialist-roles.md` (the coordinator row's
  note quoted from `role-tools.ts`, which no longer states a count, and a dated note on D21-9's "33"); B22 `threat-model.md` (the
  census table and the chat entry point).
- **`route.ts` keeps its 562 lines** (the B21-E4 page pins it): the boundary import replaces the blank line after the import block
  (line 47); the fact and the port ride lines that already existed (no cited line moved).
- **Stale count wording left for the closeout** ([B22-B review, 2026-10-02], coverage-8; beside discovery 9.5 item 10's seven). Each
  assertion below is right; only its words still count the agent set as 33 (it is 36 since B22-B). Like 9.5 item 10's titles they
  are not retitled here (a retitle is the closeout's reviewed move):
  - `b21-c-least-privilege` case 7's title, "... the 33 approve nothing; ... since no id of the reviewed 33 matches a pattern today"
    (its body loops over all 36 and checks that the first 33 approve nothing);
  - `b21-c-least-privilege` case 3's title, "naming an id outside the 33";
  - `b20-b3-mcp-subset-move` case 5's title, "the agent set is still B3's 32 without A4's one addition (33 with it)" (its body pins 36);
  - the comments `b21-a-contracts.test.ts:6` ("outside the 33") and `b21-c-role-tools.test.ts:140` ("outside the 33");
  - `orchestration-contracts.md` :195 ("the one reviewed 33-id list") and :198 ("an id outside the 33").
  `specialist-roles.md`'s four such lines (:111, :128, :131, :132) now carry a dated note (36), in place, with no line moved. [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): each item above is retitled or noted in place by the closeout, its assertions unchanged (closeout-statements.md section 2)]

## 10. Final runs

All on the final tree, each under the lock with its exit code captured. [B22-B review, 2026-10-02] Re-run in full by the review's
fix run on its final tree; the numbers below are that run's (where they differ, the second run's follow in parentheses).

- **A** - `app/lib/computation/__tests__`, `app/lib/spice/__tests__`, the CI guard (`b19-e-ci-job-scope`): 24 files passed, 2 skipped (the
  opt-in `worker-integration` and `b22-a3-runner-live`), 529 passed, 8 skipped; exit 0 (second run: 23 files, 518). The six B22-B
  suites (42 cases; 31 before the review) ride the existing `app/lib/computation/__tests__` filter (OD-146): no CI line added, the
  guard green.
- **B** - `app/lib/engineering/__tests__`: 99 files, 1,107 passed; exit 0.
- **C** - `app/lib/agent/__tests__`: 1 failed / 414 passed of 415, exit 1 - only `b11-5-capture-exactness` case 12, whose six entries
  (writes in the A1, A2 and A3 suites) are exactly the clean-tree baseline's; B22-B's suites write nothing.
- **D** - `app/lib/agent/orchestration/__tests__` (B21, with its page suites): 49 files, 460 passed; exit 0.
- **E** - `app/lib/mcp` (the B20 page suites, the process gate and the MCP closure, `b20-b2`, `b20-b3`, `b20-d3`): 45 files, 825
  passed; exit 0.
- **F** - `app/api/chat/__tests__`, `app/api/mcp/__tests__` (the B20-D2 never-reachable sweep), the census tripwires
  (`b16-1c-invariant-tripwires`: 165 = 162 + 3 + 0) and the B14.4, B15.3 and B18-B import gates: 33 files, 288 passed; exit 0.
- **G** - the registry-dependent suites elsewhere (the B16 auth confinement and CI gates including the 501 pins, `b20-b2` route policy,
  the B19-E atomic and acquisition routes, the execution-grant, proposal, project, view-session and workflow suites): 27 files, 375
  passed; exit 0.
- `tsc --noEmit -p tsconfig.json`: exit 0. `eslint` on the 57 changed or new TypeScript and `.mjs` files: exit 0 (second run: 56).
- Generators (20, each under the lock, the tree's state hashed before and after each): `generate-b11-artifacts` moved
  `replay-trace-pins.json` and `evaluation-results.json` (the registry digest each trace binds; the 19 cases' discovered tools and
  outcomes unchanged) and `generate-b21-artifacts` moved `replay-trace-pins-b21.json` (it binds the B11 pins' SHA-256); every other
  generator - tool registry, toolability matrix, read invocation, agent artifacts, B10, B16.0, B16.0.1, B16.0.2, B16.0.4, B16.0.7,
  B16.0.8 (3 -> 3), B17 control inventory (628 controls), B19 source registry, B20 parity, server registry and tool manifest, B06,
  the PCB shape descriptor - zero drift. A second pass on the final tree (fourteen of them: every registry-, exposure-, census- and replay-bound generator) - zero drift, the B11 and B21 pins included.
  [B22-B review, 2026-10-02] The review's fixes touch no registry, exposure, census or replay input: the same fourteen re-ran on
  its final tree with zero drift (47 descriptors, 36 agent-exposed; MCP 9 of 36, 27 agent-only; 165 = 162 + 3 + 0; 628 controls).
- The intermittent `b22-a3-diagnostic-runner` case 10 (section 11) passed in the final A run (and in the review run's).
- Files are LF only, with no control byte; the reserved files are untouched; no B11-scanned file changed.

## 11. What stays open (recorded, not closed here)

- **The placement experiment cannot run**: the placement engine is TypeScript whose module graph a worker cannot load without a
  build step; the profile exists, the request is sealed, approved and consumed, and the host refuses it `ENGINE_UNAVAILABLE`. The
  OD-87 precondition is therefore met for the host (hard termination at the budget, observed exit, heap limits, empty environment)
  and NOT for placement itself; B20's F1 (`/api/pcb/placement/preview` blocking the event loop) stays open for the same reason. [B24-closeout, 2026-10-10] superseded: B24-A3's record, artifacts/ai-control-plane-b24/abuse-controls.md:334.
  [B22-B review, 2026-10-02] coverage-5: that is OD-87's first path only; its second (an accepted bound after a real-board probe)
  and third (placement only below a measured footprint cap) need no host and stay open (section 7).
- **No human approval surface** (OD-159, proposed): approving a process-backed request needs an authenticated route (a reviewed
  census move, 165 -> 166+); B22-B adds none, so the two process-backed descriptors stay registered and dormant and the request store is a
  contract in memory (OD-141's aggregate would persist it).
- **OD-158**: production chat binds no computation port until the owner sets `SIRKIT_NAMED_COMPUTATIONS=1`, after qualifying how
  `next build` serves `engine-worker.mjs` beside the host (no build was run) and that the server process carries no V8 heap-size flag
  (else every call is refused `ENGINE_HEAP_LIMIT_OVERRIDDEN`). [B22-B review, 2026-10-02] Now enforced, not only recorded: under a
  heap-size flag the resolver binds no port, so the reads are withheld. Under `next dev` (the `dev` script and the Playwright web
  server) the opt-in therefore also needs `NEXT_DISABLE_MEM_OVERRIDE=1`, because Next 16.2.6 writes `--max-old-space-size` into its
  server's NODE_OPTIONS otherwise (section 3).
- **No queue at the engine host** ([B22-B review, 2026-10-02], security-2): a run over the cap of 2, or over its tenant's share of 1,
  is refused `ENGINE_HOST_BUSY` at once (the model sees `busy` and may call again). A bounded wait queue with a fair grant order, as
  the diagnostic runner has (OD-155), was not added. The engines answer in milliseconds over bounded inputs, a run's tool calls are
  sequential (`loop.ts`), and a queue would need its own wait bounds and cancellation. RECORDED as a stated choice under OD-158.
- **The engine host is no isolation boundary**: a worker is a thread of the server process (its file system, network, CPU and
  external memory are the server's); it bounds the time and JS heap of Sirkit's own closed engines over server-validated inputs.
- **A specialist claim**: `specialistContextClaims` (B21) names no computation claim; a specialist never holds the fact because
  `deriveSpecialistContext` is built field by field (pinned, `b22-b-exposure` case 4), and no role row holds a computation id.
  [B22-B review, 2026-10-02] coverage-6: the follow-up coordinator turn's `withdrawAuthority` spreads the rest of the context, so it
  is a second guard. It is now pinned by the same case. A ninth claim (`computationAvailable`) was NOT added to
  `SPECIALIST_CONTEXT_CLAIMS`. That would change OD-109's applied vocabulary ("eight ways", `OWNER_DECISIONS.md`) and move pins in
  four B21 suites (`b21-c-no-elevation`, `b21-d2-proposing-roles`, `b21-d3-replacement-roles`, `b21-c-page`) and the B21 page.
  Without it the failure is closed: the follow-up turn's gateway is the specialist gateway, which carries no computation port
  (`orchestration-runtime.ts`, `followUpDeps`), so a computation call there is refused `authority_unavailable`. RECORDED as a
  stated choice under OD-158: the owner may add the claim as a reviewed B21 pin move, or keep the two derivations as the guard.
- **Live**: no ngspice, java or worker outside the test process ran; the circuit analysis's live behaviour (section 5) and every
  real-process case stay the A3 opt-in suite's and LB-3/LB-8/LB-10's.
- **A pre-existing intermittent failure, not B22-B's**: `b22-a3-diagnostic-runner` case 10 ("timed out waiting for the probe to
  start", after its 2 s wait) failed 3 of 8 runs on the adopted tree and 1 of 8 runs on the HEAD sources (the same case, the same
  message; RECORDED with every log). Root cause not established; B22-B touches neither the runner nor its suite.

## 12. The B22 closeout's export record (2026-10-02)

[B22 closeout, 2026-10-02] The B22-B exports no production source calls, each with why it exists (D22-16's closeout record;
`closeout-statements.md` section 3, re-derived from the tree by `b22-closeout-statements` case 8). **CONFIRMED** by `git grep` and
that case on `c9fbbb0` with the closeout's edits:

- `requests.ts` and `request-executors.ts` (`app/lib/computation/`): a **dormant contract**, every export - section 5's inert sealed
  request (`sealComputationRequest`, `verifySealedComputationRequest`, `ComputationRequestStore`, `computationEvidence`) and the
  executors an approved request would run (`createComputationRequestExecutors`, `buildCircuitAnalysisDeck`, `readStrictRaw`). No
  production module imports either, but for `request-executors.ts` importing `requests.ts`; the descriptors and the action registry
  name them only in text. They are bound only through a reviewed census move with an authenticated approval route (OD-159).
  `readStrictRaw` stays exported: `b22-d-adversarial` case 8 runs it in the one parser corpus (B22-D item 16), and since B22-D it reads
  every file through the output validator.
- `COMPUTATION_EVIDENCE_SCHEMA` in `requests.ts` has the evidence store's name and value (`sirkit.computation-evidence.v1`) for a
  different closed shape. **RECORDED**: before anything persists a request (OD-159 plans to persist with the aggregate, OD-141) the
  dormant shape needs its own schema id, or the store's `validateEvidenceDocument` refuses it; renaming it moves `b22-b-approval`'s
  pin, so it is left as written here.
- `setComputationPortFactory` and `resetComputationPortFactory` (`app/api/chat/computation-runtime.ts`): **test seams** -
  `b22-b-chat-runtime`'s port double and its deterministic reset; the module says it is never a production path.
- `TOOL_AUTHORITY_SOURCES` (`app/lib/engineering/tool-registry.ts`): a **vocabulary** - the authority sources as data beside
  `ToolAuthoritySource`, read by the registry suites; B22-B added `computation-engine`.
- `computationService` (an `AgentGatewayOptions` field, `app/lib/agent/gateway.ts`): an **injection seam**, the same kind as its
  siblings `readService`, `proposalService` and `layoutProposalService`, which no caller sets either; when it is absent the gateway
  builds its own `ComputationReadService`.
- `ArtifactParser` (`app/lib/computation/catalog.ts`): **retired** - a type name referenced nowhere, not even by a test; one tombstone
  comment holds its line, so no line moved.
