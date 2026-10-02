# B22-A2 - threat model: engineering executables, simulation and the evidence they produce

Labels: **CONFIRMED** (read at the cited file, or executed by a suite named here), **INFERRED** (a conclusion from reading code or
documentation; never executed), **RECORDED** (written down from a record or the lead's observation, without a claim of our own),
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Branch `chapter/b22-sandboxed-computation`, base `50fe156` (B22-A1), 2026-10-01. Increment B22-A2 of the runbook's B22 (`:888-906`,
pass `:942`), read with discovery D22-1, D22-2, D22-11, D22-18, D22-23 and section 9 (9.4's A2 bullet; 9.5 items 11, 13, 22, 28).
This page names what an attacker could take, who the attackers are, where they enter, and for each threat the control, what enforces
it and the test that pins it. Its census table (section 3) is checked against the source by `b22-a2-process-census` case 7. Nothing
here was executed beyond the suites named; no process was started; nothing is called a sandbox or authoritative.

## 0. The boundary in one paragraph

Every engineering executable runs today as a plain child process of the Next.js server on the host, with no OS limit on CPU, memory,
process count, file size or network (D22-1, **CONFIRMED** by reading the five spawners; [B22-A3, 2026-10-01] three since the three
ngspice sites became one diagnostic runner, OD-136). What stands between a caller and the host is
server code: authentication, membership and role checks, bounded readers, the SPICE deck and model screens (SEC-1, B22-A1), explicit
child environments (SEC-1, B22-A1), output bounds (B22-A1) and wall-clock timers. That is prevention, not isolation: a construct the
screens miss runs with the server user's rights. The CD-10 authoritative runner therefore stays BLOCKED (`isolation-verdict.md`), and
B22-A2's runtime profiles (`runtime-profiles.md`) state for every limit whether the OS, the runner or nothing enforces it.

## 1. Assets

| asset | what an attacker gains | where it lives |
|---|---|---|
| server secrets | provider, database, Supabase, distributor and workflow keys; a child that inherits them, or prints them, hands them over | the server process environment; `.env.local` on this host (never read here) |
| the host filesystem | reading project files, keys or other tenants' run directories; writing outside a run directory | the server user's files; the OS temp directory (`sirkit-spice/<id>` run directories, FreeRouting's uuid files, the fab bundle's `sirkit-fab-` directories) [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): ngspice runs use per-run mkdtemp directories under sirkit-ngspice-runs, removed in the runner's finally and, after a kill_unconfirmed, again once the child's close is observed (B22-A3)] |
| the network | an outbound connection from the host (an SMB share through a UNC path, an HTTP fetch), reaching internal services | the host's network stack; no child is denied it by the OS |
| the event loop | one request blocking every other user's request (a synchronous engine, an unbounded read) | the single Node server process |
| evidence truth | a run that looks completed, verified or authoritative when it is not; a fabricated or dropped result | run records, SPICE reports, the CD-10 routes' answers, the classification CSV |

## 2. Adversaries

- **A WRITE_EDITORS project member** (`pcb_editor`, `project_admin`, `automation`; `app/lib/auth/route-policy.ts:54`): starts SPICE runs
  (`POST /api/spice/runs`) with a whole `SimulationProject` from the request body, so every string the deck compiler writes is theirs.
  A plain EDITORS member (adding `reviewer`; `:53`) reaches `/api/simulate`, the model smoke test, `/api/pcb/autoroute` and
  `/api/chat`; REVIEW_EDITORS reach the gerbers export (`:55`). Assumed: authenticated, a live member, able to send any body the
  bounded reader admits. Not assumed: a server-side foothold.
- **Model output through the SPICE AI routes** (`/api/spice/ai`): a prompt injected through imported project or model text steers the
  model into proposing overlay elements, variables, analyses and run requests. Since B22-A1 (OD-150) every operation whose strings
  reach a deck, and the run request, is "review" and never pre-selected: a human selects each before Apply (CONFIRMED,
  `b22-a1-spice-ai-approval`). The strings are screened at the compiler either way (SEC-1).
- **A hostile vendor model file**: SPICE model text imported or pasted into a project (`.lib`, `.include`, XSPICE code models with file
  parameters, `d_process`/`d_cosim`, a `+` continuation opening a model, a `.control` block). It reaches the deck as model text.
- **A replaced binary on PATH**: ngspice, kicad-cli and java are found through `NGSPICE_BIN`/`KICAD_CLI`/`FREEROUTING_*`/`JAVA_HOME`
  or PATH and are never digest-checked (D22-2, CONFIRMED); whoever can change PATH, those variables or an install folder runs code as
  the server user at the next spawn. [B22-A3, 2026-10-01] ngspice is no longer found this way: the diagnostic runner starts only the
  install `SIRKIT_NGSPICE_INSTALL_ROOT` names and refuses it, before every spawn, unless its install-tree digest equals
  `SIRKIT_NGSPICE_INSTALL_SHA256` (OD-135); kicad-cli and java still are, and a rewrite of the pinned tree is refused only once the
  digest or its stat fingerprint sees it. Also covers a tampered install (a changed `spinit`, a replaced code-model library) and, for the
  OCI design, a replaced docker CLI: the container profile's argv runs on the host through it, not inside the image.

## 3. Entry points (discovery 2.2-2.3) and the process census

The routes that start an engineering executable, the roles that reach them and what the caller controls (CONFIRMED by reading
`route-policy.ts:96, :106, :286-297` and the spawners):

| entry point | roles | executable | what the caller controls |
|---|---|---|---|
| `POST /api/spice/runs` | WRITE_EDITORS | ngspice (worker) | the whole project, run plan and parts: every deck string (screened, SEC-1, B22-A1) |
| `DELETE /api/spice/runs/[id]` | WRITE_EDITORS | stops ngspice (cancel) | which own run to cancel |
| `POST /api/simulate` | EDITORS | ngspice | a whole schematic; the deck comes from coordinates (its own B19-D screens) |
| `POST /api/spice/models/smoke-test` | EDITORS | ngspice | one model's text (the model screen and the final deck screen) |
| `POST /api/pcb/autoroute` | EDITORS | FreeRouting (java) | a board (written as DSN) and a pass budget (`maxPasses`, bounded) |
| `POST /api/pcb/qualify` | `pcb_editor`, `project_admin` | FreeRouting (java), except in fixture replay (fixture mode with `SIRKIT_FIXTURE_ROUTER` `record` or `live` starts it) | the qualification request; the board is server-held |
| `POST /api/chat` | EDITORS (body-scope server actor) | FreeRouting (java), through `sirkit.routing.propose`; [B22-B] a worker thread of the bounded engine host (no process), through the three named computation reads | the conversation; the model chooses the tool (agent-exposed); a computation's closed input (bounded numbers, closed enums, server-held digests) |
| `POST /api/pcb/export/gerbers` | REVIEW_EDITORS | kicad-cli | a board, a fab preset id (a closed server table), a board name (sanitized) |

**The census.** `b22-a2-process-census` derives, from the source, which routes reach a spawner (the five files under `app/` that
reference a process module, [B22-A3, 2026-10-01] now three - the diagnostic runner, the one ngspice spawner, FreeRouting's runner and
kicad-cli's runner, the runner's own `taskkill` being its tree kill, not an engineering executable; [B22-B review, 2026-10-02] five: the three spawners and the two thread starters, the bounded engine host and its worker entry - reviewed `THREAD_STARTERS`, a worker thread of the server process, never an external process; the runtime import closure,
walked with the MCP gates' edges) and compares it with the
`external_process` column of `artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv`. A route that reaches a
spawner is taken to start it unless a reviewed exemption shows, by call reachability, that it cannot. B22-A2 corrected the three rows
D22-18 found wrong (`/api/chat` and `/api/pcb/qualify` now `freerouting (java)`; `/api/pcb/release` no longer claims kicad-cli - it
writes Gerber and Excellon natively) and regenerated the CSV through `scripts/generate-b16-0-2-artifacts.ts`. Every route whose
closure reaches a spawner (case 7 checks this table):

| route | reaches | external_process |
|---|---|---|
| `/api/chat` | `app/lib/computation/engine-host.ts`, `app/lib/pcb/autoroute/runner.ts` | `freerouting (java)` |
| `/api/pcb/autoroute` | `app/lib/pcb/autoroute/runner.ts` | `freerouting (java)` |
| `/api/pcb/export/gerbers` | `app/lib/pcb/fab/kicad-cli-runner.ts` | `kicad-cli` |
| `/api/pcb/qualify` | `app/lib/pcb/autoroute/runner.ts` | `freerouting (java)` |
| `/api/simulate` | `app/lib/computation/diagnostic-runner.ts` | `ngspice` |
| `/api/spice/models/smoke-test` | `app/lib/computation/diagnostic-runner.ts` | `ngspice` |
| `/api/spice/runs` | `app/lib/computation/diagnostic-runner.ts` | `ngspice` |
| `/api/spice/runs/[id]` | `app/lib/computation/diagnostic-runner.ts` | none - reviewed: GET reads a record; DELETE stops a live run through cancelRun and never starts one |
| `/api/spice/runs/[id]/bundle` | `app/lib/computation/diagnostic-runner.ts` | none - reviewed: reads a record and zips what it carries (no file read since B22-A3) |
| `/api/spice/runs/[id]/events` | `app/lib/computation/diagnostic-runner.ts` | none - reviewed: streams a record's events |
| `/api/spice/runs/[id]/waveforms` | `app/lib/computation/diagnostic-runner.ts` | none - reviewed: slices a record's waveforms |

[B22-A3, 2026-10-01] The ngspice rows name the diagnostic runner (OD-136): `/api/simulate` and the smoke test call it directly,
`/api/spice/runs` and its four record routes reach it through the job store and the worker, which start no process of their own.
[B22-B, 2026-10-01] `/api/chat` also reaches `app/lib/computation/engine-host.ts`, the bounded engine host behind the three named
computation reads (OD-139, OD-140; bound to a run only with `SIRKIT_NAMED_COMPUTATIONS=1`, OD-158): it and its worker entry
`engine-worker.mjs` reference `worker_threads` and start a worker THREAD of the server process for Sirkit's closed engines, never an
external process, so they are reviewed thread starters in the census (`THREAD_STARTERS`) with no `external_process` label, and the
chat row's column stays `freerouting (java)` (`named-computations.md`).

- The four `/api/spice/runs/[id]*` routes import the job store and through it the worker, but call only `getRun`, `cancelRun` and
  `subscribeRun`; inside the job store only `startRunPlan` reaches `executeRunPoint` (case 4: reachability over every top-level
  binding of the job store, and over the route's whole closure - every module in it that imports the job store imports only
  non-starting bindings by name; case 6 shows the census drops the exemption when the route or a helper such as `_scope.ts` imports
  `startRunPlan`, when a const or an import-time statement reaches the run, around the job store, or through a namespace import). DELETE aborts the run's signal through `cancelRun` -> `cancelInternal` -> `job.abort.abort()`, and the worker
  then kills its child: it stops a process (D22-9's direct-child kill; [B22-A3] the runner's tree kill) and starts none (discovery 9.5 item 28).
- The column is per path (`route-resource-classification.ts` annotates paths): `GET /api/spice/runs` shares the POST row's `ngspice`
  although the GET handler only lists records. RECORDED, unchanged.
- `/api/pcb/qualify` starts FreeRouting outside fixture mode, and inside it when `SIRKIT_FIXTURE_ROUTER` is `record` or `live`
  (CONFIRMED by reading; census case 5 pins it): `production-router.ts:39` hands fixture mode to `fixtureRouteExecutor`, whose `live`
  and `record` branches call `createReal()`, the real FreeRouting executor (`app/lib/fixture-runtime/router.ts:54-60`); only the
  default `replay` starts nothing. Fixture mode is honoured only in a non-production local-development runtime
  (`fixture-runtime/mode.ts:18-21`). The row says it can spawn, which is the truthful bound. This corrects discovery 9.5 item 28's
  "only outside fixture mode", which the code contradicts.

## 4. Threats, controls, enforcement and tests

"Enforced by" uses the profile vocabulary: **os** (the operating system or a container runtime), **runner** (Sirkit's own process
code, around the child), **server code** (a screen or check before any process exists), **none**.

| id | threat | assets | adversary | control | enforced by | test |
|---|---|---|---|---|---|---|
| T1 | a deck runs an ngspice command (`.control`, `*#`, `*ng_script`, an included control block) and through it `shell` | secrets, filesystem, network | member, model output, vendor model | every caller string screened as one line at the IR->deck boundary; a final screen on every executed deck cut to ngspice-46's executing set (SEC-1, the lead's probes p0-p22); `/api/simulate`'s own screen | server code | `sec-1-deck-injection`, `b19-d-deck-injection`, `b22-a1-model-screen` |
| T2 | a model or deck reads a host file (`.include`/`.lib`, a traversing or UNC path, an XSPICE `file=`, `input_file=`, `state_file=`) or starts a program or loads a library (`d_process`, `d_cosim`) | filesystem, network | vendor model, member | the model screen reads exactly the emitted text, refuses every `.lib`, any include, a non-plain path, XSPICE file parameters naming anything but a plain relative file, and the two code models, reading cards as ngspice joins them (B22-A1); the final deck screen repeats the file-read rules | server code | `b22-a1-model-screen`, `sec-1-deck-injection` |
| T3 | a child inherits or prints server secrets | secrets | any, after T1/T2 or a planted init file | explicit child environments: the ngspice allowlist (SEC-1), kicad-cli's (B22-A1), FreeRouting's (precedent); the profile contract is an exact map with no HOME/USERPROFILE and no secret-shaped key (B22-A2; B22-A3 executes it for ngspice); the OCI design passes only `--env KEY=VALUE` pairs equal to that map, and the validator refuses `-e`, `--env=`, `--env-file` and a bare name (which would copy the docker CLI's own variable); [B22-A3 review, 2026-10-01] on win32 Node (libuv) adds eight non-secret host variables to any child whose map lacks them - `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `USERNAME`, `USERDOMAIN`, `LOGONSERVER`, `SYSTEMDRIVE`, `WINDIR` - recorded on every ngspice run (`hostAddedEnvironment`), no secret among them | runner (today's allowlists; [B22-A3] ngspice: the profile's exact map, executed by the diagnostic runner, plus Node's eight on win32); contract only for the exact map | `sec-1-deck-injection` (canaries), `b22-a1-secret-env`, `runner-security`, `b22-a2-runtime-profile` cases 7, 16 |
| T4 | a `.spiceinit` in HOME or the cwd runs at ngspice start | secrets, filesystem | anyone who can write HOME or a run directory | before B22-A3 none (HOME and USERPROFILE passed, no `-n`; D22-5); the contract drops HOME/USERPROFILE from the map and fixes the cwd to a server-created per-run directory; B22-A3 passes `-n` (the lead's probe p23: without it a run-directory `.spiceinit` runs) | [B22-A3] runner: `-n` on both ngspice argv templates and a fresh per-run cwd; [B22-A3 review] no HOME/USERPROFILE in the map passed, but on win32 Node adds the server's `USERPROFILE`, `HOMEDRIVE` and `HOMEPATH` (libuv), so `-n` is the one layer that keeps a home `.spiceinit` from running, not two | `b22-a2-runtime-profile` case 7 (contract); B22-A3's runner suite |
| T5 | an outbound connection from a child (a UNC share, a URL) | network | vendor model, member | the screens refuse include/lib/XSPICE paths that are not plain relative names; no OS network denial for a local child; the OCI profile's `--network none` is designed and unqualified, and its `os` claim is refused without that flag | server code (prevention); os only in the unqualified OCI design | `b22-a1-model-screen` (UNC cases); `b22-a2-runtime-profile` cases 9 (local network `none`), 16 (the OCI flag) |
| T6 | output or files exhaust memory or disk (huge stdout, a huge raw or session file) | event loop, filesystem | member, vendor model | stdout/stderr held and returned within 64 KiB (B22-A1); gerber, drill and session files read through a bounded reader (B22-A1); [B22-A3] the ngspice raw file read back through the runner's bounded reader, an over-bound file refused unread (D22-8); no OS file-size limit | runner (streams, tool files; [B22-A3] the ngspice raw file through the runner's bounded reader); none (file size) | `b22-a1-diagnostic-bounds`, `b22-a1-tool-output-bounds`, `b22-a2-runtime-profile` case 9 |
| T7 | a run that never ends, or leaves children behind | event loop, host | member, vendor model | wall-clock timers in every spawner; [B22-A3] ngspice: a tree kill, terminal only after the child's close or as `kill_unconfirmed`, one global cap shared by tenant with every wait for a slot bounded (OD-145, OD-155); FreeRouting and kicad-cli keep a direct-child kill and resolve before exit (D22-9; B22-B/D [superseded 2026-10-02 by the B22 closeout (D22-9, OD-145): neither B22-B nor B22-D took them (`adversarial-matrix.md` section 8, finding 2); open]) | runner (timers; [B22-A3] ngspice: the tree kill, terminal after close or `kill_unconfirmed`, one global cap); none (FreeRouting's and kicad-cli's descendants; the Studio record is still marked cancelled at the request, B22-C) | `b16-0-23-tranche-parity` (terminal guard); B22-A3's runner suite (tree kill) |
| T8 | CPU, memory or process count without limit (a fork-like deck, a runaway engine) | host, event loop | member, vendor model | none on this Windows host (no job object, OD-145); the deck screens refuse every spawning construct; the OCI profile's cgroup limits are designed and unqualified, each `os` claim refused unless its flag carries the claimed value | none (local); os only in the unqualified OCI design | `b22-a2-runtime-profile` cases 9 (no OS claim by a local profile), 16 (each OCI claim and its flag) |
| T9 | a replaced or tampered executable runs (for the OCI design also the docker CLI on the host that runs its argv) | everything the server user can reach | replaced binary on PATH | before B22-A3 none (PATH and variables chose the binary; D22-2), and still none for kicad-cli and FreeRouting; [B22-A3] ngspice: the pinned install, refused before every spawn unless its digest matches (OD-135); the contract: the install-tree digest from a named server setting, refused on mismatch or when unpinned (B22-A2 defines it; B22-A3 enforces it for ngspice); FreeRouting's digest names its JAR and JRE because setup rewrites a manifest beside them; a container profile's `hostClient` binds the docker CLI by `SIRKIT_OCI_CLI_PATH` and a file digest in `SIRKIT_OCI_CLI_SHA256` (never PATH; unpinned; its context and configuration UNKNOWN until B22-A4), and `validated` needs it pinned | [B22-A3] runner (ngspice: an unpinned or mismatched install is refused before every spawn); none (kicad-cli, FreeRouting); B22-A4 (the docker CLI) | `b22-a2-runtime-profile` cases 4, 5, 10, 15, 18 |
| T10 | a synchronous engine blocks the event loop | event loop | anonymous (the placement preview), member | none for in-process engines (B20 F1, D22-17; B22-B's bounded host); [B22-B review, 2026-10-02] the three named computation reads run off the request's thread in the bounded engine host's worker threads, stopped hard at their budget (`terminate()`, terminal only once the exit is observed or as `confirmed: false`), at most 2 per server process and 1 per tenant (OD-140, `named-computations.md`); the placement preview (F1) is unchanged - the placement engine has no worker entry | none (F1); [B22-B review] runner - the engine host, around its worker thread (the named computations) | none - B22-B (F1); [B22-B review] `b22-b-bounded-host` (the named computations) |
| T11 | a diagnostic run is presented as authoritative or validated; a request self-declares a validated profile | evidence truth | member, model output | the 501 and the throwing stub; no B22-A2 profile is `validated` or authoritative-eligible; the execute and readiness routes still trust body profiles (D22-6, latent behind the 501; B22-C) [B22-C review, 2026-10-02] no longer: both resolve the provider and the environment from the server by id and digest and refuse a differing body copy 409 with a closed code (D22-6 closed, OD-138); the registry is read server-side and passed in | server code | `b22-a2-blocked-runner`, `b16-0-20-simulation-confinement-gate`, `b16-0-20-tranche-parity`, `b22-a2-runtime-profile` case 8, `b22-c-authority` |
| T12 | a completed run keeps no result, or results are mislabelled by the parsers | evidence truth | none needed (a defect) | D22-7 (observed at the fake seam by B22-A1) and D22-10 stay with B22-C [B22-C review, 2026-10-02] closed: the job store attaches a result and its evidence before it publishes the terminal status, a completion whose evidence is refused fails the run itself, and both parsers route through one output validator that refuses a bad output whole, keeping the run's logs and manifest | none; [B22-C review, 2026-10-02] server code | none - B22-C; [B22-C review, 2026-10-02] `b22-c-job-store-terminal`, `b22-c-output-validator` |
| T13 | the census of process-starting routes drifts from the code | evidence truth (the classification) | none needed (drift) | the connective census test; the corrected rows | server code (a CI test) | `b22-a2-process-census` |
| T14 | locale, time zone, seed or thread count change a result | evidence truth | none needed (environment) | the contract pins LC_ALL=C and TZ=UTC in the exact environment, the seed by a deck option and the installed spinit's thread count by the install digest; [B22-A3] the runner sets them for ngspice (the exact map's `LC_ALL=C` and `TZ=UTC`, `.options seed=1` in every run deck, a deck that sets its own seed refused); kicad-cli and FreeRouting set none (D22-11) | [B22-A3] runner (ngspice: LC_ALL=C and TZ=UTC in the exact environment, `.options seed=1` in every run deck; on Windows the locale effect is INFERRED) | `b22-a2-runtime-profile` cases 7, 12 |
| T15 | a link in a run or install directory redirects a read or write | filesystem | anyone who can write there | the install-tree digest refuses any link (B22-A2); per-run directories are B22-A3's | server code (digest; the runner's stat fingerprint refuses a link too); runner ([B22-A3] mkdtemp run directories under one root, removed on every path); none (a link at the root or a raw file that is a link: B22-D item 4); [B22-D, 2026-10-02] runner: a link, a junction or a file at the runner root, and a raw file that is not a plain file with one name (a link, a hardlink, a directory or a device), are refused by `lstat` before use (`adversarial-matrix.md` G2, G3); none: a process of the server user can still swap either between the check and its use, and a link it plants redirects ngspice's own write | `b22-a2-runtime-profile` case 5; [B22-D] `b22-d-adversarial` cases 3, 4 |

## 5. What stays open (residual risk, by increment)

- **No isolation boundary** (D22-1): every row above whose enforcement is "server code" or "none" is open to a construct the screens
  miss. Only an OCI engine qualified under LB-10 can move a row to **os** (`isolation-verdict.md`). BLOCKED-LIVE-QUALIFICATION.
- **B22-A3**: the profile executed for ngspice (exact environment, `-n`, digest check, per-run directory and cleanup, bounded raw read,
  tree kill, terminal-after-exit, a global concurrency cap). [B22-A3, 2026-10-01] Done by the diagnostic runner (`diagnostic-runner.md`);
  still open there: the Studio record's cancel-before-exit (job store, B22-C), no OS limit of any kind (no job object, OD-145), a link at
  the runner root or a raw file that is a link (B22-D item 4). [B22-A3 review, 2026-10-01] The smoke test now passes its request's
  abort to the runner; Node's eight win32 additions to the child's environment are recorded, not removed (OD-156).
- **B22-B**: [B22-B review, 2026-10-02] done for the named computations - the closed catalog of five kinds, the three reads in the bounded engine host (a worker thread stopped hard at its budget) and the two process-backed kinds dormant behind a human approval no route offers yet (`named-computations.md`; OD-139, OD-140, OD-159). Still open: the placement preview (F1, T10: the placement engine has no worker entry), no isolation boundary for a worker (a thread of the server process: its file system, network, CPU and external memory are the server's), no OS limit, and the opt-in (OD-158).
- **B22-C**: the body-trusted CD-10 routes (D22-6), the dropped completed result (D22-7), the parsers (D22-10), evidence identity and
  wording (D22-12..14, D22-21). [B22-C, 2026-10-02] Done (`simulation-authority.md`): execute and readiness read only the server's
  provider and runtime profile (a body copy is refused 409 with a closed code; T11), the job store attaches the result before the
  terminal status and both parsers refuse a bad output whole (T12), the evidence aggregate `computation.evidence.v1` is digest-bound
  and silent, the report and studio carry the diagnostic disclosure, and SPICE AI evidence is labelled caller-supplied. Production
  authority stays BLOCKED; the Studio record's cancel-at-request ordering stays recorded.
- **B22-D**: no adversarial case runs against a real or contained process (D22-20). [B22-D, 2026-10-02] The matrix (`adversarial-matrix.md`): every runbook class prevented offline at the fake seams (`b22-d-adversarial`, with the cases B22-A1..C pinned), a live case on the diagnostic runner written for the lead (`b22-d-adversarial-live`, opt-in, not run by B22-D), the OCI column BLOCKED-LIVE-QUALIFICATION under LB-10. Still open: no OS limit (OD-145), no OS network denial, a link a process of the server user plants, FreeRouting's and kicad-cli's direct-child kills.
- kicad-cli and FreeRouting keep their host allowlists (with HOME and USERPROFILE) and direct-child kills until a runner executes
  their profiles; their contract environments' adequacy is **UNKNOWN** (never run).
