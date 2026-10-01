# B22 - discovery: sandboxed engineering computation and simulation

Labels: **CONFIRMED** (read at the cited file:line, or observed with an allowed read-only command), **INFERRED** (a conclusion
from reading code; nothing was executed), **PROPOSED** (designed, not exercised), **RECORDED** (written down from a document or a
reader's observation without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. "(reader)" marks a fact taken from a
reader's map and not re-read by the synthesizer; every defect-bearing fact below was re-read in the code by the synthesizer.

Method: seven parallel read-only readers over the tree at `b11ef18`: (1) the existing simulation code and the blocked runner, (2) every
process-execution surface, (3) the tool registry and how a named computation would be exposed, (4) results as evidence, the import
path and long-running jobs, (5) the host and deployment platform, (6) prior records, obligations and tests, (7) external references.
They produced 70 gap candidates (S1-G1..14, S2-G1..14, S3-G1..6, S4-G1..12, S5-G1..9, S6-G1..9, S7-G1..6), every claim with a
file:line or a URL. One synthesizer re-read every defect-bearing fact, resolved the disagreements (section 0) and merged the gaps
into D22-1..24 (section 4); the lead's spot-check is section 9, empty until then. The synthesizer executed nothing (no vitest, eslint,
tsc, tsx, node, script, simulator or container), wrote no repository file, fetched no page and probed nothing beyond a Glob of the
ngspice install folder. Readers 5 and 7 ran read-only host probes on 2026-09-30 (`docker version`, `docker info`, `where ngspice`,
`wsl -l -v`); reader 7 fetched the external pages (section 1.2). Those observations are labelled as the readers'.

Tree: branch `chapter/b21-specialist-orchestration`, HEAD `b11ef18` ("B21 closeout (2/2): the four validation artifacts, the final
validation run, the verdict (PARTIAL)"), working tree clean (`git status --short` empty). `main` is `6fd5a7b` (the PR #10 merge);
`main..HEAD` is 23 commits and 164 files. PR #11 had not merged when this was read. `PROGRAM_STATE.json` records `baseSha` 6fd5a7b
(`artifacts/remaining-builder-program/PROGRAM_STATE.json:7`), so main has not moved since the branch was cut and a normal merge of
PR #11 yields this tree: every citation below holds on main after that merge (INFERRED). No `artifacts/ai-control-plane-b22/`
directory exists (`ls artifacts`). Prepared 2026-09-30.

[B22 lead, 2026-10-01] Committed on `chapter/b22-sandboxed-computation` from main `d0d2ec8`, after PR #11 (B21, `e109d76`) and PR #12 (SEC-1, the corrective security
branch `fix/spice-deck-injection`, merge `d0d2ec8`) merged. Two statements above no longer hold: `artifacts/ai-control-plane-b22/`
exists (SEC-1 created `sec-1-spice-deck-injection.md` there), and PR #11 has merged. SEC-1 changed `app/lib/spice/netlist.ts`,
`server/worker.ts`, `server/job-store.ts`, `app/api/spice/models/smoke-test/route.ts` and the CI workflow. Every citation below is
as read at `b11ef18` unless marked; section 9 re-verifies all of them on the SEC-1 tree `1ff9d81` (main's content after PR #12 for
every file cited here) and lists every citation SEC-1 moved or changed (section 9.2). Statements the re-verification found false
are corrected in place, marked `[B22 lead, 2026-10-01]`.

## 0. Reader disagreements and UNKNOWNs resolved by reading the code

- **Docker on this host.** Reader 1 inferred from LB-6 that the engine fails; readers 5 and 7 probed it; reader 6 left it UNKNOWN.
  Resolution: the Docker CLI 29.3.1 (windows/amd64, context `desktop-linux`) is installed, and on 2026-09-30 both `docker version`
  and `docker info` failed to reach `npipe:////./pipe/dockerDesktopLinuxEngine` ("The system cannot find the file specified"), exit 1
  (RECORDED, readers 5 and 7). `wsl -l -v` lists `docker-desktop`, `kali-linux` and `Ubuntu`, all WSL 2 and Stopped (RECORDED,
  reader 7). LB-6 records that the Docker Desktop 4.67 engine fails at start, but its subject is a local container PostgreSQL, not
  simulation (`artifacts/remaining-builder-program/LIVE_BLOCKERS.md:12`, CONFIRMED). Whether the engine can start today was not tried
  (starting it was outside every reader's allowed commands): **UNKNOWN**. No container engine was reachable when probed.
- **The installed ngspice.** Reader 1 said "ngspice-46 installed" (CONFIRMED); reader 5 said "probably 46, by folder name" (INFERRED).
  Resolution: `C:\Users\robsa\Tools\ngspice-46\Spice64\bin\ngspice.exe` and `ngspice_con.exe` exist (Glob, CONFIRMED) and resolve first
  on PATH (`where ngspice`, reader 5). The version is known only from the folder name and the bundled `ngspice-46-manual.pdf`: the
  binary was never run (INFERRED 46). The current upstream release is 47 (section 1.2). [B22 lead, 2026-10-01: superseded in part - the lead ran this
  ngspice-46 as `ngspice_con -b` for SEC-1's benign probes (SEC-1 page section 1b; "Compiled with KLU Direct Linear Solver");
  its path, provenance and hash are still unrecorded, so its identity still needs B22-A2's install-tree hash.]
- **"Nothing calls the subprocess authoritative"** (reader 1) versus "B16.0.24 says authoritative execution stays available"
  (readers 5, 6, 7). Both are partly right. The code never labels `/api/simulate` authoritative: its header says a process exit is "an
  EXECUTED simulation result only" (`app/api/simulate/route.ts:22-24`). But the same header calls the runner "a confined ngspice
  sandbox" with "no network" (`:3-4, :14`), the B16.0.24 proof repeats both (`artifacts/ai-control-plane-b16-0-24/simulate-process-security-proof.md:4-5, :29-30`),
  and the B16.0.24 decision record says "authoritative execution stays available"
  (`artifacts/ai-control-plane-b16-0-24/unknowns-and-owner-decisions.md:24-27`). CONFIRMED; it is D22-14.
- **The worker's `-v` probe and the environment.** Reader 1 CONFIRMED, reader 2 INFERRED. Resolution: `spawn(NGSPICE_EXECUTABLE, ["-v"],
  { windowsHide: true, stdio })` passes no `env` (`app/lib/spice/server/worker.ts:60`, CONFIRMED); Node's `options.env` defaults to
  `process.env` (reader 7, nodejs.org, RECORDED), so the probe inherits the full server environment (INFERRED from the documented default). [B22 lead, 2026-10-01: superseded - SEC-1 made the
  probe pass `env: safeEnvironment()` (`worker.ts:60`); D22-5.]
- **How far the SPICE Studio deck injection reaches.** Reader 1 named custom directives; reader 2 added source values, output
  expressions, `.ic` values and the model-content differential; reader 7 said it had not traced whether any persistence path admits a
  multi-line directive. Resolution: no persistence path is needed, because `POST /api/spice/runs` takes the whole `SimulationProject`
  from the request body (`app/api/spice/runs/route.ts:18-30`) and nothing between the body and `writeFile` screens a line break
  (`app/lib/spice/server/worker.ts:162-176`). The synthesizer found two further vectors: `.options` custom options, whose screen
  `^[A-Za-z0-9_.=+\-\s]+$` admits a newline through `\s` (`app/lib/spice/netlist.ts:196-199`), and model-authored strings from the
  SPICE AI route, whose overlay and variable operations are pre-approved ("automatic") together with the run request
  (`app/api/spice/ai/route.ts:68-72, :103-116, :227-228`; `app/components/spice/SpiceStudio.tsx:461, :467-475`). Not executed: INFERRED (D22-3). [B22 lead, 2026-10-01: this describes the tree before SEC-1, which closed it
  - D22-3.]
- **Severity of the body-trusted provider and environment.** Reader 1 high INFERRED, reader 2 medium CONFIRMED, reader 4 high
  CONFIRMED. Resolution: the code reading is CONFIRMED (`app/api/model-simulation/execute/route.ts:10` casts `body.provider`,
  `body.environment`, `body.manifest`; `app/api/model-simulation/readiness/route.ts:6` does the same); the consequence is latent while
  the 501 stands (INFERRED). Rated high because B22-C cannot wire any runner behind it (D22-6).
- **Completed SPICE runs and their results** (reader 4 only, INFERRED). Re-read in sequence: the worker emits
  `onEvent({ status: "completed" })` before it returns its result (`app/lib/spice/server/worker.ts:226-246`); `addEvent` writes that
  status into the record (`app/lib/spice/server/job-store.ts:85-94`, `:89`); `executeQueuedRun` then returns early because the record is
  terminal, before `Object.assign(job.record, result)` (`:145-146`). The guard came in `4e99e3e` (B16.0.23, 2026-08-28) over worker code
  from `2bd1603` (2026-07-15) (`git blame`). The default-suite fake never emits `completed` through `onEvent`
  (`app/api/__tests__/b16-0-23-tranche-parity.test.ts:26-33`); the one test that would fail is opt-in
  (`app/lib/spice/__tests__/worker-integration.test.ts:14, :21, :62-64`). INFERRED, strongly (D22-7). [B22 lead, 2026-10-01: on the SEC-1 tree the
  job-store positions are `:88-97`, `:92` and `:148-149`; the behaviour is unchanged (section 9.2).]
- **Next free numbers.** The highest OD heading is OD-133; OD-83..86 and OD-88 are reserved (`OWNER_DECISIONS.md:687`); so B22 starts at
  **OD-134**. `LIVE_BLOCKERS.md` holds LB-1..LB-9, so the next row is **LB-10** (CONFIRMED).
- **Which routes reach kicad-cli.** Only `app/api/pcb/export/gerbers/route.ts:34` imports `build-bundle`, the only importer of
  `kicad-cli-runner` (`git grep`, CONFIRMED); `/api/pcb/release` spawns nothing, although its classification row says
  `externalProcess: "kicad-cli (server-authoritative)"` (`app/lib/auth/route-resource-classification.ts:54`) (D22-18).
- **A process-backed tool as a B05 read.** Reader 3's inference holds: `app/lib/engineering/tool-invocation.ts:29-35` statically imports
  `ACTIVATED_READ_BINDINGS` from `tool-bindings-readonly.ts`, and `tool-invocation.ts` is a required member of the MCP routes' closure in
  `b20-b4-process-gate` case 2 (`app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts:218-226`). A spawner bound as a read binding
  would enter that closure and fail the case (INFERRED). The working precedent injects the executor at the chat composition root
  (`app/api/chat/route.ts:412-421`).

---

## 1. Scope and references

### 1.1 Chapter scope (`C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md:882-942`)

- **Mission** (`:884-886`): "Provide named, bounded engineering computation capabilities without exposing a general developer shell or
  allowing code/process execution to bypass project authority. Safely address the currently blocked authoritative simulation runner."
- **B22-A** (`:888-906`): immutable runtime profiles "for ngspice and any later approved engineering executable" (`:890`), each binding an
  executable/container image digest; version and provenance; supported input/output formats; allowed arguments; read-only input mount;
  isolated writable temporary output; network disabled by default; no inherited application secrets; CPU, memory, process, file, output
  and wall-clock limits; locale/timezone/randomness controls; cancellation/kill semantics; expected output parser and independent
  validator; platform qualification evidence (`:892-904`). `:906` verbatim: "Prefer an OCI/container boundary for authoritative
  production execution. If the host cannot supply it, keep production authority blocked and deliver a diagnostic-only local runner plus
  complete contract tests. Do not call a weak subprocess sandbox authoritative."
- **B22-B** (`:908-920`): expose operations such as run a pinned SPICE analysis; evaluate an approved equation/model; parse a bounded
  approved file; run a pinned placement/routing experiment; compare deterministic artifacts (`:912-916`). `:918`: "Do not expose
  `shell`, `exec`, arbitrary Python/JavaScript, arbitrary package installation, unrestricted filesystem or arbitrary URLs to the product
  agent." `:920`: model-generated scripts, if allowed experimentally, stay inert until human review, run only in a zero-secret,
  zero-network disposable environment, and enter Sirkit only "through typed validators and canonical import commands".
- **B22-C** (`:922-934`): unblock model-simulation execution only when exact simulator and model libraries are pinned; lowering is
  deterministic and independently validated; input project/model digests are current; supported analyses and convergence policies are
  explicit; output units and numerical tolerances are validated; cancellation and timeout produce no fabricated results; runs are
  reproducible or honestly marked numerically/environment dependent; results are evidence, not automatic schematic/PCB authority;
  safety-critical claims stay out of scope without qualified validation.
- **B22-D** (`:936-938`): fork bombs, child processes, filesystem escape, symlink/hardlink tricks, device paths, huge output, infinite
  simulation, malformed binary output, NaN/Inf, locale drift, network attempts, environment-variable exfiltration, signal races, orphan
  processes, archive traversal and parser differentials (16 items).
- **Pass** (`:940-942`): "Approved named computations execute within a measurable isolation boundary and import only validated
  artifacts. If production isolation cannot be proven, the production runner remains blocked and the verdict must say so."
- **Global rules** that bind B22 most directly: `:138` (browser- or model-authored state is never canonical for its shape or digest),
  `:144` (never tell a human a simulation is verified beyond the evidence), `:147` (never invent a pass), `:148` (no generic execute
  path), `:152-153` (secrets stay server-side), `:154` (prompt injection from imported project text), `:155` (path traversal, archive
  confusion, unbounded streams), `:157` "No generic model-facing shell, SQL, migration, filesystem-write or process-spawn tool.", `:158`
  (bounded readers, cancellation, one terminal event).
- **Program-wide**: chapter list `:24`; B24-A environments with "feature flags for MCP, sandbox and external manufacturing" (`:1042`);
  B24-B evaluates "sandbox escape attempts" (`:1066`); B24 reliability covers "process/sandbox cleanup" (`:1104`); B24-E item 4 "Run real
  sandboxed simulator/router jobs on the qualified platform." (`:1118`); scenario 18 "Execute an approved sandboxed simulation without
  network/secrets/filesystem escape." (`:1184`); acceptance "sandbox execution is proven isolated or remains honestly blocked;"
  (`:1204`); report line `SANDBOX STATUS:` (`:1247`).

### 1.2 External references (reader 7, WebFetch and WebSearch, read 2026-09-30; every item **RECORDED**)

- **ngspice releases** (`https://ngspice.sourceforge.io/news.html`, `/download.html`, `/docs.html`): ngspice-47 announced 2026-08-11 (46 on
  2026-03-29, 45 on 2025-09-01, 44 on 2024-12-29); the download page offers source tar.gz, a Win64 7z and nightly 47plus builds and
  states no checksum, signature or container image. A profile must therefore record its own provenance (tarball URL plus hash, or an
  exact distro package version).
- **ngspice licence** (`https://ngspice.sourceforge.io/faq.html`; Debian copyright file
  `https://metadata.ftp-master.debian.org/changelogs/main/n/ngspice/unstable_copyright`; Alpine
  `https://pkgs.alpinelinux.org/packages?name=ngspice&branch=edge`): modified BSD overall; per Debian, LGPL-2 for `src/maths/KLU`,
  `src/frontend/numparam` and tclspice, GPL-2+ for some XSPICE and build files, CC-BY-SA-4.0 for parts of the docs.
- **Distro packages** (`https://packages.debian.org/search?keywords=ngspice&searchon=names&exact=1&suite=all&section=all`): trixie
  44.2+ds-1; trixie-backports 47+ds-1~bpo13+1; forky and sid 47+ds-1; bookworm 39.3+ds-1, bookworm-backports 46+ds-1~bpo12+1; Alpine
  edge 47-r0 (built 2026-09-05). `https://snapshot.debian.org/` serves the archive at a fixed timestamp (pinned installs).
- **Images** (`https://hub.docker.com/v2/search/repositories/?query=ngspice&page_size=25`): no official ngspice image; 24 community
  repositories, none official; official base images such as `library/debian:trixie-slim` are pinnable by digest
  (`https://hub.docker.com/v2/repositories/library/debian/tags/trixie-slim`; digests came through a summarising fetch and must be
  re-resolved before use). Pull-by-digest is immutable and never picks up security updates
  (`https://docs.docker.com/reference/cli/docker/image/pull/`).
- **ngspice batch interface** (`https://man.archlinux.org/man/extra/ngspice/ngspice.1.en`, package 47-1, page dated 2014-10-28): `-b`
  batch, `-s` server (rawfile to stdout), `-r` rawfile, `-o` log file, `-n` skip `.spiceinit`; `SPICE_ASCIIRAWFILE`; startup reads
  `spinit` then `.spiceinit` or `$HOME/.spiceinit`. An unofficial manual mirror (`https://nmg.gitlab.io/ngspice-manual/`) marks `-n`
  obsolete: whether `-n` is honoured in 46/47 is **UNKNOWN**.
- **ngspice deck features that execute or read** (mirror pages `.../commands/shell_callthecommandinterpreter.html`,
  `.../commands/source_readangspiceinputfile.html`, `.../circuitdescription/include.html`): `shell` calls the OS command interpreter;
  `source` reads a file; lines starting `*#` run as control commands; `.include` takes any filename the OS allows. `spinit` is found
  relative to the executable or through `SPICE_SCRIPTS`, loads XSPICE code-model libraries and sets `num_threads=4`
  (`.../startingngspice/standardconfigurationfilespinit.html`). [B22 lead, 2026-10-01: the manual's value; the installed
  `C:/Users/robsa/Tools/ngspice-46/Spice64/share/ngspice/scripts/spinit:14` sets `num_threads=8` and leaves `rndseed` commented out at
  `:5`; that `ngspice_con` loads this spinit is INFERRED (section 9.5 item 11).] `strict_errorhandling` exits 1 on a parse error and reportedly can be
  set only in `spinit`/`.spiceinit` (INFERRED from a search summary). Convergence options and defaults (ABSTOL, RELTOL, VNTOL, GMIN,
  ITL1..ITL5, METHOD, MAXORD, GMINSTEPS, SEED) are listed on `.../simulatorvariables__options/*` pages.
- **Not documented in what was read**: how rawfiles encode NaN/Inf; batch exit codes after "timestep too small" or "singular matrix";
  the default random seed (third-party issues say it is not reproducible and differs between versions); standalone versus
  shared-library locale (a KiCad forum thread). All **UNKNOWN** until measured inside a pinned profile.
- **Docker run controls** (`https://docs.docker.com/reference/cli/docker/container/run/`, `/engine/network/drivers/none/`,
  `/engine/containers/resource_constraints/`, `/engine/storage/tmpfs/`, `/engine/security/seccomp/`, `/engine/security/`,
  `/engine/security/rootless/`, `/engine/security/userns-remap/`, `/reference/cli/docker/container/kill/`, `/stop/`): `--network none`
  (loopback only), `--read-only`, `--tmpfs` (Linux only; default size 50 % of host RAM; counts against the memory limit; `noexec`,
  `nosuid`, `nodev`), `--pids-limit`, `--memory`, `--cpus`, `--ulimit`, `--security-opt no-new-privileges`, seccomp (default profile is
  an allowlist), `--cap-drop`, `--user`, `--init`, `--rm`; rootless limits need cgroup v2 plus systemd; `docker kill` sends SIGKILL to the
  main process and killing the CLI client does not stop the container. No flag caps output size: output and wall-clock bounds stay in
  the caller.
- **Docker Desktop on Windows** (`https://docs.docker.com/desktop/features/wsl/`, `/desktop/settings-and-maintenance/settings/`,
  `/desktop/setup/install/windows-permission-requirements/`, `/enterprise/security/hardened-desktop/enhanced-container-isolation/` and
  its `limitations/`, `enable-eci/`): the WSL 2 backend runs the daemon in its own distro, limits come from `.wslconfig`, Enhanced
  Container Isolation needs a Docker Business subscription and WSL 2.6+, and Docker's own page says WSL users can get root in the VM and
  recommends the Hyper-V backend for maximum security. Current releases: Engine 29.8.2 (2026-09-30), Desktop 4.93.0 (2026-09-28)
  (`https://docs.docker.com/engine/release-notes/`, `/desktop/release-notes/`). WSL config defaults:
  `https://learn.microsoft.com/en-us/windows/wsl/wsl-config` (updated 2026-09-16).
- **Stronger runtimes**: gVisor `runsc` (`https://gvisor.dev/docs/`, `/docs/user_guide/install/`, `/docs/architecture_guide/platforms/`,
  `/docs/user_guide/compatibility/`; release 20260928.0 at `https://github.com/google/gvisor/releases`) needs Linux 5.6+, does not
  document Windows/WSL/Docker Desktop, and does not enforce resource limits inside the sandbox. Kata Containers
  (`https://katacontainers.io/`; 4.2.0 on 2026-09-15 at `https://github.com/kata-containers/kata-containers/releases`) needs KVM
  (requirements from a search summary, INFERRED).
- **Node child processes** (`https://nodejs.org/api/child_process.html`, `https://nodejs.org/api/process.html`, docs v26.10.0): on
  Windows every known signal terminates forcefully; killing a child does not kill its children; `options.env` defaults to `process.env`;
  `timeout`, `killSignal` and `maxBuffer` exist. libuv (`https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/process.c`) places
  children in a job object with `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK` and kills with `TerminateProcess`, so grandchildren can outlive
  both `kill()` and the parent (INFERRED). Windows job objects (`https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects`,
  `.../api/winnt/ns-winnt-jobobject_basic_limit_information`) give tree termination, process-count, memory and CPU-time limits but no
  file or network isolation; `taskkill /T /F`
  (`https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill`) ends a tree.
- **Unreadable on 2026-09-30**: `ngspice.sourceforge.io/` (HTTP 522), the official v47 XHTML manual (522, three tries), the v47 PDF
  (downloaded, not parseable), SourceForge file listings and COPYING (522), Kata `docs/Requirements.md` (404), Alpine's all-branch query
  (404). Node `worker_threads` was not read by any reader (needed for OD-140; section 8 item 7).

### 1.3 Repository state

- **Two simulation stacks.** (A) The legacy ngspice paths are live and spawn ngspice from PATH: the page quick-sim `POST /api/simulate`
  (`app/page.tsx:5891`), the SPICE Studio job store and worker behind `/api/spice/runs*` (`app/lib/spice/server/job-store.ts`,
  `worker.ts`) and `POST /api/spice/models/smoke-test`. (B) The CD-10 model-simulation stack (`app/lib/model-simulation/*`,
  `/api/model-simulation/*`, `/model-simulation`) has typed authority contracts and no execution path (section 2.1). CONFIRMED
- **Five process spawners** under `app/`, pinned as an exact list: `app/api/simulate/route.ts`, `app/api/spice/models/smoke-test/route.ts`,
  `app/lib/pcb/autoroute/runner.ts`, `app/lib/pcb/fab/kicad-cli-runner.ts`, `app/lib/spice/server/worker.ts`
  (`app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts:38-44, :210-213`). CONFIRMED
- **No container or OS isolation anywhere**: `git ls-files` lists no Dockerfile, compose file, `.dockerignore`, devcontainer,
  `vercel.json`, `fly.toml` or Procfile; `git grep` over `.github` finds no ngspice, docker, runsc or podman. CONFIRMED. No `@sha256:`
  image reference, no `output: "standalone"`, no `engines` field (reader 5).
- **Reviewed sets**: registry 42, agent-exposed 33, MCP-exposed 9, agent-only 24
  (`app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241`; `app/lib/engineering/agent-exposure.ts:30-64`); route census
  165 = 162 canonical + 3 factories + 0 raw (`app/api/__tests__/b16-1c-invariant-tripwires.test.ts:38, :48`); CI chapters
  `["b19-", "b20-", "b21-"]` (`app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54`). CONFIRMED
- **Host** (readers 5 and 7, 2026-09-30, RECORDED): Windows 11, Docker CLI 29.3.1 with no reachable engine, WSL 2 distros stopped,
  ngspice under `C:\Users\robsa\Tools\ngspice-46\Spice64\bin` (with `libomp140.x86_64.dll`), no `runsc` or `podman` on PATH, `.wslconfig`
  with `memory=5GB`, `swap=4GB` and `autoMemoryReclaim=gradual` under `[wsl2]` (Microsoft documents that key under `[experimental]`).
  OD-87 records the machine as an Intel Core Ultra 5 125U, 15 GiB, Node v24.15.0 (`OWNER_DECISIONS.md:670-671`, reader 5).
- **Production host**: not declared anywhere in the repository; B24-A establishes environments (`runbook :1027-1042`). **UNKNOWN**.
- **Program state**: the next action is B22 discovery on a new chapter branch from main after PR #11 merges
  (`PROGRAM_STATE.json:18`); OD-83..86 and OD-88 are reserved for "the B22-B proposal reversal"
  (`artifacts/ai-control-plane-b21/README.md:42-43`, reader 6; `OWNER_DECISIONS.md:687`). CONFIRMED

---

## 2. What exists (per surface)

### 2.1 The blocked authoritative runner and the CD-10 contracts

- **The runner is a throwing stub.** `/** CD-10 deliberately does not spawn a process until an OS/container sandbox implementation is
  independently validated. */ export async function executeAuthoritativeSimulation(): Promise<never> { throw new
  Error("CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX"); }` (`app/lib/model-simulation/safe-execution.ts:20-21`). No caller
  outside the model-simulation module (reader 1, `git grep`). CONFIRMED
- **The execute route.** Any non-human actor gets 403 "AI cannot execute simulation campaigns"; missing inputs 400; an authorization
  that is not `authoritative` gets 409 "authoritative execution denied"; an authoritative one gets 501 "CD-10 authoritative runner is
  blocked until the sandbox image/executable and environment corpus are independently validated"
  (`app/api/model-simulation/execute/route.ts:10`). Pinned by `app/lib/auth/__tests__/b16-0-20-simulation-confinement-gate.test.ts:37, :90-96`,
  `app/api/__tests__/b16-0-20-tranche-parity.test.ts:169-186` and `app/api/model-simulation/__tests__/route.test.ts:46`. CONFIRMED
- **Where and why it was recorded BLOCKED.** B16.0.20 section D: "Authoritative runner remains BLOCKED (CONFIRMED)"; "the runner was
  NOT implemented in this stage (mandate)" (`artifacts/ai-control-plane-b16-0-20/authoritative-runner-blocked.md:1, :18`); "The sandbox
  image/executable + environment corpus for the authoritative runner remain UNVALIDATED - the 501 block stands until that independent
  validation happens (explicitly out of scope)." (`artifacts/ai-control-plane-b16-0-20/unknowns-and-owner-decisions.md:26-28`). The CD-10
  stage report adds the missing pieces: no validated simulator sandbox, image or executable; no production model or testbench registry;
  no licensed golden or cross-provider corpus; primary blocker `BLOCKED BY CD-9`
  (`docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:13, :71, :115`, reader 6). B16.0.23 kept it: "Authoritative
  run execution is NOT expanded, enabled, or re-implemented" (`artifacts/ai-control-plane-b16-0-23/simulator-execution-boundary.md:43-45`,
  reader 1). No OD or LB row names the runner; the ledgers mention B22 only as the host of a bounded engine (OD-82 `:668`, OD-87 `:684`)
  and a container profile for routing (LB-3, `LIVE_BLOCKERS.md:9`). CONFIRMED
- **Authorization contract.** `authorizeSimulationExecution` adds `CD10_EXECUTION_PROVIDER_PIN_MISMATCH`, `_NETWORK_NOT_DENIED`,
  `_BINARY_DIGEST_MISSING`, `_RESOURCE_LIMIT_INVALID` (including `memoryMiB < 1`), `_INCLUDE_NOT_SANDBOXED` (`..`, drive or root paths)
  and `_LOWERING_AUDIT_FAILED`; it returns `authoritative` only when `providerAuthoritative` holds and no code was added, and
  `diagnostic_only` for a diagnostic provider without include or limit codes (`safe-execution.ts:5-17`). `providerAuthoritative` requires
  `authoritativeEligible`, review `validated`, lifecycle `active`, the environment pinned to the provider digest, environment `validated`,
  a non-empty `executableOrImageDigest` and `networkPolicy === "deny"` (`app/lib/model-simulation/provider.ts:19`). CONFIRMED
- **The diagnostic ngspice provider is honest about itself**: `executionBackendKind "local_subprocess_diagnostic"`, limitations
  "Executable is selected from mutable environment/PATH.", "No OS sandbox or authoritative executable digest is established.",
  "Existing netlist path is coordinate-derived and is not CD-10 authority.", `reviewState "diagnostic_only"`, `authoritativeEligible:
  false` (`provider.ts:6`). Its environment: no `executableOrImageDigest`, `localeAndTimeZone "uncontrolled-local"`,
  `floatingPointAndThreadSettings ["uncontrolled"]`, `memoryMiB: 0`, `networkPolicy "allowlisted"`, `sandboxPolicyRevisionId
  "legacy-local-process-no-os-sandbox"`, `validationState "diagnostic_only"` (`provider.ts:14-17`). Only the analytical reference
  provider can become authoritative, and only with a human reviewer or project admin (`provider.ts:9-11`). CONFIRMED
- **Profile type skeleton.** `SimulatorProviderDefinition` (`app/lib/model-simulation/types.ts:32-52`; `executionBackendKind:
  "local_subprocess_diagnostic" | "sandboxed_process" | "container" | "analytical_in_process"` at `:43`) and `SimulationExecutionEnvironment`
  (`:54-69`: executable or image digest, simulator version, OS/arch, dependency versions, locale/timezone, FP/thread settings, env
  allowlist, `resourceLimits { timeoutMs, memoryMiB, outputBytes, processCount, waveformPoints }`, `networkPolicy "deny" | "allowlisted"`,
  sandbox policy id, validation state). No field for allowed arguments, I/O formats, mounts, CPU or file limits, seed, kill semantics,
  parser/validator binding or qualification evidence. No live runner imports these types (`worker.ts:1-21`; `app/api/simulate/route.ts:26-32`). CONFIRMED
- **Deterministic lowering and its audit**: `lowerNetlistIr` emits sandbox-relative `.include "models/..."` lines and supports only
  `.op`/`.tran`/`.ac`/`.dc` (other analyses throw `CD10_LOWERING_ANALYSIS_REQUIRES_SPECIALIZED_ADAPTER`); `auditNetlistLowering` re-checks
  the manifest's digests and cardinalities against the IR from the same module (`app/lib/model-simulation/lowering.ts:8-27`, lines
  `:14-15, :21-22` re-read); the IR comes from the CD-8 semantic graph (`ir.ts:6-37`, reader 1). Nothing re-parses the emitted deck
  independently. CONFIRMED
- **Typed results**: `ProcessState` separates exit, timeout, cancel, resource kill and malformed output (`types.ts:15`); convergence
  classification and a bounded retry ladder whose step 3 is `diagnostic_only` (`convergence.ts:15-31`, reader 1);
  `createWaveformArtifact` marks an artifact `invalid` unless every axis and signal value is finite and the axis strictly increases
  (`waveform.ts:4-9`, re-read); display-derived waveforms are not authoritative for measurement (`waveform.ts:13-21`, reader 1);
  assertions carry `indeterminate_numeric` bands (`assertion.ts:4-10`). CONFIRMED
- **Corpus and capability**: 102 cases, each `manifest_only`, "golden output ... not yet attached" (`corpus.ts:16-19`, re-read count
  check at `:19`); `unsupportedDomains` includes `high_energy_fault_signoff`, `regulatory_certification`,
  `functional_safety_certification` (`capability.ts:9`). CONFIRMED
- **No client calls the CD-10 routes**: `git grep 'api/model-simulation'` outside tests and the policy/classification/registry rows finds
  only `app/lib/engineering/action-registry.ts:180, :298-303`. The page renders localStorage state and the static text "Validated
  sandbox unavailable" and "Current verdict: BLOCKED" (`app/model-simulation/page.tsx`, grep). CONFIRMED

### 2.2 The live legacy ngspice paths

- **`POST /api/simulate`** (read EDITORS, `app/lib/auth/route-policy.ts:295`): authenticated wrapper with `exposeAbortSignal`; executable
  `NGSPICE_BIN` or `ngspice_con`/`ngspice` from PATH (`app/api/simulate/route.ts:46`); env allowlist `PATH, Path, PATHEXT, SystemRoot,
  WINDIR, TEMP, TMP, HOME, USERPROFILE, LD_LIBRARY_PATH` plus `NODE_ENV` (`:50-55`); input screen refusing control characters and backticks
  in component values, references, ids, net labels and analysis fields (`:69-83`); output screen requiring exactly one `.control`/`.endc`
  and refusing `.include/.inc/.lib`, `.shell/.cd/.source/.quit/.exec/.system/.destroy/.remcirc`, `shell` lines, `!` escapes and backtick
  substitution (`:92-106`); a chunked bounded raw read with fatal UTF-8 (`:222-254`); fixed argv `["-b", path]`, `shell: false`,
  `windowsHide`, per-request cwd, 10 s timeout, 1 MB log tails, abort to `child.kill()` (`:260-277`, spawn `:264`). Its deck comes from
  schematic coordinates through a union-find over pin positions and hard-codes `.model D1N4148 D(IS=2.52e-9 N=1.752)`
  (`app/lib/netlist.ts:84-127, :208`, reader 1). The page discards stale-base results and states "Server results remain advisory -
  nothing here mutates schematic state" (`app/page.tsx:5873-5876`). CONFIRMED
- **The SPICE Studio job store** (`POST /api/spice/runs` WRITE_EDITORS, `route-policy.ts:287`): an in-process `globalThis` map of jobs,
  batches and listeners (`job-store.ts:45-58`), every accessor bound to the server-derived `{tenantId, projectId, branchId}` with no oracle
  (`:62-77, :241-293`), plans capped at 500 runs (`:176-178`), per-batch concurrency `min(8, plan.concurrency)` with no cross-batch cap
  (`:219`), cancel aborting and marking the record terminal immediately (`:110-119`), and the terminal guard on both settle paths
  (`:145, :149`). The project, run plan and parts come from the request body (`app/api/spice/runs/route.ts:18-30`). CONFIRMED
- **The worker**: executable `NGSPICE_BIN` or PATH (`worker.ts:55`); a cached `-v` probe with no `env` option (`:57-79`, spawn `:60`); the
  same env allowlist (`:81-86`); `spawn(NGSPICE_EXECUTABLE, ["-b", netlistPath], { cwd, env: safeEnvironment(), windowsHide, stdio })`
  (`:96-101`); 120 s timeout, 100 MiB combined logs, 5 M waveform points (`:29-33`); abort, timeout and log overflow all call
  `child.kill()` with the default signal (`:112-115, :126-134`); artifacts under `tmpdir()/sirkit-spice/<id>` (`:156-158`), never removed
  (the module imports only `mkdir`, `readFile`, `writeFile`, `:2`); the absolute directory returned as `artifactId` (`:193, :196, :200,
  :217, :245`); `result.raw` read whole (`:205`) before its size check (`:220`); the deck written after only `assertModelSafeForExecution`
  and the readiness audit (`:162-176`); `onEvent({ status: "completed" })` emitted before the result returns (`:226`). CONFIRMED
- **The Studio deck compiler** (`app/lib/spice/netlist.ts`): the writer splits every pushed string on `\r?\n` into separate deck lines
  (`:33`); model text is `transformedContent?.trim() || originalContent.trim()` (`:48-50`) while the screen reads `transformedContent ??
  originalContent` (`app/lib/spice/models.ts:196`); a V/I value starting `dc|ac|pulse|pwl|sin|exp|sffm|am|random|external` is emitted
  verbatim (`netlist.ts:97-100`); `toSpiceValue` returns unparseable input unchanged apart from `M` to `Meg` (`app/lib/spice/units.ts:137-145`);
  the readiness audit skips value parsing for V/I devices and waveform-prefixed values (`app/lib/spice/readiness.ts:180-182`);
  `assertSafeDirective` tests only the start of the whole trimmed text (`^` without the `m` flag) plus a `!`/backtick check, and does not refuse
  `.include`/`.lib` (`netlist.ts:151-158`); custom `.options` pass `^[A-Za-z0-9_.=+\-\s]+$` (`:196-199`); output expressions are emitted
  unescaped in `.save` (`:247`) and in the compiler's own `.control` block `write` line (`:249-258`); advanced directives and `.ic` overlay
  values become custom directives (`app/lib/spice/ir.ts:304-307, :357-360`); the IR clones caller model assets (`ir.ts:375`). The Studio
  IR is coordinate-derived too (`ir.ts:124-150`, reader 1). CONFIRMED
- **The model screen** is a denylist: `.control`, `.shell/.cd/.source/.quit`, `!` escapes, backticks and absolute or UNC `.include/.inc`
  (`models.ts:195-206`, pattern `:203`); it does not refuse `.lib` paths or relative `.include` traversal, and its dependency check reads
  the client-supplied `model.dependencies` (`:207-209`); the import parser matches only `include|inc` (`:49-56`). CONFIRMED
- **The smoke test** (read EDITORS, `route-policy.ts:294`): `spawn(NGSPICE_EXECUTABLE, ["-b", path], { cwd, windowsHide: true, stdio })`
  with no `env` (`app/api/spice/models/smoke-test/route.ts:58`); 10 s timer and `child.kill()` (`:65`); no `exposeAbortSignal` (`:77-78`);
  the caller's model content placed in the deck (`:19, :25, :46`); `stdout` and `stderr` returned to the caller (`:102`). Its gate pins
  executable, argv, `windowsHide` and no shell, not env (`app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts:83-94`). CONFIRMED
- **Raw parsers**: the worker's drops every non-finite token (`app/lib/spice/waveforms.ts:45-55`, drop at `:51`) and only warns when fewer
  points arrive than declared (`:67`); `/api/simulate`'s drops only NaN (`if (!isNaN(n)) tokens.push(n)`, `app/api/simulate/route.ts:157`).
  Both index a stride-ordered token stream, so a dropped token shifts every later value. CONFIRMED (shift: INFERRED)
- **Manifests and identity**: the run manifest records `simulator: { name: "ngspice", version, mode: "subprocess" }` (`app/lib/spice/server/manifest.ts:40`)
  with SHA-256 netlist and model checksums; project, revision and `schematicHash` come from the caller, and `schematicHash` is a 64-bit
  FNV-style hash "for client-side revision tracking" (`app/lib/spice/identity.ts:29-42`). CONFIRMED
- **Persistence**: results live only in the job store and the browser (`saveStudioRuns` keeps 12 runs and truncates waveforms after the
  first 3, `app/lib/spice/persistence.ts:62-72`), yet the classification calls the runs `durable: "read-write", sensitivity:
  "project-durable"` (`app/lib/auth/route-resource-classification.ts:57-61`) and the action registry "durable run records"
  (`app/lib/engineering/action-registry.ts:156`). CONFIRMED
- **AI and simulation**: the SPICE AI route is proposal-only; `run_simulation` records `{ op: "request-run" }` with approval
  `"automatic"` and the note "Execution begins only after the user applies this proposal." (`app/api/spice/ai/route.ts:227-228`);
  overlay and variable operations are also `"automatic"` (`:68-72, :201-206`); the studio pre-selects every automatic operation and Apply
  starts the requested runs (`SpiceStudio.tsx:461, :467-475`); `read_results`, `diagnose_failure` and `compare_runs` build evidence from
  `body.runs` (`route.ts:229-243`). No simulation tool is agent-exposed (`agent-exposure.ts:30-64`; pins at
  `b16-0-20-simulation-confinement-gate.test.ts:102-108`, `b16-0-23-tranche16-confinement-gate.test.ts:138`). CONFIRMED
- **Report wording**: default title `` `${project.name} verification report` `` (`app/lib/spice/report.ts:4`), HTML heading "Qualification
  summary" (`:73`), no diagnostic-only disclosure among the warnings (`:38-41`); the studio header reads "Reproducible qualification"
  (`SpiceStudio.tsx:713`); `/api/spice/reports` is a public renderer over caller-supplied runs whose comment says "never a certification"
  (`app/api/spice/reports/route.ts:7-11`; `route-policy.ts:263`). CONFIRMED

### 2.3 The other executables and the in-process computations

- **FreeRouting** (`app/lib/pcb/autoroute/runner.ts`): env allowlist `SAFE_ENV_KEYS` (`:18-30`), headless offline JVM flags (reader 2,
  `:83-101`), `cwd: tmpdir()` with uuid-named files, SIGKILL on abort and timeout (`:154-172`), unbounded stdout/stderr (`:178-183`), no
  `-Xmx`. Install-time SHA-256 pins for the 2.2.4 JAR and Temurin JRE (`scripts/setup-freerouting.ps1:10-51`, reader 2); at run time the
  resolver checks existence only and env overrides win (`app/lib/pcb/autoroute/runtime.ts:60, :72-77, :93-96`, reader 2). Reached by
  `/api/pcb/autoroute`, `/api/pcb/qualify` (`app/api/pcb/qualify/route.ts:49, :209` through `production-router.ts:14, :61`) and `/api/chat`
  through the agent-exposed `sirkit.routing.propose` (`app/api/chat/route.ts:412-421`; `agent-exposure.ts:50`). CONFIRMED
- **kicad-cli** (`app/lib/pcb/fab/kicad-cli-runner.ts`): `spawn(input.cliPath, input.args, { stdio: "pipe", cwd? })` with no `env`, no
  `windowsHide` (`:50-53`); 60 s SIGKILL (`:55-58`); unbounded stdout/stderr (`:64-69`); no abort parameter (`:9-14`); executable from
  `KICAD_CLI` or PATH (reader 2, `build-bundle.ts:83`). Only `/api/pcb/export/gerbers` reaches it (section 0). CONFIRMED
- **In-process bounded computations**: DRC, connectivity and readiness reads run synchronously in the server process under a
  `Promise.race` timer that rejects but kills nothing (`app/lib/engineering/tool-invocation.ts:512-518`; `run-drc.ts:103`,
  `readiness/evaluate.ts:364`, `connectivity-board.ts:384`, reader 3). The placement engine checks its budget only between candidate
  specs and measured 44-104 s per 250-footprint run (`OWNER_DECISIONS.md:670-681`, OD-87). The anonymous public
  `/api/pcb/placement/preview` ("stateless compute", `route-policy.ts:257`) can block the event loop about 125 s per request
  (`artifacts/ai-control-plane-b20/final-verdict.md:66-67`), unchanged since `041fad9` (B17-E). CONFIRMED (non-preemption: INFERRED)

### 2.4 How a named computation would be exposed

- **Descriptor model**: one `ToolDescriptor` per tool in `SIRKIT_TOOL_CATALOG`, validated at registry construction; closed enums for
  operation class (read, propose, mutate, destructive, release, view-session), side effects (none, derived-cache, proposal-artifact,
  engineering-state, release-artifact, session-state) and binding status (unbound, bound-read, bound-proposal,
  bound-mutation-editor-session, bound-view-session, bound-external-read, test-double) (`app/lib/engineering/tool-registry.ts:41-98,
  :117-167, :187-297`, reader 3). `bound-external-read` (B19-E) is the precedent for a new binding kind with its own gateway branch and
  toolset gate (`agent/gateway.ts:509-624`, `agent/loop.ts:233-258`, reader 3). No computation or runner vocabulary exists. (reader)
- **Exposure ratchets**: the reviewed list with a reason per id (`agent-exposure.ts:30-64`); exposed ids must not match
  `/process|exec|shell|database|db\.|file\.|replace-state|import-state/i` (`app/lib/engineering/__tests__/b17-f-agent-exposure.test.ts:71`),
  `/spice/i` (`b16-0-23-tranche16-confinement-gate.test.ts:138`), `/callback|signin|signout|simulate/i`
  (`b16-0-24-tranche17-confinement-gate.test.ts:154`); exposed descriptors' JSON must not contain `model-simulation`
  (`b16-0-20-simulation-confinement-gate.test.ts:106`); the 33/42/9/24 counts are pinned in many suites (section 5). CONFIRMED
- **MCP**: exposure needs the structural rule and the reviewed list; `routing.propose` is withheld because "an MCP call may not start a
  process (b20-b4-process-gate)" and `placement.propose` because its engine cannot be stopped inside a spec
  (`app/lib/engineering/mcp-exposure-review.ts:34, :36`). CONFIRMED
- **B21 specialists**: per-role rows with a reason per id; long-running reads are not filtered for specialists, only proposals are
  (`app/lib/agent/orchestration/scheduler.ts:700-718`; `role-tools.ts:244-252`, reader 3). (reader)
- **Read pipeline limits**: B05 reads allow only `none` or `derived-cache` side effects and two verification states, and every activated
  binding needs a model-free replay fixture whose output digest matches exactly (`tool-invocation.ts:100, :300-306, :555-580`;
  `b05-read-invocation.test.ts:434-441`, reader 3). An environment-dependent result cannot be expressed there. (reader)

### 2.5 Results, evidence and persistence

- **No server-held simulation evidence**: legacy results in the job store and localStorage (2.2); `/api/simulate` returns results
  inline; CD-10 state lives in a localStorage `SavedProject` (`lib/persistence.ts:172, :246-248`, reader 4) and its routes compute and
  return without persisting (`readiness/route.ts:6`). CONFIRMED
- **Readiness from caller documents**: `evaluateSimulationReadiness` derives `simulation_verified_for_supported_scope`,
  `approve_for_CD11` and `run_authoritative_campaign` from the provider, environment, registries, coverage and applicability the caller
  sends (`app/lib/model-simulation/readiness.ts:11, :20-22`; route `readiness/route.ts:6`). CONFIRMED
- **Digests**: CD-10 `simulationDigest` is four FNV-1a hashes (`app/lib/model-simulation/stable.ts:4`; `app/lib/pcb/smart-routing/hash.ts:1`
  "an identity key, not a security primitive"); a not-evaluated assertion carries `{ lower: NaN, upper: NaN }`
  (`assertion.ts:7`), which `JSON.stringify` turns into `null`; the durable-workflow canonicaliser throws `DW_NON_FINITE_NUMBER`
  (`app/lib/durable-workflow/stable.ts:8`) and digests with SHA-256 (`:16`). CONFIRMED
- **Server-held design state**: the durable canonical state holds the PCB board and no schematic; the only server schematic identity is
  the board-synced `SchematicAuthorityIdentity` (`durable-read-bundle.ts:9`; `schematic-session.ts:402`;
  `pcb/fab/qualification-evidence.ts:67-73`, reader 4; OD-82 `OWNER_DECISIONS.md:659-668`). (reader)
- **Precedents**: the durable-workflow substrate (scoped, CAS, idempotent, SHA-256; `durable-workflow/repository.ts:21-34`,
  `server-repository.ts:20-30`); the B21 orchestration store (silent, refuses unvalidated documents, re-verifies on load;
  `app/lib/agent/orchestration/store.ts:1-27`); the manufacturing authority loader's re-verification (`pcb/fab/authority-store.ts:112-188`);
  the release ledger and qualification lease; the PCB `ReadinessReport` claim shape (`pcb/readiness/types.ts:85-130`); B19 quarantine
  with `proven: false` (`acquisition/quarantine.ts:349-370`). (reader 4)

### 2.6 Host, platform and CI

- **CI** runs only on GitHub-hosted `ubuntu-latest` jobs (benchmark-core, benchmark-nightly, prompt-to-gerber, database-delivery,
  page-browser-e2e), declares no `services:`, runs no Docker and installs no ngspice (`.github/workflows/benchmark.yml:9-15`;
  `deterministic-manufacturing.yml:20-26, :269-271, :313-315`, reader 5; `git grep` CONFIRMED). The SPICE suites in CI are
  `b19-d-deck-injection` and `b19-d-report-escaping` (`deterministic-manufacturing.yml:192, :224`). The only live ngspice suite is opt-in
  (`SPICE_WORKER_LIVE === "1"`, `worker-integration.test.ts:14, :21`) and the ledger lists it among expected skips
  (`EXECUTION_LEDGER.md:1410`, reader 1). No e2e spec touches simulation (reader 1). CONFIRMED
- **A Linux OCI path exists only by inference**: hosted `ubuntu-latest` runners normally ship Docker and passwordless apt (reader 5,
  INFERRED; not shown in the repository). The closest practice is `playwright install --with-deps` (`deterministic-manufacturing.yml:328`).

### 2.7 Prior records, guards and tests that B22 inherits

- **Process gates**: `b20-b4-process-gate` case 1 pins the five importers exactly; case 2 requires the MCP closure to hold
  `tool-invocation.ts` and reach no process or thread module (`b20-b4-process-gate.test.ts:209-227`); `PROCESS_MODULE` covers
  `child_process|worker_threads|cluster|vm|module` (`:36`). `b16-0-20` forbids `child_process`, `spawn(`, `exec(`, `Worker(`, `docker` and
  `container` in the six model-simulation routes (`b16-0-20-simulation-confinement-gate.test.ts:66-72`). The B18-C never-execution sweep
  and the B20-D2 never-reachable partition sweep (reader 6). CONFIRMED
- **Simulation tests** (reader 1, titles via grep): CD-10 `foundation.test.ts:40-59` (including "does not authorize diagnostic environments
  as authoritative", `:59`); `b19-d-deck-injection.test.ts:76-102`; `b16-0-24-tranche-parity.test.ts:297-365`;
  `b16-0-24-1-security-correction.test.ts:76-170`; `b16-0-24-tranche17-confinement-gate.test.ts:118-150`;
  `b16-0-23-tranche-parity.test.ts:249-631` (late completion `:450`); `b16-0-2-spice-scope-isolation.test.ts:72-233`; the spice unit suites;
  the opt-in worker integration. Every route test uses a fake spawn. (reader)
- **Stale titles**: three gates still say "tools EXACTLY 12" while asserting the derived count 33 ([B22 lead, 2026-10-01: seven titles state 12,
  all before SEC-1 - section 9.5 item 10])
  (`b16-0-20-simulation-confinement-gate.test.ts:102`; `b16-0-23-tranche16-confinement-gate.test.ts:134`;
  `b16-0-24-tranche17-confinement-gate.test.ts:151`). CONFIRMED (first re-read; the other two reader 6)
- **The reservation**: "OD-83, 84, 85, 86 and 88 are not recorded: their numbers stay reserved for the reversal's design (`task-B4.md`
  section 8)." (`OWNER_DECISIONS.md:687`); the design file is not in the repository (`git ls-files | grep task-B4` empty; the ledger names
  the lead's scratchpad, `EXECUTION_LEDGER.md:2374, :2381`); the five-item summary survives at
  `artifacts/ai-control-plane-b20/mcp-server-proposals.md:241-254` (reader 6). CONFIRMED

---

## 3. What B22 reuses

| Requirement | Existing mechanism | file:line | Gap |
|---|---|---|---|
| B22-A immutable profile | `SimulationExecutionEnvironment`, `SimulatorProviderDefinition` (incl. `container` backend) | `app/lib/model-simulation/types.ts:32-69` | Missing argv, mounts, CPU/file limits, seed, kill, parser/validator, qualification fields; body-supplied (D22-2, D22-6) |
| B22-A authority gate | `authorizeSimulationExecution`, `providerAuthoritative`, the 501 | `safe-execution.ts:5-21`; `provider.ts:19`; `execute/route.ts:10` | Fed by the request body (D22-6) |
| B22-A diagnostic classification | `diagnosticNgspiceProvider`, `createDiagnosticLocalEnvironment` | `provider.ts:5-17` | No digest; network "allowlisted"; memory 0 (D22-2) |
| B22-A diagnostic runner base | `/api/simulate` runner: fixed argv, `shell:false`, mkdtemp, env allowlist, bounded raw read, cleanup in `finally` | `app/api/simulate/route.ts:46-55, :222-277` | HOME/USERPROFILE passed; direct-child kill only (D22-5, D22-9) |
| B22-A deck screens | `assertSchematicFieldsSafe`, `assertNetlistSafe`; the mocked-spawn injection suite | `route.ts:69-106`; `b19-d-deck-injection.test.ts:1-102` | Not applied to the Studio path or the smoke test (D22-3, D22-4) |
| B22-A kill semantics | FreeRouting SIGKILL on abort/timeout, env allowlist and its test | `app/lib/pcb/autoroute/runner.ts:18-30, :154-172`; `runner-security.test.ts:5-31` (reader) | No tree kill; output unbounded (D22-8, D22-9) |
| B22-A provenance | `setup-freerouting.ps1` SHA-256 + version pins | `scripts/setup-freerouting.ps1:10-51` (reader) | Install-time only |
| B22-A measurable census | `externalProcess` column; the durable connective test pattern | `route-resource-classification.ts:31-67`; `b16-0-3-effective-classification.test.ts:44-84` (reader) | Three wrong rows, no connective test (D22-18) |
| B22-B no generic execution | `b20-b4` AST machinery; b17-f id regex; `NEVER_EXPOSED_TOOL_PATTERNS`; never-execution sweep | `b20-b4-process-gate.test.ts:36-44, :197-227`; `b17-f-agent-exposure.test.ts:71`; `granted-execution-families.ts:74-81` (reader) | None as a pattern; pins move by review (D22-16) |
| B22-B binding and injection | `bound-external-read` precedent; composition-root injection of the FreeRouting executor | `tool-registry.ts:63, :98, :282-292` (reader); `app/api/chat/route.ts:412-421` | No computation binding status (D22-15) |
| B22-B proposal-only request | SPICE AI `request-run` recorded, human Apply starts runs | `app/api/spice/ai/route.ts:227-228`; `SpiceStudio.tsx:467-475` | Pre-approved "automatic" (D22-3) |
| B22-B in-process equation | Analytical reference provider (human-approved) | `provider.ts:9-12` | Needs a bounded host (D22-17) |
| B22-C lowering | `lowerNetlistIr`, `auditNetlistLowering`, the CD-8 IR | `lowering.ts:8-27`; `ir.ts:6-37` (reader) | No independent deck re-parse (D22-19) |
| B22-C output validation | `createWaveformArtifact` (finite, strictly increasing), measurement units, assertion bands, `tool-io-validation` non-finite refusal | `waveform.ts:4-9`; `measurement.ts:7-23` (reader); `tool-io-validation.ts:11-79` (reader) | Unused by the live parsers (D22-10) |
| B22-C no fabricated results | `ProcessState`; the job store terminal guard; `consumed_unsettled` "outcome unknown" | `types.ts:15`; `job-store.ts:140-149`; `execution-grant.ts:349-355` (reader) | Guard drops completed results (D22-7) |
| B22-C evidence record | Durable-workflow substrate; B21 store; authority-store re-verification; release ledger; readiness claim shape | section 2.5 | No simulation aggregate (D22-12) |
| B22-C reproducibility | `ReproducibilityManifest`, 14-digest cache key | `cache.ts:4-7` (reader) | FNV digests, NaN band (D22-13) |
| B22-D harness | Fake `node:child_process` and fs seams; opt-in live gate pattern | `b19-d-deck-injection.test.ts:1-75`; `worker-integration.test.ts:14, :21` | No adversarial case (D22-20) |
| CI admission | Job-scope guard `CHAPTERS`, one directory filter per chapter | `b19-e-ci-job-scope.test.ts:54, :148` | No `b22-` (D22-24) |

---

## 4. Candidate defects and gaps

Severity: high = blocks a B22 requirement outright; medium = a requirement partly served or needing a contract change; low = a
recordable limit or hygiene. "Closes" names the increment in section 7 or an owner decision. Merged from the readers' 70 gap candidates;
each defect keeps its sources.

**D22-1 - No measurable isolation boundary exists, and none can be qualified on this host today.** Requirement: B22-A `:892-904`, `:906`;
pass `:942`. Finding: every engineering executable runs as a plain host child process (`app/api/simulate/route.ts:264`;
`app/lib/spice/server/worker.ts:96-101`; `app/api/spice/models/smoke-test/route.ts:58`; `app/lib/pcb/autoroute/runner.ts:154-163`;
`app/lib/pcb/fab/kicad-cli-runner.ts:50-53`); no spawn sets a memory, CPU, process-count or file-size limit or an OS network denial; the
repository holds no container definition or image reference (`git ls-files`, section 1.3); CI runs no container (2.6); the Docker CLI
reached no engine on 2026-09-30 (section 0, readers 5 and 7) and LB-6 records the engine failing at start (`LIVE_BLOCKERS.md:12`); the
production host is undeclared and B24-A owns environments (`runbook :1027-1042`). The CD-10 runner is therefore correctly blocked
(`safe-execution.ts:20-21`; `execute/route.ts:10`). Severity high. **CONFIRMED** (code and records), **RECORDED** (host probe). Closes:
B22-A2 records the verdict "production runner BLOCKED" (OD-134); not closable on this host without an owner-supplied OCI platform
(LB-10, OD-147). Sources: S1-G2, S2-G1, S3-G4, S5-G1, S5-G2, S5-G3, S5-G9, S6-G1, S7 host fact.

- [B22 lead, 2026-10-01] Re-verification (section 9): Re-verified on the SEC-1 tree `1ff9d81`: all five spawners are still plain host child processes with no memory, CPU, process-count, file-size or network limit, there is still no container definition, image digest or CI container, and the CD-10 runner still throws behind the 501; the only moved citation is the smoke-test spawn (`smoke-test/route.ts:58` -> `:59`), where SEC-1 added the worker's env allowlist, which narrows inherited secrets but is no isolation boundary, so D22-1 stands unchanged (high).

**D22-2 - No immutable runtime profile binds any executable.** Requirement: B22-A `:890-904`; B22-C "exact simulator ... pinned" (`:926`).
Finding: ngspice resolves from `NGSPICE_BIN` or PATH in all three spawners (`worker.ts:55`; `app/api/simulate/route.ts:46`; smoke test
imports the worker's constant, `smoke-test/route.ts:8`) and is never digest-checked; the manifest records only the `-v` string and
`mode: "subprocess"` (`app/lib/spice/server/manifest.ts:40`); kicad-cli comes from `KICAD_CLI` or PATH and FreeRouting is checked for
existence only, with env overrides winning (reader 2: `build-bundle.ts:83`; `autoroute/runtime.ts:60, :72-77, :93-96`); the CD-10 types
lack allowed arguments, I/O formats, mounts, CPU and file limits, seed control, kill semantics, parser/validator binding and
qualification evidence (`types.ts:54-69`), and no live runner reads them (`worker.ts:1-21`); the local ngspice-46 has no recorded
provenance or digest (`git grep` for `ngspice-46|Spice64` empty, reader 5) while upstream is at 47 (section 1.2). Severity high.
**CONFIRMED**. Closes: B22-A2 (profile contract and registry), B22-A3 (digest check before spawn); OD-135. Sources: S1-G1, S2-G5, S2-G9,
S3-G2, S5-G1, S5-G8, S7-G1, S7-G2.

- [B22 lead, 2026-10-01] Re-verification (section 9): Re-verified on `1ff9d81` and not closed by SEC-1: ngspice still resolves from `NGSPICE_BIN` or PATH with no digest check (`worker.ts:55`, `simulate/route.ts:46`, with the smoke test's import moved from `smoke-test/route.ts:8` to `:9`), and the manifest, kicad-cli, FreeRouting and CD-10 citations are unchanged (JAVA_HOME is at `runtime.ts:94-97`); the `git grep` for `ngspice-46|Spice64` now hits only SEC-1's probe record (version and `ngspice_con -b`, with no path, provenance or hash), and because SEC-1's final deck screen is cut to ngspice-46's probed behaviour, the unpinned executable now also bears on that screen's correctness.

**D22-3 - The SPICE Studio deck path admits caller and model text as live deck lines; a second `.control` block with `shell` is
probably reachable.** Requirement: B22-B "never generic code execution" (`:908`, `:918`); global `:157`; B22-D "child processes",
"filesystem escape", "parser differentials" (`:938`). Finding: the project arrives whole in the body of `POST /api/spice/runs`
(WRITE_EDITORS, `route-policy.ts:287`; `app/api/spice/runs/route.ts:18-30`); the writer splits every string on line breaks
(`netlist.ts:33`); the following reach the deck with an embedded newline and no screen: custom analysis commands and advanced directives
(`assertSafeDirective` tests only the start of the trimmed text, `:151-158`; `ir.ts:357-360`; `netlist.ts:146-147, :245`), `.ic` overlay
values (`ir.ts:307`), V/I values and waveforms (`netlist.ts:80-83, :97-100`; `units.ts:137-145`; readiness skips them,
`readiness.ts:180-182`; `ir.ts:349-351`), `.param` variable values (`netlist.ts:223-230`), custom `.options` (the `\s` class admits a newline,
`:196-199`) and output expressions, which land both in `.save` and inside the compiler's own `.control` block on the `write` line
(`:170-180, :247, :255`); the worker writes and runs the deck with no output screen (`worker.ts:162-176`), unlike `/api/simulate`
(`route.ts:92-106`). Aggravation: the SPICE AI route turns model-authored strings into "automatic" overlay and variable operations that the
studio pre-selects, together with an "automatic" run request that Apply starts (`app/api/spice/ai/route.ts:68-72, :103-116, :201-206,
:227-228`; `SpiceStudio.tsx:461, :467-475`), so a prompt injected through imported project or model text could reach the deck after one
human click (runbook `:154`). B19-D53 fixed this class only for `/api/simulate` (`artifacts/ai-control-plane-b19/import-security-matrix.md:648-658`,
reader 1); the only Studio directive test is a single-line `.control` (`app/lib/spice/__tests__/project-ir-netlist.test.ts:60-65`, reader 1). [B22 lead, 2026-10-01: before SEC-1; its suite adds advanced-directive cases, `.control/.endc/.include/.lib/.title` directive cases and
`assertSafeDirective` line-break cases (`sec-1-deck-injection.test.ts`).]
Whether ngspice then runs the injected block (for example with trailing tokens on a line) was not executed. Severity high. **CONFIRMED**
(each code fact), **INFERRED** (end-to-end exploitation). Closes: B22-A1 (counterexample at the spawn seam first, then the shared deck
validator and input screen); OD-137, OD-150. Sources: S1-G4, S2-G3, S7-G5; synthesizer (options, AI path).

- **Closed by SEC-1** (corrective branch `fix/spice-deck-injection`, `d0d2ec8`, 2026-10-01, three rounds): every caller- or model-controlled string the Studio compiler writes is screened as one line at the IR->deck boundary (79 fields by 12 payload forms, refused with a closed `SPICE_DECK_UNSAFE` error, red before; a TAB passes as whitespace), output expressions are allowlisted, `assertSafeDirective` checks one line, the `.options` screen admits space and tab only, and a final deck screen runs in the compiler, before the worker writes `executed.cir` and before the smoke test writes its deck. The final screen is cut to ngspice-46's CONFIRMED executing set (the lead's probes, section 1b of the page): it refuses a second `.control` block, a `*#` command line, an `*ng_script` title (on line 1 also through a `.title` prefix: a first line `.title *ng_script`, CONFIRMED by the lead's probe p10), an `.include`/`.lib` in an executed deck, every non-LF line break, NUL, a backtick and a dotted shell/filesystem directive; as defence in depth beyond the ground (the lead's p11-p13 CONFIRM a `*#` title runs nothing) it also refuses a non-banner `*#` title, on line 1 or set by a `.title` line - a stated deviation, owner decision proposed. It does NOT refuse an element card merely named like a command word (a card, not a command), which restores legitimate vendor model text. `POST /api/spice/runs` refuses a hostile plan with 422 before any job exists, except a plan whose test the worker refuses before any deck (a model the model screen refuses, or an IR that does not compile): that request answers 202 and its run fails with no deck written and ngspice never run. The SPICE AI `"automatic"` pre-selection is unchanged (its strings are screened at the compiler; OD-150 stays open); end-to-end exploitation stays INFERRED, the executing set CONFIRMED by probe.
- [B22 lead, 2026-10-01] Re-verification (section 9): Closed by SEC-1 (`fix/spice-deck-injection`, HEAD `1ff9d81`), re-verified with no gap found: 29 of the 33 citations hold at the same lines, while SEC-1 rewrote `netlist.ts:33` (the writer refuses a multi-line string), `:152`/`:155` (`assertSafeDirective` checks one line and raises a closed error), `:198` (`[\t ]` for `\s`) and `worker.ts:176` (the final screen runs before `executed.cir`), and added the field screen (`netlist.ts:214, :354-395`), the final deck screen (`:463-490`) and the runs preflight (`job-store.ts:182, :322-350`), as the SEC-1 page's section 7 clause states; OD-150 (the unchanged "automatic" pre-selection, whose strings are now screened) stays open, and end-to-end exploitation through a real ngspice stays INFERRED.

**D22-4 - The model screen lets file reads outside the run directory through, and screens different text from what it emits.**
Requirement: B22-A read-only input mount, network disabled; B22-D filesystem escape, device paths, network attempts, parser
differentials. Finding: `assertModelSafeForExecution` refuses only absolute or UNC `.include/.inc` (`app/lib/spice/models.ts:203`): `.lib`
with any path and relative `.include ../..` pass; on Windows a UNC `.lib` path could open an outbound SMB connection (INFERRED); the screen
reads `transformedContent ?? originalContent` (`:196`) but the deck emits `transformedContent?.trim() || originalContent.trim()`
(`netlist.ts:48-50`), so an empty or whitespace `transformedContent` passes the screen while unscreened `originalContent` is emitted
(INFERRED); the dependency check trusts the client's `model.dependencies` (`models.ts:207-209`); the smoke test returns ngspice's stdout
and stderr to the caller (`smoke-test/route.ts:102`), a channel for read content (INFERRED). Severity medium. **CONFIRMED** (code),
**INFERRED** (consequences). Closes: B22-A1; OD-137. Sources: S1 fact (model screen), S2-G4, S2 fact (differential).

- **Recorded, not closed by SEC-1.** In an EXECUTED deck (the runs and the smoke test) the final deck screen refuses the shell and `.include`/`.lib` consequences of the model screen's gaps (the `??`/`||` differential, `*#` command lines, `.lib`, a relative or traversing `.include`); a command-word line in model text is NOT refused (CONFIRMED a card by probe, not a shell path). XSPICE code-model file parameters in model text (`file=`, `input_file=`, `state_file=`) are not screened (an INFERRED host-file read); the model screen itself, its client-supplied `dependencies` and the preview's `.include`/`.lib` are unchanged, so D22-4 stays open for B22-A1.
- [B22 lead, 2026-10-01] Re-verification (section 9): Partly closed by SEC-1, re-verified on `1ff9d81`: the model screen, its `??`/`||` differential and the client-trusted `dependencies` are unchanged (`models.ts:196, :203, :207-209`; `netlist.ts:48-50`), but the final deck screen (`netlist.ts:446`, run at `worker.ts:176`, `job-store.ts:182` and `smoke-test/route.ts:119`) refuses every model-text `.include`/`.lib` in an executed deck, so relative, traversing and UNC paths and a hostile `originalContent` can no longer reach a spawned ngspice; D22-4 stays open for B22-A1 on the model screen itself (a single-backslash root-relative path also passes `:203`), the differential, client dependencies, XSPICE file parameters (an INFERRED host-file read), and the stdout/stderr return channels (`smoke-test/route.ts:103`, was `:102`; `worker.ts:186, :193-200`).
- D22-4: **Closed by B22-A1** (2026-10-01) but for what it records: the model screen reads exactly the text the deck emits (one helper, `emittedModelText`, for the deck, the screen and the smoke deck), refuses, closed, every `.lib` line, an `.include`/`.inc` whose path is not a plain relative name, an include at all (dependencies recomputed from the text, never the client), a blank `transformedContent` hiding a refused original, and model text opening with a `+` line; both the model screen and the executed-deck screen read XSPICE over the cards as ngspice joins them, across model boundaries, refusing a file parameter that names anything but a plain relative file and every code model of the installed ngspice-46 that starts a program or loads a library (`d_process`, `d_cosim`; the seven `.cm` libraries read, never run); every refusal SEC-1 answered 422 before any job is still 422 before any job; the smoke test's returned ngspice output and every stdout/stderr, failure message and log event a run record carries are bounded by one constant with a truncation marker. Red first: 31 + 6 cases on `0432fb8`, among them the smoke test and the runs route spawning ngspice for a host-path XSPICE parameter; then 36 more on the first fix after the review (the runs route spawning ngspice for a `d_process` card and for a parameter with no `=`). Recorded, not closed: a bounded channel still carries what a process prints; the diagnostic excerpts (`diagnostics.ts:122, :136`, about 140,000 characters at most) and a record's event list (`job-store.ts:95`, about 1 MiB a run) keep their own bounds; the ngspice card and XSPICE token readings are INFERRED until a live probe; the compile preview keeps `.include`/`.lib` and XSPICE text (SEC-1's decision, never executed); the run manifest's model checksum still hashes `transformedContent ?? originalContent` (`server/manifest.ts:30`, B22-C); the shared deck validator across `/api/simulate` and the Studio path is left to OD-136's single runner (B22-A3). [B22-A1 lead] The lead's probes p14-p15 CONFIRMED that ngspice also joins a `+` line opened by a non-ASCII character; the card reader now skips those too (three cases red, then green), and p18-p22 CONFIRMED that such a character does not make a `*#`, `.control` or `.include` line run or read.

**D22-5 - Three spawns inherit the full server environment; the others still pass HOME and USERPROFILE.** ([B22 lead, 2026-10-01: after SEC-1
one spawn, kicad-cli, inherits the whole environment; every ngspice spawn passes the allowlist, which still holds HOME and USERPROFILE.] Requirement: B22-A "no
inherited application secrets" (`:899`); global `:152-153`. Finding: the smoke test (`smoke-test/route.ts:58`), the worker's `-v` probe
(`worker.ts:60`) and kicad-cli (`kicad-cli-runner.ts:50-53`) pass no `env`, and Node's default is `process.env` (section 1.2), so every
provider, database and Supabase secret in the server environment reaches those children; the allowlists of the worker and
`/api/simulate` pass `HOME` and `USERPROFILE` (`worker.ts:81-86`; `route.ts:50-55`), so a host `.spiceinit` would be sourced at startup
(man page, section 1.2; `-n` is not passed) (INFERRED); the smoke-test gate pins argv and `windowsHide` but not env
(`b16-0-23-tranche16-confinement-gate.test.ts:83-94`); the B16.0.23 boundary record lists executable, args, cwd, timeout and output as
server-owned but not env (`simulator-execution-boundary.md:22-30`, reader 5). Exploiting the inheritance needs code execution inside the
child (D22-3, D22-4, a planted init file) (INFERRED). Severity high (the B22-A bullet is violated outright). **CONFIRMED** (spawn
options), **INFERRED** (inheritance and init file). Closes: B22-A1 (explicit env everywhere, pinned by a suite); B22-A3 (profile env
without HOME/USERPROFILE). Sources: S1-G3, S2-G2, S5-G4, S6-G5, S7-G3.

- **The ngspice half closed by SEC-1** (`d0d2ec8`): the smoke test and the worker's `-v` probe pass the worker's explicit allowlist, pinned equal across the three ngspice spawners and to the literal list. Open: kicad-cli's inherited environment (B22-A1, OD-148) and HOME and USERPROFILE in the ngspice allowlist (B22-A3's profile environment).
- [B22 lead, 2026-10-01] Re-verification (section 9): The ngspice half is closed by SEC-1, re-verified on `1ff9d81`: the smoke test (`smoke-test/route.ts:59`, was `:58`, helper `:123-128`) and the worker's `-v` probe (`worker.ts:60`) pass the worker's explicit allowlist, which is pinned literally, equal across the three ngspice spawners and checked with canary keys (`sec-1-deck-injection.test.ts:743-747, :781-789, :879-885, :925-933`); still open are kicad-cli, which now alone inherits the whole server environment (`kicad-cli-runner.ts:50-53`, OD-148), HOME and USERPROFILE in every ngspice allowlist (`worker.ts:82`, `simulate/route.ts:51`, `smoke-test/route.ts:124`, now pinned by the SEC-1 suite, so B22-A3's removal is a reviewed pin move), no spawn passing `-n`, and the B16.0.23 gate (`:83-94`) and boundary record (`:22-30`), which neither pin nor list env.
- D22-5: **kicad-cli's half closed by B22-A1**: kicad-cli spawns with an explicit environment allowlist and `windowsHide`, pinned literally and checked with canary keys at the fake seam; the list's adequacy is INFERRED (kicad-cli never run; the opt-in oracle is the live check). With SEC-1's ngspice half, no spawn inherits the whole server environment. Open: HOME and USERPROFILE in the ngspice allowlist, no `-n` on any spawn, and the B16.0.23 gate and boundary record that neither pin nor list env (B22-A3).

**D22-6 - The CD-10 execute and readiness routes trust a provider, environment and lowering manifest taken from the request body.**
Requirement: B22-C "input project/model digests are current" (`:928`) and the exact simulator pinned (`:926`); global `:138`. Finding:
`execute/route.ts:10` and `readiness/route.ts:6` cast `body.provider`, `body.environment` (and `body.manifest`) to the CD-10 types;
`authorizeSimulationExecution` and `providerAuthoritative` compare only caller-supplied fields and digest strings
(`safe-execution.ts:7-13`; `provider.ts:19`); the digests are FNV hashes any client can recompute (`stable.ts:4-6`); so a caller can send a
self-declared validated, digest-bearing, network-deny profile and obtain `authorized: true, mode: "authoritative"` at execute (then the
501) and a readiness report `simulation_verified_for_supported_scope` with `approve_for_CD11` and `run_authoritative_campaign`
(`readiness.ts:11, :20-22`). Latent today: the 501 stands, no client calls these routes (2.1) and nothing persists or consumes the report.
Severity high (it forbids wiring any runner behind the route). **CONFIRMED** (code), **INFERRED** (consequence). Closes: B22-C (a
server-owned profile registry resolved by id and digest; body copies must match or are refused); OD-138. Sources: S1-G6, S2-G10, S4-G2.

**D22-7 - The SPICE Studio job store very probably drops every completed run's results.** Requirement: B22-C "cancellation and timeout
produce no fabricated results" (`:931`) and "results are evidence" (`:933`); global `:147`. Finding: section 0: the worker's own
`onEvent({ status: "completed" })` (`worker.ts:226`) makes the record terminal through `addEvent` (`job-store.ts:89`), and
`executeQueuedRun` returns at the terminal guard (`:145`) before `Object.assign(job.record, result)` (`:146`); a completed run therefore
keeps `waveforms: []`, `scalars: []`, no `manifest` and no `netlist` (the initial record, `:186-202`), the bundle route answers 409 "Run has no
reproducibility artifacts" (`app/api/spice/runs/[id]/bundle/route.ts:21`) and the studio shows a completed run without data. The default
suite cannot see it (the fake never emits `completed`, `b16-0-23-tranche-parity.test.ts:26-33, :468-476`); the live lifecycle test would
fail at `run?.manifest?.simulator.name` (`worker-integration.test.ts:64`) but is opt-in. Severity high (the live diagnostic path reports
"completed" with no evidence). **INFERRED** (every line CONFIRMED; behaviour not executed). Closes: B22-C (pre-edit counterexample with a
fake worker that emits `completed` through `onEvent`, then the result attached before the terminal status is published); OD-137.
Source: S4-G3; synthesizer re-read and `git blame`.

- [B22 lead, 2026-10-01] Re-verification (section 9): Re-verified on `1ff9d81` and still open: SEC-1 only shifted job-store lines (`:89` -> `:92`, `:85-94` -> `:88-97`, `:145-146` -> `:148-149`, `:186-202` -> `:190-206`), the worker's completed event (`worker.ts:226`) still makes the record terminal before `Object.assign`, so a completed run keeps the empty initial record with no `finishedAt` while the batch counts it completed, and neither the tranche-parity fake nor SEC-1's new end-to-end suite (whose `readFile` fake fails at the raw read) ever reaches that event, so B22-C keeps this fix under OD-137's default.
- D22-7: [B22-A1, 2026-10-01] Observed at the fake seam while B22-A1 built its bundle case: a completed run via `POST /api/spice/runs` never finished (`finishedAt` unset) and its bundle answered 409 "Run has no reproducibility artifacts", as section 0 inferred (`worker.ts:226`, `job-store.ts:148`) - CONFIRMED at the fake seam, not with a real ngspice; unchanged (B22-C).

**D22-8 - Output and temporary files are not bounded or isolated.** Requirement: B22-A "isolated writable temporary output", output
and file limits (`:897, :900`); B22-D huge output; global `:155` unbounded streams. Finding: the worker reads `result.raw` whole
(`worker.ts:205`) before its size check (`:220`) although `/api/simulate` has a truly bounded reader (`route.ts:222-254`); worker artifact
directories are never removed (`worker.ts:2, :156-158`) and the absolute host path is returned to clients as `artifactId` (`:245`);
kicad-cli and FreeRouting accumulate stdout and stderr without a cap (`kicad-cli-runner.ts:64-69`; `runner.ts:178-183`); FreeRouting uses
the shared `tmpdir()` as cwd (`runner.ts:159`) and reads its outputs unbounded (reader 2, `runner.ts:206`; `build-bundle.ts:182, :208`);
no spawn sets a CPU, memory, process or file-size limit. Severity medium. **CONFIRMED**. Closes: B22-A1 (output caps for kicad-cli and
FreeRouting, OD-148), B22-A3 (the runner's bounded read, per-run directory, cleanup, no host path in records). Sources: S1-G8, S2-G6,
S2-G12, S4-G9, S5-G5.
- D22-8: **In part closed by B22-A1** (OD-148): kicad-cli's and FreeRouting's accumulated output is held to twice the bound in bytes and returned bounded with a marker, FreeRouting's stderr keeping its own share; FreeRouting's `.ses` and kicad-cli's gerber and drill files are read through a bounded reader that refuses an over-bound file unread with a closed error; the SPICE reproducibility bundle carries the record's bounded logs and says so. Open (B22-A3): the worker's and the bundle route's whole reads of `result.raw`, the per-run directories never removed and their host path in records, FreeRouting's shared cwd and uuid files in `tmpdir()` (`runner.ts:129-130, :161`), the run directory's whole logs, and no CPU, memory, process or file-size limit on any spawn (the processes may still write files of any size).

**D22-9 - Kill is direct-child only, cancellation is reported before the process exits, and concurrency is unbounded across batches.**
Requirement: B22-A cancellation/kill semantics (`:902`); B22-D child processes, signal races, orphan processes, fork bombs. Finding: ngspice
is stopped with `child.kill()` and the default signal (`worker.ts:114, :128, :133`; `app/api/simulate/route.ts:268, :274`; `smoke-test/route.ts:65`), others with
SIGKILL (`runner.ts:165, :170`; `kicad-cli-runner.ts:56`); no runner kills a process tree or uses a process group or job object
(`git grep` for `taskkill|tree-kill|JobObject|detached:|process\.kill\(-` empty, reader 6); per the Node docs and libuv's Windows job flags
grandchildren survive both `kill()` and parent exit (section 1.2, INFERRED); the smoke test and the gerbers route wire no abort
(`smoke-test/route.ts:77-78`; reader 2 `gerbers/route.ts:95`); the job store marks a run `cancelled` and `finishedAt` at the abort request
(`job-store.ts:110-119`); concurrency is `min(8, plan.concurrency)` per batch with no global cap or rate limit (`:219`; reader 2). Severity
medium. **CONFIRMED** (code), **INFERRED** (orphan survival). Closes: B22-A3 (tree kill, terminal only after exit or an explicit
`kill_unconfirmed`, a global cap), B22-D (signal-race and orphan cases); OD-145. Sources: S1-G10, S2-G7, S4-G11, S4-G12, S7-G4.

- [B22 lead, 2026-10-01] Re-verification (section 9): Re-verified on `1ff9d81`: SEC-1 changed no kill, cancel or concurrency code and only moved `smoke-test/route.ts:65` -> `:66` and `:77-78` -> `:78-79`, and `job-store.ts:110-119` -> `:113-122` and `:219` -> `:223`; its refusal of injected control blocks and `*#` lines removes the deck route to an ngspice `shell` grandchild (INFERRED), but tree kill, terminal-only-after-exit and a global cap stay open for B22-A3, and the further direct-child kills at `worker.ts:74` and `simulate/route.ts:269` and the before-exit resolutions at `runner.ts:166, :171` and `kicad-cli-runner.ts:57` belong to the same gap.

**D22-10 - The live raw parsers lose values silently and disagree with each other.** Requirement: B22-C output units and tolerances
validated (`:930`), no fabricated results (`:931`); B22-D NaN/Inf, malformed output, parser differentials. Finding: the worker parser drops
every non-finite token (`waveforms.ts:51`), the `/api/simulate` parser drops only NaN and keeps Infinity (`route.ts:157`); both then index
by stride, so values after a dropped token are attributed to the wrong variable or point (INFERRED); a short file is only a warning and
the run still completes (`waveforms.ts:67`; `worker.ts:221-242`); neither checks axis monotonicity or units; no differential test compares
the two. Only CD-10's `createWaveformArtifact` enforces finite values and a strictly increasing axis (`waveform.ts:6`), and no live path
uses it. Severity medium. **CONFIRMED** (code), **INFERRED** (misattribution). Closes: B22-C (one validator; non-finite and short output
refused whole), B22-D (parser-differential case). Sources: S1-G9, S2-G11, S4-G4.

**D22-11 - Locale, timezone, randomness and thread count are uncontrolled.** Requirement: B22-A `:901`; B22-C reproducible or honestly
marked (`:932`); B22-D locale drift. Finding: no ngspice spawn sets `LC_ALL`, `LANG` or `TZ` (`worker.ts:81-86`; `route.ts:50-55`); the
diagnostic environment says `"uncontrolled-local"` and `["uncontrolled"]` (`provider.ts:15`); no `.options seed` is emitted
(`netlist.ts:182-201`); `spinit` sets `num_threads=8` in the install ([B22 lead, 2026-10-01: the draft said 4, the manual's value; section 1.2]); legacy results carry no environment-dependence flag
(`manifest.ts:22-42`, reader 1). Severity medium. **CONFIRMED** (code), **RECORDED** (spinit). Closes: B22-A2/A3 (profile env `LC_ALL=C`,
`TZ=UTC`, pinned seed and threads; results labelled environment-dependent unless the profile is qualified). Sources: S1-G12, S2-G8,
S7 facts.

**D22-12 - No server-held, durable, digest-bound simulation evidence exists, and the records call the in-memory runs durable.**
Requirement: B22-C results are evidence (`:933`); pass `:942` "import only validated artifacts"; global `:139-140`. Finding: section 2.5:
legacy results are in-process and in localStorage, `/api/simulate` answers inline, CD-10 state is browser-held and its routes are
stateless; the classification and action registry call the SPICE runs `project-durable` and "durable run records"
(`route-resource-classification.ts:57-61`; `action-registry.ts:156`); the server holds no durable schematic, so a server-run simulation
cannot bind its input to a server-held revision (reader 4). Severity medium. **CONFIRMED**. Closes: B22-C (a silent evidence aggregate,
input bound to a server SHA-256 of the submitted snapshot, labels corrected); OD-140 (bounded host is separate), OD-141, OD-142. Sources:
S1-G13, S4-G1, S4-G10.

**D22-13 - Evidence identities are not collision-resistant, and non-finite numbers have no durable encoding.** Requirement: global
`:140` evidence hashes; B22-C validated numerical output. Finding: CD-10 artifact and report digests are FNV-1a (`stable.ts:4`;
`smart-routing/hash.ts:1`); the legacy `schematicHash` is a client-asserted 64-bit FNV value (`identity.ts:29-42`); a not-evaluated
assertion carries a NaN band (`assertion.ts:7`) that `JSON.stringify` digests as `null`; the durable substrate refuses non-finite numbers
(`durable-workflow/stable.ts:8`). Severity medium. **CONFIRMED**. Closes: B22-C (SHA-256 envelope over an explicit encoding); OD-143.
Sources: S4-G5, S4-G6.

**D22-14 - Records and UI call diagnostic subprocess output a sandbox, authoritative or a qualification.** Requirement: B22-A `:906`
"Do not call a weak subprocess sandbox authoritative."; global `:144`. Finding: `/api/simulate`'s header and the B16.0.24 proof call the
runner "a confined ngspice sandbox" with "no network", resting on the deck screen alone (`route.ts:3-4, :14`;
`simulate-process-security-proof.md:4-5, :29-30`); the B16.0.24 decision says "authoritative execution stays available"
(`unknowns-and-owner-decisions.md:24-27`); the SPICE report is titled "verification report" with a "Qualification summary"
(`report.ts:4, :73`), the studio header reads "Reproducible qualification" (`SpiceStudio.tsx:713`), and the public renderer produces that
document from caller-supplied run records with no diagnostic disclosure (`reports/route.ts:7-19`; `report.ts:38-41`). Severity medium.
**CONFIRMED**. Closes: B22-C (wording and disclosure, pinned) and the closeout (a dated superseding note beside the B16.0.24 records);
OD-144. Sources: S4-G7, S5-G6, S7-G6; section 0.

**D22-15 - No named computation exists, and the registry has no vocabulary for one.** Requirement: B22-B `:910-916`. Finding: none of
the 42 descriptors is a pinned SPICE analysis, an approved equation, a bounded parse, a pinned experiment profile or an artifact compare
(reader 3, `tool-catalog.ts:108-1061`); the enums have no runner or computation binding, no evidence side effect and only two
verification states, and B05 requires an exact replay digest (section 2.4); the only simulation-facing model tools are the SPICE AI's
proposal tools (`_tools.ts:13-34`); OD-82 and OD-87 park routing and placement over MCP until a B22-B bounded profile exists
(`OWNER_DECISIONS.md:668, :684`). Severity medium. **CONFIRMED**. Closes: B22-B; OD-139. Sources: S1-G14, S3-G1, S3-G2, S3-G5, S3-G6.

**D22-16 - Every B22 tool or runner must move pins that are lexical or exact, and three of their titles are stale.** ([B22 lead, 2026-10-01: seven, section 9.5 item 10.] Requirement: global
`:157` and the B17-F/B20 ratchets (obligations, section 5). Finding: `APP_SPAWNERS` is an exact list, so any new runner module changes
`b20-b4` case 1 (`:38-44, :209-213`); a process-backed B05 read binding would break case 2 (section 0); the six model-simulation routes may
not name `docker` or `container` (`b16-0-20:66-72`); exposed ids may not match `/spice/i`, `/simulate/i` or
`/process|exec|shell|database|db\.|file\./i` and exposed descriptors may not mention `model-simulation` (section 2.4); counts 33/42/9/24
and the OD-120 role table are pinned in many suites (section 5); three titles say "EXACTLY 12" (2.7; [B22 lead, 2026-10-01: seven state 12, section 9.5 item 10]). Severity low (plan-shaping; no
code defect except the titles). **CONFIRMED**. Closes: B22-B (each move reviewed, with its reason) and the closeout (retitles, assertions
unchanged). Sources: S2 facts, S3 facts, S6-G3, S6-G4, S6-G9.

**D22-17 - In-process engines cannot be stopped at their budget.** Requirement: B22-A limits and kill semantics; B22-B "run a pinned
placement/routing experiment"; global `:155`. Finding: the read-invocation deadline is a `Promise.race` that rejects but cannot preempt
synchronous work (`tool-invocation.ts:512-518`) (INFERRED, reader 3); the placement engine checks budget only between specs (OD-87,
measured); the anonymous `/api/pcb/placement/preview` blocks the event loop about 125 s per request (B20 F1, still open, `route-policy.ts:257`);
a long-running read placed in a specialist row would be offered to that specialist (`scheduler.ts:700-718`, reader 3). Severity medium.
**CONFIRMED** (records, code), **INFERRED** (non-preemption). Closes: B22-B (a bounded engine host with hard termination for the
experiment profile and the in-process computations); F1 by OD-140. Sources: S3-G3, S6-G6.

**D22-18 - The census of which routes run external processes is wrong for three routes and has no connective test.** Requirement:
pass `:942` "measurable isolation boundary". Finding: `/api/chat` and `/api/pcb/qualify` reach FreeRouting (`app/api/chat/route.ts:412-421`;
`qualify/route.ts:49, :209`) but their rows carry no `externalProcess` (`route-resource-classification.ts:55, :78`); `/api/pcb/release`
claims `kicad-cli (server-authoritative)` (`:54`) and spawns nothing (section 0); only the durable annotation has a connective test (reader 2,
`b16-0-3-effective-classification.test.ts:44-59`). Severity medium. **CONFIRMED**. Closes: B22-A2 (a connective test from each route's
import closure to the spawners; rows corrected). Source: S2-G13.

**D22-19 - CD-10 authority has no execution or import path and no evidence corpus; the live decks are not CD-10 decks.** Requirement:
B22-C `:924-930`. Finding: the runner throws (2.1); nothing creates a `SimulationRun` or `WaveformArtifact` from a simulator; the 102
corpus cases are manifest-only with no golden output (`corpus.ts:16-19`); `auditNetlistLowering` checks the manifest against itself and
nothing re-parses the emitted deck (`lowering.ts:27`); the live decks come from schematic coordinates and hard-code or inline model text
(`app/lib/netlist.ts:84-127, :208`; `app/lib/spice/ir.ts:124-150`, reader 1). Severity medium (the authoritative half stays blocked by
D22-1 anyway). **CONFIRMED**. Closes: B22-C in part (an independent deck validator and a pinned model mapping for the diagnostic and
analytical paths); the authoritative corpus stays open (recorded). Sources: S1-G5, S1-G7.

**D22-20 - No adversarial test touches a real or sandboxed process.** Requirement: B22-D `:938`. Finding: the existing simulation suites
are source gates and fake-spawn route pins (2.7); none of the 16 B22-D classes runs against a real process; CI installs no ngspice and runs
no container (2.6); the one live worker suite is opt-in. Severity medium. **CONFIRMED**. Closes: B22-D (offline contract cases in the
default suite; opt-in local cases on the diagnostic runner; OCI cases BLOCKED-LIVE-QUALIFICATION under LB-10). Sources: S1-G11, S2-G14,
S5-G7.

- [B22 lead, 2026-10-01] Re-verification (section 9): Re-verified on `1ff9d81`: CI still installs no ngspice and runs no container, the live worker suite is still opt-in (`worker-integration.test.ts:14, :21`), SEC-1's third SPICE suite in prompt-to-gerber (`sec-1-deck-injection.test.ts` at `deterministic-manufacturing.yml:225`, pinned by `b19-e-ci-job-scope.test.ts:228-234`) still fakes `node:child_process` and `node:fs/promises`, and the lead's ngspice-46 probes were manual, so no B22-D class (runbook `:938`) runs against a real or sandboxed process; the section 2.6 positions after `:224` move +1 (`:269-271` -> `:270-272`, `:313-315` -> `:314-316`, `:328` -> `:329`).

**D22-21 - The SPICE AI cites browser-supplied run records as evidence.** Requirement: B22-B output enters Sirkit only through typed
validators (`:920`); global `:138`. Finding: `read_results`, `diagnose_failure` and `compare_runs` build `EvidenceRef` objects from
`body.runs` with no digest or server lookup, and `propose_design_patch` attaches them (`app/api/spice/ai/route.ts:229-246`). Severity medium.
**CONFIRMED**. Closes: B22-C (evidence references resolve to server-held evidence records or are labelled caller-supplied); OD-150.
Source: S4-G8.

**D22-22 - The design the reserved OD-83..86/88 numbers wait for is not in the repository.** Requirement: B22-B (the OD-82/OD-87
reversal path). Finding: `OWNER_DECISIONS.md:687` points at `task-B4.md` section 8; `git ls-files | grep task-B4` is empty; only the
five-item summary (projection, propose delegation, pool and windows, replay, closed trace) survives in
`artifacts/ai-control-plane-b20/mcp-server-proposals.md:241-254` (reader 6). Severity low. **CONFIRMED**. Closes: an owner decision
(section 6, reserved row): B22 does not spend the numbers unless the reversal is performed. Source: S6-G2.

**D22-23 - No live-blocker row names the blocked simulation runner or an isolation platform.** Requirement: pass `:942` "the verdict must
say so". Finding: LB-1..LB-9 (`LIVE_BLOCKERS.md`) name none; LB-3 waits on "a container profile (B22)" (`:9`); LB-6 concerns container
PostgreSQL (`:12`). Severity low. **CONFIRMED**. Closes: B22-A2 adds LB-10 (OD-147). Sources: S1 fact, S6-G7.

**D22-24 - CI admits no B22 suite.** Requirement: OD-59/OD-124 practice (every chapter suite runs in CI). Finding: `CHAPTERS = ["b19-",
"b20-", "b21-"]` (`b19-e-ci-job-scope.test.ts:54`); OD-124 says a later chapter extends it without touching B21's suites
(`OWNER_DECISIONS.md:1131-1139`, reader 6). Severity low. **CONFIRMED**. Closes: B22-A2 (OD-146).

---

## 5. Obligations kept verbatim (with the pinning test for each)

From the runbook (`C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md`):

- `:906` "Prefer an OCI/container boundary for authoritative production execution. If the host cannot supply it, keep production
  authority blocked and deliver a diagnostic-only local runner plus complete contract tests. Do not call a weak subprocess sandbox
  authoritative." Pinned by `b16-0-20-simulation-confinement-gate.test.ts:90-96` (the 501 text and statuses) and `foundation.test.ts:59`
  ("does not authorize diagnostic environments as authoritative"); no test pins the wording rule (B22-C adds one, D22-14).
- `:918` "Do not expose `shell`, `exec`, arbitrary Python/JavaScript, arbitrary package installation, unrestricted filesystem or arbitrary
  URLs to the product agent." and `:157` "No generic model-facing shell, SQL, migration, filesystem-write or process-spawn tool." Pinned by
  `b17-f-agent-exposure.test.ts:71` (id regex), `b20-b4-process-gate.test.ts:209-227` (spawners and MCP closure),
  `b18-c-never-execution-sweep.test.ts:63-88` (reader 6); B22-B adds an AST gate (no tool input carries argv, a path, a URL or code).
- `:920` "Their output enters Sirkit only through typed validators and canonical import commands." No pin today (B22-C).
- `:931` "cancellation and timeout produce no fabricated results;" Pinned for the late-settle half only by
  `b16-0-23-tranche-parity.test.ts:450` (terminal guard); the completed half is D22-7 (B22-C adds the pin).
- `:933` "results are evidence, not automatic schematic/PCB authority;" Pinned by `b16-0-23-tranche-parity.test.ts:620` (the AI cannot
  execute; reader 1); the CD-10 `applySimulationProposal` refusal (`app/lib/model-simulation/agent-tools.ts:6`, reader 4) has no
  pin found in this discovery.
- `:934` "safety-critical claims remain out of scope without qualified validation." Held by `capability.ts:9`; no test names
  `unsupportedDomains` or `functional_safety_certification` (`git grep` over `*.test.ts` empty); B22-C pins that no named computation
  reaches an unsupported domain.
- `:942` "If production isolation cannot be proven, the production runner remains blocked and the verdict must say so." Pinned by the 501
  test above; the verdict line is the closeout's.
- `:138` "Never accept browser-authored or model-authored state as canonical merely because it has a plausible shape or digest." No pin
  on the CD-10 routes today (D22-6; B22-C).
- `:144` "Never tell a human that a design, part, simulation, DRC result, Gerber package, quote, order, assembly, or physical board is
  verified beyond the evidence actually obtained." No test pins the CD-10 page's "Validated sandbox unavailable" or the SPICE report
  wording (`git grep` over tests and specs empty); B22-C adds the pin (D22-14).
- `:147` "Missing evidence must remain missing or unknown; never invent a pass." Pinned for CD-10 by `foundation.test.ts:52` ("refuses
  green status for missing runs") and `:56` (manifest entries never called golden evidence).
- `:152` "Never expose credential values, tokens, cookies, connection strings, private keys or secret-bearing request bodies." Pinned for
  `/api/simulate` and the worker run by `b16-0-24-tranche17-confinement-gate.test.ts:118-150` (env allowlist) and for FreeRouting by
  `runner-security.test.ts:5-31` (reader 2); not for the smoke test, the `-v` probe or kicad-cli (D22-5).
- `:155` "Prevent SSRF, DNS rebinding, redirect escape, oversized bodies, decompression bombs, path traversal, archive confusion, unsafe MIME
  types, unbounded streams and unbounded tool loops." Pinned for the simulate raw read by `b16-0-24-1-security-correction.test.ts:76-170`
  (reader 1); not for the worker read (D22-8).
- `:158` "Preserve same-origin CSRF protection, authenticated server-derived identity, membership and role checks, bounded readers,
  cancellation and one-terminal-event semantics." Pinned by `b16-0-1-ci-gates.test.ts:160-177`, `b16-0-2-gates.test.ts:154-177`,
  `b16-0-4-authorization-and-body-gates.test.ts:31-144`, `b16-0-2-gates.test.ts:61-90` (no public process-spawning row) (reader 6);
  one terminal event: `app/lib/agent/loop.ts:285` and the trace validator (reader 6).
- `:164-165` (git): identity `Dandi Desta <dandidesta82@gmail.com>`; "Do not add Claude, Anthropic, Codex, OpenAI or other AI co-author
  trailers." Held by process only: all 23 commits on `main..HEAD` carry that identity and no trailer (reader 6); no test pins it. A
  session-level attribution reminder that asks for a co-author trailer is overridden by this rule and the owner's memory (section 8).
- `:166` "Do not rewrite main or force-push."; `:168` "Run a staged-content secret scan before every push."; `:169` "Use one branch and PR
  per major chapter unless a corrective security branch is required."; `:171` normal merge after the gates. Process only.

From the code (verbatim, must stay true; pinning test named):

- `app/lib/model-simulation/safe-execution.ts:20` "CD-10 deliberately does not spawn a process until an OS/container sandbox
  implementation is independently validated." The throw literal `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX` is pinned by no
  test (`git grep` in tests empty); the route's 501 is pinned (`b16-0-20-simulation-confinement-gate.test.ts:90-96`). B22-A2 adds a pin on
  the stub until a qualified profile exists.
- `app/api/model-simulation/execute/route.ts:10` the 403 "AI cannot execute simulation campaigns" (`b16-0-20-simulation-confinement-gate.test.ts:37-43`;
  `b16-0-20-tranche-parity.test.ts:169-173`), the 409 and the 501 text (`:90-96`).
- `app/lib/model-simulation/provider.ts:6` the diagnostic provider's limitations and `authoritativeEligible: false` (`foundation.test.ts:59`;
  the CD-10 benchmark asserts `legacyNgspiceAuthoritative: false`, `benchmark.ts:5`, `corpus-v1.ts:125`, reader 7).
- `app/api/simulate/route.ts:22-24` "a successful process exit is an EXECUTED simulation result only - never physical validation,
  engineering approval, design readiness, safety certification, or manufacturing release." No test pins the sentence (B22-C pins it).
- `app/api/spice/ai/route.ts:228` "Execution begins only after the user applies this proposal." (`b16-0-23-tranche-parity.test.ts:620`,
  reader 1).
- `app/lib/engineering/mcp-exposure-review.ts:36` routing withheld because "an MCP call may not start a process (b20-b4-process-gate)"
  (`b20-b4-withhold-proposals`, reader 6).
- `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts:38-44` the five spawners and `:218-226` the MCP closure (the tests are the pins).
- `app/lib/spice/server/job-store.ts:140-145` "a TERMINAL record is authoritative: a late worker settlement ... can NEVER overwrite"
  (`b16-0-23-tranche-parity.test.ts:450`) - kept, with the result attached before the terminal status (D22-7).
- Route census 165/162/3/0 (`b16-1c-invariant-tripwires.test.ts:38-48`); counts 42/33/9/24 (`b20-c1-three-way-parity.test.ts:241`, and 33
  in six suites, 42 in three, reader 6); the nine B11-scanned files carry no B22 identifier (`app/lib/agent/orchestration/tripwires.ts:9-22`;
  hash pins `b21-e2b-trace-attribution.test.ts:42-53`, reader 6); CSRF and bounded-reader gates (above); the B17-A control inventory
  (`b17-a-control-inventory.test.ts:31-93`, 628 sites, reader 6); OD-30's browser budget (workflow `timeout-minutes: 30`,
  `deterministic-manufacturing.yml:315`; no test, reader 6).

Owner decisions that bind B22 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md`): OD-82 (no proposal over MCP; routing returns
"once a sandboxed routing worker exists under B22-B", `:659-668`); OD-87 (placement over MCP needs "a bounded engine host with kill
semantics, stopped hard at the budget" that "deliberately changes `b20-b4-process-gate`", `:670-686`); the OD-83..86/OD-88 reservation
(`:687`); OD-30 (browser budget, `:104-108`); OD-19 (commit identity, `:31-35`); OD-59/OD-124 (CI admission, `:301-309`, `:1131-1139`);
OD-104 (the never-reachable partition, `:832-836`); OD-113 (B11 tripwires verbatim, `:1634-1645`); OD-120 (the role table).

---

## 6. Owner decisions needed (OD-134 onward) with a safe default each

| OD | Question | Safe default (applied unless the owner says otherwise) |
|---|---|---|
| OD-83..86, OD-88 (reserved) | Does B22 perform the MCP proposal reversal those numbers are reserved for (`OWNER_DECISIONS.md:687`)? | No. B22 builds only the precondition OD-82/OD-87 name (the bounded engine host and the pinned experiment profile, B22-B); the five numbers stay reserved and unspent; MCP stays read-only. If the owner orders the reversal, its design is re-derived from `mcp-server-proposals.md:241-254` (or the lead supplies `task-B4.md` section 8) and the five numbers are spent on its five items in that order. |
| OD-134 | The isolation verdict and the production runner. | Production authority stays BLOCKED: the 501 and its pin stay, `executeAuthoritativeSimulation` keeps throwing, and the verdict says so (runbook `:906`, `:942`). B22 delivers a diagnostic-only local runner and complete contract tests, plus an OCI profile contract tested offline. No docker, podman or runsc command is run on this host. If the owner repairs Docker Desktop or approves a Linux qualification platform (for example a GitHub-hosted `ubuntu-latest` job), an opt-in B22-A4 qualifies the OCI profile there; even then production stays BLOCKED until B24-A names the production host. |
| OD-135 | Which ngspice build each profile pins. | Diagnostic: the local ngspice-46 Windows install, pinned by a SHA-256 over the whole install tree (executables, `spinit`, code-model libraries, DLLs) recorded in the profile; a mismatch refuses the run; `NGSPICE_BIN`/PATH no longer choose the binary. OCI (contract only): ngspice 47 from a dated Debian snapshot (`47+ds-1` in trixie-backports or forky) on `debian:trixie-slim@sha256:<re-resolved>`, with the per-component licence set recorded. |
| OD-136 | The three legacy ngspice entry points (`/api/simulate`, the Studio worker, the smoke test). | All three call one diagnostic runner module and are labelled diagnostic-only; none is retired. The three files stop importing `child_process`; `APP_SPAWNERS` moves once, by review, to the new exact list. |
| OD-137 | Where the security and correctness corrections found here land (D22-3, D22-4, D22-5, D22-7, D22-8 output caps). | Inside B22, first (B22-A1 and B22-C), each with a pre-edit counterexample at the existing seam. If the owner prefers a corrective security branch from main (runbook `:169`), the same commits are cherry-picked there first. [B22 lead, 2026-10-01] Answered for D22-3 and D22-5's ngspice half by the alternative: SEC-1, a corrective branch from main (PR #12, `d0d2ec8`); this default governs the rest (D22-4's remainder and kicad-cli's env in B22-A1, D22-7 in B22-C, D22-8's caps in B22-A1). |
| OD-138 | How execute and readiness learn the provider and environment. | From a server-owned, frozen profile registry resolved by id and digest; a body copy that differs is refused 409 with a closed code; the registry holds no profile with `validationState: "validated"` in B22, so execute still ends 409/501. |
| OD-139 | The named computation catalog: which operations, which class, how exposed. | Five operation kinds (runbook `:912-916`). Process-free kinds (evaluate an approved equation through the analytical provider, compare deterministic artifacts, parse a bounded server-held artifact by digest) are Tier 0 read-class descriptors on a new binding status whose port is injected at the chat composition root. Process-backed kinds (pinned SPICE analysis, pinned placement/routing experiment) are propose-class: an inert sealed computation request a human approves; the server runs it on the diagnostic runner; the result is diagnostic evidence. Ids under `sirkit.computation.*` avoiding `spice`, `simulate`, `exec`, `process`, `shell`, `file.`, `order`, `ship`, `qualif`. Every one MCP-withheld with a reason; dormant for B21 specialists. Inputs are closed schemas: no argv, path, URL, deck text or code. |
| OD-140 | The bounded engine host for in-process computations and the experiment profile; the B20 F1 placement preview. | A worker-thread host with a hard terminate at the budget (and heap limits if the Node docs confirm them, section 8 item 7), used by the B22-B computations and the experiment profile only; a reviewed `APP_SPAWNERS`/process-gate move keeps it out of the MCP closure. F1 stays a separate queued fix unless the owner asks B22 to move the preview route onto the host. |
| OD-141 | Persistence of simulation and computation evidence. | One silent durable aggregate (for example `computation.evidence.v1`) scoped by tenant/project/branch: validated typed summaries, profile id and digest, input digests, SHA-256 digests of raw artifacts, `diagnostic_only` or `environment_dependent` labels, no outbox effect. Raw artifacts are not stored server-side in B22 (bounded and discarded after validation); reproducibility comes from re-running the pinned profile. |
| OD-142 | What a server-run simulation binds its input to, given no durable schematic exists. | The server SHA-256 of the submitted, validated snapshot plus the server-derived scope; labelled "bound to a submitted snapshot", never authority; no durable `SchematicState` store in B22 (OD-69 not reversed). |
| OD-143 | Digest family and the non-finite encoding. | CD-10's FNV digests stay as internal identity keys (no localStorage migration); every B22 evidence record carries a `durableWorkflowDigest` (SHA-256) over an explicit encoding where a non-finite or absent band is a closed state, never a number. |
| OD-144 | Legacy wording: the SPICE report, the studio header, the B16.0.24 "sandbox" and "authoritative" sentences; `/api/spice/reports` public. | Relabel to diagnostic wording with a fixed disclosure sentence in the report and the studio; a dated superseding note beside the B16.0.24 records and the `/api/simulate` header; the renderer stays public (it reads no state) with the disclosure "caller-supplied records, not verified by Sirkit". |
| OD-145 | Kill semantics and limits for the diagnostic runner on Windows. | Tree kill through a fixed-argv `taskkill /PID <pid> /T /F` on win32 and a process-group kill on POSIX; a run becomes terminal only after exit or as `kill_unconfirmed`; no native job-object dependency, so no OS memory or process cap on Windows (recorded as a diagnostic limitation, never claimed). |
| OD-146 | CI admission for B22 suites. | Extend `CHAPTERS` with `b22-` and admit one directory filter for the B22 suite folder; live suites opt-in only (`SIRKIT_B22_LIVE_RUNNER=1`), never in CI. |
| OD-147 | Live-blocker rows. | LB-10 "authoritative sandboxed simulation on a qualified OCI platform" BLOCKED-LIVE-QUALIFICATION; it unblocks when the owner supplies a reachable OCI engine (repaired Docker Desktop with a recorded backend, or a Linux host or CI runner) and B24-A names the production host. |
| OD-148 | kicad-cli and FreeRouting in B22. | B22-A1 closes their secret inheritance (kicad-cli env) and unbounded output (both), because those violate B22-A bullets; their full profiles (digest pins at run time) are defined in B22-A2 as diagnostic-only; their containers belong to LB-3/LB-10. |
| OD-149 | Model-generated scripts (runbook `:920`). | Not allowed in B22: no tool accepts code or a script; recorded. |
| OD-150 | SPICE AI approvals and evidence. | Every operation whose strings reach a deck (overlay elements, variables, analyses, sweeps) and the run request become "review" (not pre-selected); evidence references resolve to server-held records or carry a "caller-supplied" label. **The approval half applied by B22-A1**: every SPICE AI operation whose strings reach a deck and the run request are "review" and never pre-selected, from one table the route and the studio share; measurements and specifications stay "automatic", design patches "explicit". The evidence half (D22-21) stays with B22-C. |
| OD-151 (SEC-1, recorded in `OWNER_DECISIONS.md`) | The SPICE deck screen's refusal of a non-banner `*#` title (line 1, or a `.title` line's text), stricter than ngspice-46's ground (the lead's probes p11-p13: a `*#` title runs nothing). | Kept as fail-closed defence in depth (a project whose name starts `*#`, which main compiled, is refused); dropping it restores main's behaviour, now supported by the probes. |
| OD-152 (SEC-1, recorded in `OWNER_DECISIONS.md`) | SEC-1's other stated deviations from its task text. | A TAB passes single-line fields; in model text a form feed and other non-line-break control characters pass, as on main; the dotted `.shell/.cd/...` refusal is kept as defence in depth; every line-break form, NUL and a backtick stay refused everywhere. |

---

## 7. Increment plan (test-first, gated)

Conventions: new chapter branch from main after PR #11 merges; every increment = failing suite first, then code, then green, then
generators, `git status` clean, commit, push (the owner's commit-and-push rule; never merge automatically); suites
`b22-<letter>-<subject>.test.ts` under one directory (proposed `app/lib/computation/__tests__`) admitted to CI in the same commit (OD-146);
no vitest concurrent with Playwright, every runner process stopped afterwards; no B22 identifier in the nine B11-scanned files; the route
census stays 165/162/3/0 unless a reviewed move says otherwise (the plan adds no route); the 501 and its pin never move; no docker, podman
or runsc command is run on this host unless OD-134's alternative is taken; commits as `Dandi Desta <dandidesta82@gmail.com>` with no AI
trailer; a staged-content secret scan before every push. A pre-edit counterexample that does not reproduce is recorded "not reproduced"
and its screen stays as defence in depth; it is never claimed exploited.

### B22-A1 - Security corrections first (closes D22-3, D22-4, D22-5; D22-8 output caps for kicad-cli and FreeRouting)
- [B22 lead, 2026-10-01] Narrowed by SEC-1 (section 9.4): B22-A1 now closes D22-4 (what SEC-1 left), D22-5 (kicad-cli's env), D22-8's output caps
  for kicad-cli and FreeRouting and OD-150's approval levels. SEC-1 already did the Studio input screen, `\s` -> `[ \t]`,
  `assertSafeDirective`'s one-line check, a final screen on every Studio and smoke deck and the explicit ngspice env, with their
  tests in `sec-1-deck-injection.test.ts`; the bullets below are read with that subtraction.
- Tests first (pre-edit counterexamples at the fake `node:child_process` seam, the b19-d pattern): one case per D22-3 vector (custom
  command, advanced directive, `.ic`, V/I value and waveform, `.param`, `.options`, output expression, SPICE AI overlay applied) showing a
  second `.control` or a `shell` line reaching `spawn`; then post-edit zero spawns. Model screen cases: `.lib` absolute and UNC, relative
  `.include ../`, empty `transformedContent` over a hostile `originalContent`, client `dependencies: []` with an include. Env cases: every
  spawn site passes an explicit `env` equal to its allowlist (smoke test, `-v` probe, kicad-cli).
- Code: a shared deck validator lifted from `assertNetlistSafe` (exactly one generated `.control`/`.endc`; no `.include/.inc/.lib` except
  profile-owned sandbox-relative ones; no `.shell/.cd/.source/.quit/.exec/.system/.destroy/.remcirc`, `shell`, `*#`, `!` or backtick) run on
  every deck before any ngspice spawn; an input screen for every caller string the Studio compiler writes (control characters refused);
  `\s` in the options screen replaced by `[ \t]`; the model screen run on exactly the emitted text with `.lib` and traversal refused and
  `dependencies` recomputed from content; explicit env on the three spawns; output caps for kicad-cli and FreeRouting (OD-148); SPICE AI
  approval levels per OD-150.
- Suites: `b22-a-deck-injection`, `b22-a-model-screen`, `b22-a-secret-env`; `b19-d-deck-injection` and `b16-0-23` §J stay green.
- Pages: `artifacts/ai-control-plane-b22/README.md`, `deck-and-secret-corrections.md`.
- Stop: a change that needs the CD-10 routes, the 501 or a new route stops for the lead.

### B22-A2 - Threat model, immutable runtime profiles, the isolation verdict (closes D22-2 (contract), D22-18, D22-23, D22-24; records D22-1, D22-11 (contract))
- Code: `runtime-profile.ts` - a closed, frozen profile type extending `SimulationExecutionEnvironment` with: executable or image digest
  (whole install tree), version and provenance, input/output formats, an argv template with no caller slot, input mount policy, writable
  output directory policy, network policy, env (an exact map, not inherited; `LC_ALL=C`, `TZ=UTC`, no `HOME`/`USERPROFILE`), CPU, memory,
  process, file, output and wall-clock limits with an `enforcedBy` field per limit (`os`, `runner` or `none`), seed and thread settings, kill
  semantics, parser id and independent validator id, qualification evidence refs, `validationState`. A server-owned registry with
  `ngspice-local-diagnostic` (`local_subprocess_diagnostic`, `diagnostic_only`, `authoritativeEligible: false`) and `ngspice-oci`
  (`container`, `unvalidated`, the flag vector from section 1.2, no evidence) plus diagnostic records for kicad-cli and FreeRouting
  (OD-148). A connective `externalProcess` census test and corrected rows. A pin on the throwing stub. `CHAPTERS` + `b22-`. LB-10.
- Suites: `b22-a-runtime-profile` (closed keys, immutability, digest reproducible, no caller slot in argv, no profile `validated`),
  `b22-a-process-census`, `b22-a-ci-job-scope`.
- Pages: `threat-model.md` (assets: server secrets, host filesystem, network, event loop, evidence truth; adversaries: a WRITE_EDITORS
  member, model output through SPICE AI, a hostile model file, a replaced binary on PATH; entry points: section 2.2-2.3), `runtime-profiles.md`,
  `isolation-verdict.md` (production BLOCKED and why, with the host probe dated and labelled).
- Stop: if the owner supplies an OCI platform, add B22-A4 (opt-in qualification job) instead of running anything locally.

### B22-A3 - The diagnostic-only local runner (closes D22-5 (profile env), D22-8, D22-9, D22-11 (runtime))
- Code: one runner module, the only ngspice spawner: verifies the profile digest before spawn; per-run `mkdtemp` directory; input written
  by the server; fixed argv from the profile; env exactly the profile's; bounded stdout and stderr; the bounded raw reader lifted from
  `/api/simulate`; wall-clock timeout; tree kill (OD-145); a run terminal only after exit confirmed or `kill_unconfirmed`; cleanup in
  `finally`; a global concurrency cap; no host path in any record; every result labelled `diagnostic_only` and `environment_dependent`.
  The three legacy entry points call it (OD-136); `APP_SPAWNERS` moves once to the new exact list with the reason recorded.
- Suites: `b22-a-diagnostic-runner` (fake seam: argv, env, cwd, caps, kill on timeout and abort, cleanup on every path, terminal order);
  `b22-a-runner-live` opt-in (`SIRKIT_B22_LIVE_RUNNER=1`, local only: the digest check, `-v`, one `.op` deck, a tree-kill of a long run).
- Pages: `diagnostic-runner.md` (each B22-A bullet: enforced by the OS, by the runner, or not enforced; nothing called a sandbox).
- Stop: if the new runner module would enter the MCP closure (`b20-b4` case 2) or a B11-scanned file, stop.

### B22-B - Named computations, never generic execution (closes D22-15, D22-16 (pin moves), D22-17 (host); records the OD-82/OD-87 precondition)
- Code: a closed computation catalog (five kinds, OD-139), each with a closed input schema, a profile id, an output validator id and a
  budget; descriptors and their reviewed exposure entries (one reason each), MCP-withheld entries, specialist dormancy; a new binding status
  and gateway branch modelled on `bound-external-read`; the runner and host ports injected at the chat composition root; the bounded engine
  host (OD-140) for the in-process kinds and the experiment profile (contract and offline tests; live FreeRouting stays LB-3/LB-8).
- Suites: `b22-b-catalog` (closed inputs; no argv, path, URL, deck or code field anywhere), `b22-b-exposure` (reviewed moves of 33/42/9/24
  and the derived partition; the never-execution and never-reachable sweeps re-run with the new descriptors), `b22-b-no-generic-exec` (AST:
  only the runner and host modules import `child_process` or `worker_threads`; no descriptor or tool name spells a generic operation),
  `b22-b-bounded-host` (terminate at budget; a computation that ignores its budget is stopped).
- Pages: `named-computations.md`.
- Stop: a descriptor that would need a gate regex or `NEVER_EXPOSED_TOOL_PATTERNS` widened stops for an owner decision; a computation that
  needs a route stops for a reviewed census move.

### B22-C - Simulation authority (closes D22-6, D22-7, D22-10, D22-12, D22-13, D22-14, D22-21; D22-19 in part; the 501 kept)
- Code: execute and readiness resolve provider and environment from the registry (OD-138), still 409/501; an independent deck validator that
  re-parses the emitted deck and checks node, component and include mappings against the IR; model libraries pinned by content digest
  (`artifact://sha256/`) for the diagnostic and analytical paths; one output validator over `createWaveformArtifact` that refuses non-finite
  values, short output, a non-increasing axis and unknown units whole (no dropping); the job store attaches the result before it publishes
  the terminal status (pre-edit counterexample); the silent evidence aggregate (OD-141..OD-143); report and studio wording with the
  disclosure (OD-144); SPICE AI evidence references resolved or labelled (OD-150).
- Suites: `b22-c-authority` (body profiles refused; the 501 text unchanged; diagnostic results never `authoritative`), `b22-c-output-validator`,
  `b22-c-job-store-terminal` (counterexample first), `b22-c-evidence-store` (CAS, idempotent, digest re-verified on load, non-finite encoded),
  `b22-c-wording`.
- Pages: `simulation-authority.md` (each `:926-934` clause: met, met for diagnostic only, or blocked, with evidence).
- Stop: anything that would turn the 501 into execution, or make a capability `unsupportedDomains` entry reachable, stops.

### B22-D - Adversarial tests (closes D22-20; every item of runbook `:938`)
For each item: (P) a prevention contract case in the default suite at the fake seam; (L) an opt-in live case on the diagnostic runner on
this host; (O) the OCI case, BLOCKED-LIVE-QUALIFICATION under LB-10 unless OD-134's alternative is taken. A live escape is recorded as a
finding and the item is reported not contained; it never becomes a pass.
1. Fork bombs - P: the deck validator refuses every spawning construct (`shell`, `*#`, `.exec`, `!`); L: a run that cannot spawn is
   killed at the wall clock with its tree; recorded that Windows has no OS process cap (OD-145).
2. Child processes - P: same refusals; L: tree kill leaves no descendant (process listing before and after).
3. Filesystem escape - P: `.include`/`.lib` absolute, UNC and `../` refused; output path fixed; L: the run directory is the only
   writable location the deck names.
4. Symlink/hardlink tricks - P: the runner creates its directory with `mkdtemp`, writes only server-named files, and refuses a raw file
   that is a link (lstat); L: a pre-planted link in the run directory is refused.
5. Device paths - P: `\\.\`, `//./`, `NUL`, `CON`, `/dev/*` in any include, output or model path refused.
6. Huge output - P: log and raw caps refuse whole (no partial parse); L: a deck that writes past the cap is killed and refused.
7. Infinite simulation - P: timeout yields `timeout`, no result; L: a long transient is stopped at the profile's wall clock.
8. Malformed binary output - P: the validator refuses a binary or mixed rawfile, bad UTF-8, a short or over-long values section.
9. NaN/Inf - P: any non-finite token refuses the artifact whole; both legacy parsers' drop behaviour is pinned as refused.
10. Locale drift - P: the profile env carries `LC_ALL=C`, `TZ=UTC`; the parser refuses decimal commas; L: the same deck under a forced
    host locale yields the same digest.
11. Network attempts - P: no deck construct reaches a network path (UNC `.lib`, URLs); L: recorded that the diagnostic runner has no OS
    network denial (only O can prove denial).
12. Environment-variable exfiltration - P: every spawn's env equals its profile map; a canary variable in the server env is absent from the
    child env (fake seam) and from any returned output.
13. Signal races - P: abort during start, during run and after exit each yield exactly one terminal state; a late settle never overwrites.
14. Orphan processes - L: after abort and after timeout no ngspice or descendant survives (tree kill, OD-145).
15. Archive traversal - P: the run bundle zip writes only fixed entry names; any archive input to a named computation (bounded parse)
    refuses `..`, absolute and drive entries and decompression bombs.
16. Parser differentials - P: one corpus of rawfiles run through every parser that exists; any disagreement fails; the model screen and
    the deck emitter read the same text.
- Suites: `b22-d-adversarial` (default suite), `b22-d-adversarial-live` (opt-in).
- Pages: `adversarial-matrix.md` (16 rows x P/L/O with the outcome of each).
- Stop: a P case that cannot be written without a real process stays opt-in and is labelled so.

### Closeout
- Commit 1/2: dated superseding notes beside the B16.0.24 "sandbox"/"authoritative" sentences and the `/api/simulate` header; the three
  "EXACTLY 12" titles retitled ([B22 lead, 2026-10-01: the seven titles that state 12, section 9.5 item 10]; assertions unchanged); a tripwire that nothing outside the closeout's files repeats the superseded claims.
- Commit 2/2: `changed-files.md`, `test-and-validation-report.md`, `unknowns-and-owner-decisions.md` (OD-134..OD-150, D22-1..24 with their
  closing increment), `final-verdict.md` with `SANDBOX STATUS:` stating that the production runner remains BLOCKED (no qualified isolation
  boundary on any platform the program controls; production host undetermined) and that named computations run on a diagnostic-only local
  runner whose enforced limits are listed; ledger, `PROGRAM_STATE.json`, LB-10; the chapter PR undrafted and merged normally after green
  CI; continue to B23 where safe.

---

## 8. Questions and unknowns

1. **UNKNOWN** - Can the Docker Desktop engine start on this host, and with which backend (WSL 2 or Hyper-V)? The 2026-09-30 probes reached
   no engine; LB-6 records a start failure. Resolves by an owner statement or an owner-run start (OD-134, OD-147); until then no OCI case
   is live.
2. **UNKNOWN** - The production host (serverless, VM, container platform). Not declared; B24-A decides. Production authority stays BLOCKED
   in B22 whatever the answer (OD-134).
3. **INFERRED** - The local ngspice is release 46 (folder name only; [B22 lead, 2026-10-01: the lead has since run it for SEC-1's probes, which
   print no hash or provenance]). Resolves in B22-A2 by hashing the install tree and in B22-A3's opt-in
   live case by `-v` under the runner.
4. **UNKNOWN** - ngspice behaviour the official manual would settle but could not be read on 2026-09-30: whether `-n` is honoured in 46/47,
   batch exit codes on parse and convergence failures, rawfile NaN/Inf encoding, the default seed, `strict_errorhandling` placement, and
   whether a `.endc` line with trailing tokens closes a control block. Resolves by re-fetching the manual and by the opt-in live cases;
   never assumed.
5. **UNKNOWN** - Whether the D22-3 deck actually executes `shell` under `ngspice_con -b` on Windows. [B22 lead, 2026-10-01: answered in part - the
   lead's benign probes (SEC-1 page section 1b) confirm that a `.control` block, a `*#` line and an `*ng_script` deck execute an
   ngspice command (`echo`); no `shell` and no hostile deck was run, so end-to-end exploitation stays INFERRED, and D22-3's closure no
   longer depends on it.] B22-A1 proves the deck reaches
   `spawn` (offline); an end-to-end live proof would run only a harmless marker command and only with the owner's approval.
6. **UNKNOWN** - A Windows job object from Node without a native dependency (for memory and process caps). Resolves by reading the Node
   docs at B22-A3; the default records no OS cap (OD-145).
7. **UNKNOWN** - Node `worker_threads` termination and `resourceLimits` semantics (not read by any reader). Resolves by reading
   `https://nodejs.org/api/worker_threads.html` before B22-B, dated in `named-computations.md`.
8. [B22 lead, 2026-10-01: resolved - it is in the lead's session scratchpad at `scratchpad/b20/task-B4.md`, never committed; copy it into the
   repository before any reversal (section 9.5 item 12).] **UNKNOWN** - Where `task-B4.md` section 8 lives (the lead's B20 scratchpad per `EXECUTION_LEDGER.md:2374`). Resolves by the lead; moot
   unless the reversal is ordered (reserved row).
9. **INFERRED** - GitHub-hosted `ubuntu-latest` runners provide Docker and allow installing `runsc`. Resolves only if OD-134's alternative
   is taken, by a CI job's own evidence.
10. **RECORDED** - `.wslconfig` places `autoMemoryReclaim` under `[wsl2]` although Microsoft documents it under `[experimental]`; matters
    only if WSL 2 Docker becomes the qualification platform.
11. **RECORDED** - This session's harness reminder asks for a co-author trailer on commits; runbook `:165` and the owner's memory forbid AI
    trailers and fix the identity; the lead confirms the runbook rule governs B22 commits.
12. Open design questions carried to the owner table: the verdict and platform (OD-134), the pinned build (OD-135), consolidation (OD-136),
    where corrections land (OD-137), the registry (OD-138), the catalog and exposure (OD-139), the host and F1 (OD-140), persistence and
    binding (OD-141, OD-142), digests (OD-143), wording (OD-144), kill semantics (OD-145), CI (OD-146), LB-10 (OD-147), other executables
    (OD-148), scripts (OD-149), SPICE AI approvals (OD-150).
13. Live behaviour of any OCI boundary, of real ngspice under the adversarial cases, and of real FreeRouting or kicad-cli under a profile:
    BLOCKED-LIVE-QUALIFICATION (LB-10, LB-3, LB-8), recorded and never converted into a claim.

---

## 9. Lead reconciliation

Re-verified 2026-10-01 on the post-SEC-1 tree `1ff9d81`, with read-only reads only. Each verifier result gave the defect's citations from section 4, plus the section 0 and section 2 entries those citations point to.

### 9.1 Method

There is one verifier result per defect, D22-1 to D22-24. Each verifier re-read every citation of its defect on the working tree of `fix/spice-deck-injection` at HEAD `1ff9d81` (clean). That commit is "Merge main (B21, e109d76) into fix/spice-deck-injection", sitting on top of SEC-1's `fe147c9` (round 1) and `aafa2a8` (round 3 and the lead's close). Every file SEC-1 touched was compared with `e109d76` using `git diff e109d76 1ff9d81` and `git show e109d76:<file>`. The draft was written against `b11ef18`, which has the same content as `e109d76`.

**Rules the verifiers followed:**
- They used only read-only reads (Read, Grep, Glob, git show, git diff, git log, git grep).
- They executed nothing: no vitest, tsc, eslint, tsx, node, ngspice or docker.
- They did not re-fetch any external page, so the section 1.2 items stay **RECORDED**.
- They did not repeat any host probe, so the section 0 Docker and WSL facts stay **RECORDED**, and the engine's state stays **UNKNOWN**.
- The runbook was read at `C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md`.
- They used the same labels as the draft. A citation re-read at its file:line is **CONFIRMED**. Behaviour the draft labelled **INFERRED** stays INFERRED.

**One process deviation:** the D22-9 verifier disclosed that some early read-only shell calls piped git output through sed, grep and awk, and printed runbook lines with awk. This was outside the git-only command rule. Nothing was written or executed beyond reading.

**The synthesizer's own reads** (the verifiers' synthesizer, not the lead):
- `git log` and `git diff -U0 e109d76 1ff9d81` for job-store.ts, smoke-test/route.ts, worker.ts and the workflow.
- `app/api/spice/models/smoke-test/route.ts:57-128`.

**Shift rules these reads confirm:**
- **job-store.ts:** +3 for base lines after `:21` (three imports). +4 for base lines after `:178` (the preflight call at `:182`). `assertRunPlanDecksSafe` and `screenableIr` were added after base `:307`.
- **smoke-test/route.ts:** +1 for base lines after `:7`. The `safeEnvironment` doc comment is at `:122`, the function at `:123-128` and the allowlist at `:124`.
- **worker.ts:** edited in place at `:10`, `:60` and `:176` only, so no line moved.
- **deterministic-manufacturing.yml:** one line inserted at `:225`, so later lines move +1.

### 9.2 Verdicts and moved citations

**Results across the 24 defects:**

| Outcome | Count | Defects |
|---|---|---|
| Closed by SEC-1 | 1 | D22-3 |
| Partly closed by SEC-1 | 2 | D22-4, D22-5 |
| Stand, with moved citations | 5 | D22-1, D22-2, D22-7, D22-9, D22-20 |
| Stand | 16 | all others |
| Refuted | 0 | none |

27 citations moved, changed or turned out wrong:
- 16 moved.
- 10 changed by SEC-1.
- 1 wrong: D22-11's spinit thread count.

| Defect | Verdict | Citations moved or changed (old -> new) | Note |
|---|---|---|---|
| D22-1 | stands-with-moved-citations | `smoke-test/route.ts:58` -> `app/api/spice/models/smoke-test/route.ts:59` (changed by SEC-1: `env: safeEnvironment()` added, helper `:123-128`) | All five spawners are still plain host children with no memory, CPU, process-count, file-size or network limit. There is still no container definition, image digest or CI container, and the CD-10 stub and its 501 are unchanged. The section 2.6 workflow positions after `:224` move +1 (see D22-20). Stands at high. |
| D22-2 | stands-with-moved-citations | `smoke-test/route.ts:8` -> `app/api/spice/models/smoke-test/route.ts:9` (moved). The `git grep` for `ngspice-46\|Spice64` is no longer empty (changed by SEC-1; no new citation): it now hits the SEC-1 page, `sec-1-deck-injection.test.ts:23, :189`, and `netlist.ts:399, :427, :435, :456` | Executable resolution, the manifest, kicad-cli, FreeRouting and the CD-10 types are unchanged. SEC-1's final screen is cut to ngspice-46's probed behaviour, so the unpinned executable now also bears on that screen's correctness. This strengthens D22-2. |
| D22-3 | closed-by-SEC-1 | `netlist.ts:33`, same line, changed: the writer now refuses a multi-line string instead of splitting it. `netlist.ts:151-158`, changed: `:152` runs `assertDeckText` before the trim, `:155` raises a closed `SpiceDeckSafetyError`. `netlist.ts:196-199`, changed: `:198` uses `[\t ]` instead of `\s`, and custom options are also screened raw at `:374`. `worker.ts:162-176`, changed: `:176` runs `assertCompiledDeckSafe` before writing `executed.cir`. No line moved. | 29 of the 33 citations hold at the same lines. SEC-1 added the field screen (`netlist.ts:214, :354-395`), the final deck screen (`:463-490`) and the runs preflight (`job-store.ts:182, :322-350`). The verifier found no gap. Still open: OD-150, and end-to-end exploitation stays **INFERRED**. |
| D22-4 | partly-closed-by-SEC-1 | `smoke-test/route.ts:102` -> `app/api/spice/models/smoke-test/route.ts:103` (moved) | `models.ts:196, :203, :207-209` and `netlist.ts:48-50` are unchanged. The executed-deck consequences are now contained by the final screen rule `netlist.ts:446`, run at `worker.ts:176`, `job-store.ts:182` and `smoke-test/route.ts:119`. The defect stays open for B22-A1. |
| D22-5 | partly-closed-by-SEC-1 | `smoke-test/route.ts:58` -> `app/api/spice/models/smoke-test/route.ts:59` (changed: env allowlist added; helper `:123-128`, allowlist `:124`). `worker.ts:60` -> `app/lib/spice/server/worker.ts:60` (changed in place: the `-v` probe now passes `env: safeEnvironment()`) | The ngspice half is closed and pinned by `sec-1-deck-injection.test.ts:743-747, :781-789, :879-885, :925-933`. Still open: kicad-cli's inherited environment, HOME and USERPROFILE in the allowlists, no `-n` on any spawn, and the unpinned B16.0.23 gate and boundary record. |
| D22-6 | stands | none | SEC-1 changed no CD-10 file. The trust surface is wider than the draft says: readiness also takes problem, registries, denominator and coverage from the request body, and the CD-11 handoff (`firmware-bringup/problem.ts:23-25`) has the same trust gap. |
| D22-7 | stands-with-moved-citations | `job-store.ts:89` -> `:92`; `job-store.ts:85-94` -> `:88-97`; `job-store.ts:145` -> `:148`; `job-store.ts:146` -> `:149`; `job-store.ts:145-146` -> `:148-149`; `job-store.ts:186-202` -> `:190-206` | Only the line positions shifted; the behaviour is unchanged. SEC-1's new suite never reaches the completed event: its `readFile` fake fails at the raw read. |
| D22-8 | stands | none | Every citation is at the same line. `:245` does not reach clients today (D22-7 drops it); the host path reaches clients through `:196, :200, :217`. |
| D22-9 | stands-with-moved-citations | `smoke-test/route.ts:65` -> `:66`; `smoke-test/route.ts:77-78` -> `:78-79`; `job-store.ts:110-119` -> `:113-122`; `job-store.ts:219` -> `:223` | SEC-1 changed no kill, cancel or concurrency code. Its refusal of injected control blocks and `*#` lines removes the deck route to an ngspice `shell` grandchild (**INFERRED**). |
| D22-10 | stands | none | Both parsers read `inf` and `nan` as NaN and drop them. The divergence needs an `Infinity` or overflowing literal (**INFERRED**). |
| D22-11 | stands | `netlist.ts:182-201`, changed by SEC-1 in place: `:198` is now `[A-Za-z0-9_.=+\-\t ]`, and the claim still holds. Section 1.2's "spinit sets num_threads=4" is **wrong**: `C:/Users/robsa/Tools/ngspice-46/Spice64/share/ngspice/scripts/spinit:14` sets `num_threads=8`, and `rndseed` is commented out at `:5` | All four ngspice spawns now pass a locale-free allowlist. |
| D22-12 | stands | `job-store.ts:45-58` -> `:48-61` (moved; cited through section 2.2) | The draft omits the unwired CD-10 Postgres tables (`app/lib/db/schema.ts:1118-1158`; `drizzle/0018_cd10_model_backed_simulation.sql`). |
| D22-13 | stands | none | Wording only: `identity.ts` is "FNV-style", and the legacy manifest checksums are SHA-256. |
| D22-14 | stands | none | `SpiceStudio.tsx:713` is the eyebrow label of the Reports & regression panel, not the studio header. |
| D22-15 | stands | none | The SPICE AI list also holds read tools. OD-87 gives placement two other reversal paths besides a B22-B bounded host. |
| D22-16 | stands | none | Seven titles are stale, not three. SEC-1 adds pins that B22 must move. |
| D22-17 | stands | none | F1 stays open. |
| D22-18 | stands | none | The connective test must handle the four `/api/spice/runs/[id]*` routes. The row fix regenerates the byte-pinned CSV. |
| D22-19 | stands | none | SEC-1's `assertCompiledDeckSafe` (`netlist.ts:463-490`) is a safety screen, not the independent IR-to-deck validator. |
| D22-20 | stands-with-moved-citations | `deterministic-manufacturing.yml:269-271` -> `:270-272`; `:313-315` -> `:314-316`; `:192, :224` -> `:192, :224, :225` (changed by SEC-1: a third SPICE suite added at `:225`); `:328` -> `:329` | The new suite fakes `node:child_process` and `node:fs/promises`, so no real process runs. |
| D22-21 | stands | none | The gap is wider than stated: the evidence is attached to every proposal (`:249`), written to `aiAuditLog`, and labelled in the UI. |
| D22-22 | stands | none | `task-B4.md` survives only in the lead's B20 scratchpad, which resolves section 8 item 8. |
| D22-23 | stands | none | LB-10 is still free. |
| D22-24 | stands | none | SEC-1 admitted its suite without extending `CHAPTERS`. `b22-` must be added together with the first `b22-` suite. |

### 9.3 What SEC-1 closed and what stays open

SEC-1 is the corrective security branch `fix/spice-deck-injection`. It was cut from `6fd5a7b`, and main `e109d76` was merged into it at `1ff9d81`. The closure clauses in section 7 of its page (`artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md`) are adopted below. They are changed only where a verifier found them incomplete, and each such change is marked. In every clause, the page's sha placeholder is filled with SEC-1's merge commit `d0d2ec8`.

**Closed: D22-3.** The page's clause is adopted unchanged. It covers:
- Every caller- or model-controlled string the Studio compiler writes is screened as one line at the IR->deck boundary.
- Output expressions are allowlisted.
- `assertSafeDirective` checks one line.
- The `.options` screen admits only space and tab.
- A final deck screen runs in the compiler, in the worker before `executed.cir`, and in the smoke test.
- That final screen is cut to the executing set ngspice-46 showed in the lead's probes.
- `POST /api/spice/runs` answers 422 before any job exists.

The verifier tried to refute the closure on `1ff9d81` and found no gap:
- Every `writer.push` in `compileNgspiceNetlist` (`netlist.ts:216-259`) is screened by `assertDeckInputsSafe` (`:355-393`).
- The writer refuses any multi-line string (`:33`).
- Model text is held by the final screen. That screen runs in the compiler (`:261, :266`), the worker (`worker.ts:176`), the runs preflight (`job-store.ts:182, :322-350`) and the smoke test (`smoke-test/route.ts:117-120`).
- The SPICE AI path cannot write custom or advanced directives, because `configure_analysis` builds only op/tran/ac/dc/noise and is marked "review".

Caveats the clause already carries: the 268/268 green run and the probe table p0-p13 are taken from the page and were not observed again, and end-to-end exploitation through a real ngspice stays **INFERRED**.

Residuals outside the clause, from the verifier:
- `/api/simulate` keeps its own screen. Its `unsafe()` does not refuse U+0085, U+2028 or U+2029 (SEC-1 page section 4, **INFERRED** harmless).
- No shared deck validator spans `/api/simulate` and the Studio path.

**Closed: the ngspice half of D22-5.** The clause is adopted. The smoke test (`smoke-test/route.ts:59`, was `:58`) and the worker's `-v` probe (`worker.ts:60`) now pass the worker's explicit allowlist. That allowlist is pinned literally, equal across the three ngspice spawners, and checked with canary keys (`sec-1-deck-injection.test.ts:743-747, :781-789, :879-885, :925-933`).

**Still open: D22-4.** The clause ("recorded, not closed") is adopted. The verifier's "partly closed" label refers only to the executed-deck consequences:
- In an executed deck, `netlist.ts:446` refuses every `.include` or `.lib` that comes from model text.
- That rule runs in the worker, the runs preflight and the smoke test, so relative, traversing and UNC paths, and the differential's hostile `originalContent`, can no longer reach a spawned ngspice.

What stays open, as the clause says:
- the model screen itself;
- its `??`/`||` differential, which can still bypass rules the final screen does not repeat (Spectre language, a mid-line `!`; the probe table says neither executes);
- the client-supplied `dependencies`;
- XSPICE code-model file parameters in model text (`file=`, `input_file=`, `state_file=`): an **INFERRED** host-file read, and with a UNC path also an **INFERRED** SMB vector;
- the compile preview's `.include`/`.lib`, which never executes.

*Adjusted (additions; the clause is accurate):*
- ngspice stdout and stderr still flow back to callers. The smoke test returns them (`smoke-test/route.ts:103`), and so do run records, through log events (`worker.ts:186`) and the failed and cancelled result fields (`worker.ts:193-200`).
- A single-backslash root-relative Windows path also passes `models.ts:203`.

**Still open: the rest of D22-5.** The clause names two items: kicad-cli's inherited environment (`kicad-cli-runner.ts:50-53`, B22-A1, OD-148), and HOME and USERPROFILE in every ngspice allowlist (`worker.ts:82`, `simulate/route.ts:51`, `smoke-test/route.ts:124`; B22-A3).

*Adjusted (the verifier found the clause incomplete).* Also open:
- No spawn passes `-n`.
- The B16.0.23 gate (`b16-0-23-tranche16-confinement-gate.test.ts:83-94`) still does not pin env. Its boundary record (`simulator-execution-boundary.md:22-30`) still does not list env, and the spawn signature it quotes at `:18-19` predates the added env.
- The allowlist now exists as three duplicated copies (`worker.ts:81-86`, `simulate/route.ts:50-55`, `smoke-test/route.ts:123-128`), held equal only by a source regex.
- The SEC-1 suite pins HOME and USERPROFILE literally (`:744-745`), so removing them in B22-A3 is a reviewed pin move.

The "high" severity still holds, through kicad-cli.

**Still open: OD-150.** The SPICE AI "automatic" pre-selection is unchanged; its strings are now screened at the compiler. The evidence half (D22-21) is untouched.

**SEC-1's own owner decisions.** SEC-1 keeps a non-banner `*#`-title refusal as defence in depth beyond the ground: probes p11-p13 confirm that a `*#` title runs nothing. This is a stated deviation, recorded as a proposed "OD-(next)", with an optional "OD-(next+1)" for its other deviations. Their numbering is item 1 of 9.5.

### 9.4 Consequences for the increment plan

- **OD-137 is answered for D22-3 and D22-5's ngspice half.** SEC-1 took the alternative that OD-137's default names: a corrective security branch from main (runbook `:169`), landed before B22. Record OD-137 with that answer. Its default ("inside B22, first, each with a pre-edit counterexample") still governs the rest of its list:
  - what remains of D22-4, and kicad-cli's env: B22-A1;
  - D22-7: B22-C (the D22-7 verifier notes SEC-1 used the alternative only for D22-3 and half of D22-5);
  - D22-8's output caps: B22-A1.
- **B22-A1 shrinks to what SEC-1 left.**
  - **New heading:** "closes D22-4 (what SEC-1 left), D22-5 (kicad-cli env); D22-8 output caps for kicad-cli and FreeRouting; OD-150 approvals". Adopt the SEC-1 page's section 10 amendment: B22-A1's `b22-a-deck-injection` scope "shrinks to what SEC-1 left (D22-4 with the XSPICE file parameters, kicad-cli, OD-150)".
  - **Already done by SEC-1 (dropped from B22-A1):** the Studio input screen, `\s` -> `[ \t]`, `assertSafeDirective` checking one line, a final screen on every Studio and smoke deck, and the explicit ngspice env.
  - **Tests already in `sec-1-deck-injection.test.ts`:** the D22-3 vector cases and the ngspice env cases. B22-A1 does not rewrite them; it keeps that suite green alongside `b19-d-deck-injection` and `b16-0-23` §J.
  - **Tests to write first:**
    - model-screen cases: `.lib` absolute and UNC; relative `../`; a single-backslash root-relative path; an empty `transformedContent` over a hostile `originalContent`; `dependencies: []` with an include; XSPICE `file=`/`input_file=`/`state_file=`;
    - the stdout/stderr return channels;
    - kicad-cli's env equal to its allowlist.
  - **Code that remains:**
    - run the model screen on exactly the emitted text, refusing `.lib` and traversal and recomputing `dependencies`;
    - the XSPICE file parameters;
    - kicad-cli's explicit env;
    - the output caps (OD-148);
    - SPICE AI approval levels (OD-150).
  - **Still open from the original item:** one shared deck validator across `/api/simulate` and the Studio path. B22-A1 either does this or records it as left to OD-136's single runner in B22-A3.
  - **Suites:** `b22-a-secret-env` narrows to kicad-cli; `b22-a-model-screen` is unchanged.
- **Pins SEC-1 adds that B22 moves only by review:**
  - OD-136's single runner module and B22-A3's removal of HOME and USERPROFILE both break `sec-1-deck-injection.test.ts:925-933` (and `:744-745`).
  - Any B22 edit that shifts SEC-1's helper declarations in `netlist.ts` (`:284-493`) must re-pin the SEC-1 page (`:953-972`).
  - A pinned seed or thread count placed in the compiler's control block must extend `OWN_CONTROL_BLOCK` (`netlist.ts:419`) and the SEC-1 suite. `.options seed=` through `optionLines` needs no screen change.
- **B22-A2:**
  - `b22-` can be added to `CHAPTERS` only in the same commit as the first `b22-` suite (`b19-e-ci-job-scope.test.ts:152`). SEC-1's suite stays an explicit prompt-to-gerber entry (`deterministic-manufacturing.yml:225`, pinned at `b19-e-ci-job-scope.test.ts:228-234`).
  - The connective census test must handle the four `/api/spice/runs/[id]*` routes, which reach `worker.ts` through `job-store.ts` without spawning. It needs call reachability or a reviewed exemption list.
  - The corrected rows regenerate the byte-pinned B16.0.2 CSV.
  - The ngspice profile pins the build SEC-1's screen is cut to (D22-2).
- **B22-A3:** the profile env drops HOME and USERPROFILE (a reviewed pin move). The kill-site list also gains `worker.ts:74` and `simulate/route.ts:269`.
- **B22-C:**
  - The D22-7 counterexample is still needed, because SEC-1's suite cannot reach `worker.ts:226`.
  - The independent deck validator can build on `assertCompiledDeckSafe` but is not that screen (D22-19).
  - Decide whether the unwired CD-10 tables are reused or retired (D22-12).
  - OD-138 must also cover the CD-11 handoff (D22-6).
  - OD-150's evidence half widens to `:249` and `aiAuditLog` (D22-21).
- **B22-D:** for its P cases, the matrix can cite SEC-1's offline coverage of deck injection, env exfiltration (key names and canaries) and a deck-level parser differential. The L and O cases are unchanged.
- **Closeout:** retitle seven stale titles, not three (9.5 item 10).
- **Conventions (section 7):** PR #11 has merged (`e109d76`). B22's chapter branch is cut from main once SEC-1 merges, which is the `1ff9d81` content these verifiers read.

### 9.5 Corrections and additions the re-verification found (9.6 says which were applied in place)

1. **OD numbering order.**
   - `OWNER_DECISIONS.md` still ends at OD-133 on `1ff9d81`. The SEC-1 page proposes "OD-(next)" and "OD-(next+1)".
   - If those are recorded first, they take OD-134 and OD-135 and shift all of the draft's OD-134..OD-150. That breaks the draft's own references (D22-1 OD-134/OD-147, D22-2 OD-135, D22-21 OD-150, D22-23 OD-147, D22-24 OD-146, and others).
   - The SEC-1 page already cites the draft's OD-137, OD-148 and OD-150.
   - Fix the order before either set is recorded. Either record B22's OD-134..OD-150 first and give SEC-1's decisions the numbers after them, or renumber the draft and the SEC-1 page's citations together. LB-10 is still free.
2. **Fill in the sha placeholder** in the adopted closure clauses and the section 10 amendment with the commit that lands on main. The branch HEAD the verifiers read is `1ff9d81`.
3. **Header, draft `:18-23`.** "No `artifacts/ai-control-plane-b22/` directory exists" is now false: SEC-1 created `sec-1-spice-deck-injection.md` there. The tree statement should name `1ff9d81` as the re-verified base, and PR #11 has merged (`e109d76`).
4. **Section 0, ngspice bullet (`:34-37`), and section 8 item 3.** "The binary was never run (INFERRED 46)" is superseded. SEC-1 page section 1b records that the lead ran ngspice-46 as `ngspice_con -b` on Windows ("Compiled with KLU Direct Linear Solver"), with no path, provenance or hash. Whether the binary is genuine therefore still needs B22-A2's install-tree hash.
5. **Section 0, `-v` probe bullet (`:44-46`).** This is now false: `worker.ts:60` passes `env: safeEnvironment()`.
6. **Section 0, other bullets.**
   - The deck-injection bullet (`:47-54`) describes the pre-SEC-1 tree; mark it as superseded by the D22-3 closure.
   - In the completed-runs bullet (`:59-65`): `job-store.ts:85-94`, `:89`, `:145-146` -> `:88-97`, `:92`, `:148-149`.
7. **Section 2.2.** These positions come from the lead's diff and the verifiers' shift rule.
   - **Worker bullet:** "a cached `-v` probe with no `env` option" and "the deck written after only `assertModelSafeForExecution` and the readiness audit (`:162-176`)" are stale. `:176` now runs the final screen.
   - **Compiler bullet:** the `:33` split, the start-only `assertSafeDirective` (`:151-158`) and the `\s` options class (`:196-199`) were all rewritten by SEC-1.
   - **Smoke-test bullet:** "with no `env`" is stale, and positions move +1: `:58`->`:59`, `:65`->`:66`, `:77-78`->`:78-79`, `:19, :25, :46`->`:20, :26, :47`, `:102`->`:103`.
   - **Job-store bullet:** `:45-58`->`:48-61`, `:62-77`->`:65-80`, `:241-293`->`:245-297`, `:176-178`->`:179-181`, `:219`->`:223`, `:110-119`->`:113-122`, `:145, :149`->`:148, :152`.
8. **Section 2.6 (`:395-400`) and section 5 (`:742`).** Workflow positions after `:224` move +1: `:269-271`->`:270-272`, `:313-315`->`:314-316`, `:328`->`:329`, `:315`->`:316`. CI now runs three SPICE suites, with `sec-1-deck-injection` at `:225`.
9. **Section 3 reuse row (`:442`).** `job-store.ts:140-149` -> `:143-152`. **Section 5 (`:736`):** `job-store.ts:140-145` -> `:143-148`.
10. **Section 2.7 (`:414`), D22-16 and the closeout (`:891`).** Seven test titles state 12 while asserting the derived count, not three. All predate SEC-1:
    - uppercase "EXACTLY 12": `b16-0-20:102`, `b16-0-21-tranche14-confinement-gate.test.ts:116`, `b16-0-23:134`;
    - lowercase "exactly 12": `b16-0-24:151`, `b16-0-ai-approval-lifecycle.test.ts:24`, `app/lib/pcb/proposal/__tests__/b15-2-2-exact-outline-and-shape.test.ts:254`, `b15-2-core-closure.test.ts:315`.
11. **Section 1.2 (`:143`) and D22-11, the wrong citation.** "spinit sets `num_threads=4`" is the manual's value. The installed `C:/Users/robsa/Tools/ngspice-46/Spice64/share/ngspice/scripts/spinit:14` sets `num_threads=8`, with "default ... is: 2" at `:13`, and `rndseed` is commented out at `:5`. That `ngspice_con` loads this spinit is **INFERRED**. Whether `num_threads` has any effect depends on an OpenMP build.
12. **Section 8, items 5 and 8.**
    - **Item 5 is partly answered.** The lead's benign probes (SEC-1 page section 1b) confirm that a `.control` block, a `*#` line and an `*ng_script` deck execute an ngspice command (`echo`). No `shell` and no hostile deck was run, so end-to-end exploitation stays **INFERRED**. D22-3's closure no longer depends on it.
    - **Item 8 is resolved.** `task-B4.md` is in the lead's session scratchpad at `scratchpad/b20/task-B4.md`, with section 8 at `:786` and OD-83..OD-88 at `:822-909` (the verifier read only the headings). It was never committed: `git ls-files` and `git log --all` are both empty. A temp scratchpad is not durable, so copy the design into the repository before any reversal.
13. **D22-2.**
    - (a) Restate the evidence as: the `git grep` hits "only SEC-1's probe record, with no path, provenance or hash".
    - (b) `types.ts:54-69` is exact only for the environment type. `SimulatorProviderDefinition` (`:32-52`) carries `supportedModelDialects` (`:38`), adapter revision ids (`:40-42`) and `validationCorpusRefs` (`:45`). Narrow "lack parser/validator binding and qualification evidence" to the environment type.
    - (c) `runtime.ts:93-96` stops one line short of the JAVA_HOME candidate (`:94-97`). The existence-only loop is at `:104-115`, with a bare `java` fallback at `:119-126`.
    - Upstream 47 and the local binary's identity stay **RECORDED** and **INFERRED**.
14. **D22-3.** "The only Studio directive test is a single-line `.control`" is no longer true. The SEC-1 suite adds advanced-directive cases (`:301`), `.control/.endc/.include/.lib/.title` directive cases (`:473-482`) and direct `assertSafeDirective` line-break cases (`:711-713`).
15. **D22-4.** Add:
    - the single-backslash root-relative path (`models.ts:203`);
    - the run-record return channels (`worker.ts:186, :193-200`);
    - that the differential exists only on the run path, because the smoke fixture uses `??` (`smoke-test/route.ts:20`).
16. **D22-5.**
    - The title is stale: one spawn (kicad-cli) inherits the whole environment, not three.
    - B22-A1's "explicit env on the three spawns" (`:798`) now means kicad-cli only.
    - Add that no spawn passes `-n`.
    - The `-v` probe passes no `cwd`, so it runs in the server's cwd. Whether ngspice reads a cwd `.spiceinit` before handling `-v` is **UNKNOWN**.
17. **D22-6.**
    - "(and `body.manifest`)" applies only to execute.
    - Readiness also takes problem, modelRegistry, testbenchRegistry, denominator, coverage, applicabilityResults and campaign from the body.
    - `validateCoveragePartition` (`coverage.ts:18`) recomputes its digest only with the public FNV function.
    - Add the CD-11 consumer (`app/lib/firmware-bringup/problem.ts:23-25`), which re-derives readiness from client-persisted CD-10 state, so OD-138 must cover it.
    - The roles the CDS route-policy set admits (`route-policy.ts:192, :196`) were not checked; the defect does not depend on them.
18. **D22-7.**
    - Lead the requirement with `:147` and `:933`; `:931` is about fabricated results, not dropped ones.
    - Cite the studio consequence: `SpiceStudio.tsx:384-394` and `events/route.ts:29-31`.
    - Add that `finishedAt` is never set and the batch counts `completed=1` (`job-store.ts:103`) with no evidence.
19. **D22-8.**
    - `:245` reaches no client today. Cite `:196, :200, :217` beside it, and note that fixing D22-7 exposes `:245`.
    - `build-bundle.ts:182, :208` read kicad-cli's outputs, not FreeRouting's.
    - "Not isolated" rests on three things: the worker's leaked per-run directories under a shared root (`worker.ts:155-158`), FreeRouting's shared cwd and its uuid files placed directly in `tmpdir()` (`runner.ts:127-129, :159`), and no OS isolation. FreeRouting does remove its files in a `finally` (`:239-241`), and the smoke test removes its `mkdtemp` directory.
    - Add the bundle route's whole read of `result.raw` (`app/api/spice/runs/[id]/bundle/route.ts:38`).
    - The reader-2 attribution was not re-checked.
20. **D22-9.**
    - Add the kill sites `worker.ts:74` (the `-v` timeout) and `simulate/route.ts:269`.
    - Add the before-exit resolutions at `runner.ts:166, :171` and `kicad-cli-runner.ts:57`.
    - Plans are capped at 500 runs (`job-store.ts:179-181`).
    - Grandchildren surviving `kill()` stays **INFERRED**; the Node and libuv pages were not re-fetched.
21. **D22-10.**
    - Narrow the "disagree" half: `Number('inf')`, `Number('nan')` and `Number('1.#INF00e+000')` are all NaN in JS, so both parsers drop textual non-finite tokens alike. The divergence needs `Infinity` or an overflowing literal such as `1e999` (**INFERRED**).
    - Add the D22-7 interaction: the misattribution reaches users through `/api/simulate` today, and through Studio once D22-7 is fixed. `scalars.json` is still written (`worker.ts:225`).
    - How ngspice writes NaN and Inf is unmeasured.
22. **D22-11.**
    - Add the uncontrolled `.spiceinit` input: no `-n` on any spawn, and HOME and USERPROFILE pass through. No `.spiceinit` exists at `C:/Users/robsa/.spiceinit` today.
    - Locale is incidental, not controlled (**INFERRED**). The allowlist strips LANG and LC_*, so a POSIX child gets the C locale, while on Windows the CRT reads OS settings.
23. **D22-12.**
    - Add the unwired CD-10 tables (`app/lib/db/schema.ts:1118-1158`; `drizzle/0018_cd10_model_backed_simulation.sql`; `drizzle/meta/_journal.json:135`). Their unique indexes key on FNV digests (`schema.ts:1138, :1142`). Section 2.5 and B22-C must say whether they are reused or retired.
    - Runbook `:933` and `:139-140` support the defect only indirectly.
    - Relabelling the rows moves the byte-pinned CSV (`b16-0-2-gates.test.ts:266-267`).
24. **D22-13.**
    - `identity.ts:29-42` is one FNV-1a lane plus a custom lane: "FNV-style".
    - The legacy `stableStringify` encodes non-finite values as the strings `"NaN"` and `"Infinity"` (`identity.ts:12`), which collide with genuine strings. So the phrase should be "no unambiguous durable encoding", not "no encoding".
    - The legacy manifest's id and its netlist and model checksums are SHA-256 (`manifest.ts:30, :32, :38`). The weak legacy identity is the client-asserted `schematicHash` binding (`:31`).
    - Applying runbook `:140` here is an extension of its scope.
25. **D22-14.**
    - "Studio header" should read "the Reports & regression panel's eyebrow label" (`SpiceStudio.tsx:713`).
    - The closeout's superseding note has a precedent in the proof's "SUPERSEDED IN PART" section (`simulate-process-security-proof.md:51-57`).
26. **D22-15.**
    - The SPICE AI list (`_tools.ts:13-34`) also holds read tools.
    - The CD-7 tool `propose_calculation_analysis` (`app/api/calculation/propose/route.ts:10`) is calculation-facing and computes nothing.
    - OD-87 offers placement two other reversal options: an accepted bound after a real-board probe, and a measured footprint cap.
27. **D22-16.** Pins B22 must move or regenerate:
    - `sec-1-deck-injection.test.ts:925-933` (SPAWN_ALLOWLIST at `:744`);
    - `:953-972`;
    - SEC-1's `b19-e-ci-job-scope` case (`:228-234`);
    - the byte-pinned classification CSV (`b16-0-2-gates.test.ts:266-267`).

    The OD-120 role table was only spot-checked.
28. **D22-18.**
    - The connective test must treat `/api/spice/runs/[id]`, `/bundle`, `/events` and `/waveforms` correctly. They import `job-store.ts` and through it `worker.ts`, but never spawn. DELETE aborts a live child through `cancelRun` (`job-store.ts:116`).
    - The CSV is regenerated by `scripts/generate-b16-0-2-artifacts.ts`.
    - qualify reaches FreeRouting only outside fixture mode (`production-router.ts:23-24`).
29. **D22-19.** Add the writerless `simulation_runs` and `simulation_waveform_artifacts` tables (`schema.ts:1137`).
30. **D22-20.**
    - Cite runbook `:938` for the 16 classes.
    - Section 2.7's "B18-C never-execution" and "B20-D2 never-reachable" sweeps carry no line numbers and could not be checked.
    - `scripts/spice-ci.ts` (`package.json:24`) runs ngspice through the job store, but it is manual, no workflow references it, and it is not adversarial.
31. **D22-21.**
    - Add the wider reach: the evidence is attached to every submitted proposal (`:249`), written to `aiAuditLog` (`app/lib/spice/project.ts:330`), and labelled "evidence-bound" with "internal evidence reference(s)" in the UI (`SpiceStudio.tsx:717`).
    - Lead the requirement with global `:138`; `:920` covers model-generated scripts, so it applies here only by analogy.
32. **D22-24.** A `sec-1-` suite does not satisfy `:152`, so `b22-` goes into `CHAPTERS` in the same commit as the first `b22-` suite.
33. **Kept as labelled, not fixed (could not be re-checked read-only):**
    - the Docker engine and WSL state (**RECORDED**, start **UNKNOWN**);
    - upstream ngspice 47 (**RECORDED**);
    - the local binary's identity (not hashed);
    - ngspice's handling of `.spiceinit`, `-n`, NaN/Inf and locale (**UNKNOWN** or **INFERRED**);
    - the 268/268 run and probes p0-p13 (taken from the SEC-1 page);
    - the about-125 s F1 figure (B20's record);
    - every behaviour consequence the draft marks **INFERRED**.

### 9.6 The lead's decisions

- **Item 1, OD numbering.** The draft keeps OD-134..OD-150 (the SEC-1 page already cites OD-137, OD-148 and OD-150 by these numbers);
  SEC-1's two decisions take the next numbers, OD-151 (the `*#`-title refusal) and OD-152 (its other deviations), recorded in
  `OWNER_DECISIONS.md` with this commit (section 6 rows). LB-10 stays free for OD-147.
- **Item 2.** The sha placeholder is SEC-1's merge commit `d0d2ec8` in every adopted clause and in section 10.
- **Applied in place** (each marked `[B22 lead, 2026-10-01]`): item 3 (the header), item 4 (section 0's ngspice bullet and section 8
  item 3), item 5 (section 0's `-v` bullet), item 6 (section 0's deck-injection bullet superseded; the completed-runs positions),
  item 10 (seven titles, not three: section 2.7, D22-16, the closeout), item 11 (the installed spinit: section 1.2, D22-11), item 12
  (section 8 items 5 and 8), item 14 (D22-3's test statement), item 16 (D22-5's title).
- **Recorded here, applied by the increment that closes each defect** (each increment re-reads its defects at its start): items 7-9
  (the positions SEC-1 moved in sections 2.2, 2.6, 3 and 5), 13, 15 and 17-32 (additions and narrowings per defect).
- **Item 33** stays as labelled.
- **The verifiers' D22-9 process deviation** (some read-only git output piped through sed/grep/awk) wrote and executed nothing; recorded.

---

## 10. Amendments recorded by the increments

- SEC-1 (`d0d2ec8`) landed D22-3 and D22-5's ngspice half on a corrective branch from main before B22 (OD-137's alternative); B22-A1's `b22-a-deck-injection` scope shrinks to what SEC-1 left (D22-4 with the XSPICE file parameters, kicad-cli, OD-150).
- [B22-A1, 2026-10-01] B22-A1 closed what SEC-1 left of D22-4 (the model screen, its differential, client dependencies, XSPICE file parameters and program- or library-loading code models over joined cards, the bounded return channels), kicad-cli's half of D22-5, D22-8's output caps for kicad-cli and FreeRouting (OD-148) and OD-150's approval half, and admitted `b22-` to CI (OD-146); D22-7 was observed at the fake seam (B22-C); the shared deck validator is left to B22-A3.
