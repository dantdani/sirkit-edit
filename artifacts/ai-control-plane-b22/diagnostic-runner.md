# B22-A3 - the diagnostic-only local runner: one ngspice spawner, pinned, bounded, killable, never authoritative

Labels: **CONFIRMED** (read at the cited file, or executed by a suite named here at the fake seams), **INFERRED** (a conclusion from
reading code or documentation; never executed), **RECORDED** (written down from the lead's probes or a record, without a claim of our
own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Branch `chapter/b22-sandboxed-computation`, base `c037627` (B22-A2), 2026-10-01. Runbook B22-A `:906` ("deliver a diagnostic-only
local runner plus complete contract tests. Do not call a weak subprocess sandbox authoritative"); discovery D22-5 (the profile
environment), D22-8 (the runner half), D22-9, D22-11 (runtime), section 9 (9.4's A3 bullet; 9.5 items 16, 19, 20, 22); OD-135, OD-136,
OD-145, and the review's OD-155 and OD-156 (section 11). Nothing here ran ngspice or any other real process: every case runs at the
fake `node:child_process` / `node:fs/promises` seams; the opt-in live suite is the lead's.

## 0. What B22-A3 is

One module, `app/lib/computation/diagnostic-runner.ts`, is the ONLY ngspice spawner (OD-136). `/api/simulate`, the SPICE Studio worker
(its run and its `-v` probe) and the model smoke test call it and import no `child_process`. It EXECUTES the B22-A2 profile
`ngspice-local-diagnostic` (revision 2; [B22-C review, 2026-10-02] revision 3 since B22-C: the wired output validator, so its
`environmentId` is `runtime-profile:ngspice-local-diagnostic:3`): the install the server settings pin, checked by its install-tree digest before every spawn;
argv from the profile's templates with `-n`; EXACTLY the profile's environment as the map it passes (Node adds eight host variables on
win32, section 6); a per-run `mkdtemp` directory removed on every path; stdout and stderr redacted as they stream and held within A1's
bound; the raw file read back through the bounded reader lifted from `/api/simulate`; a tree kill on the wall clock and on abort;
terminal only after the child's `close` (or `kill_unconfirmed`); one global cap, shared by tenant, with every wait for a slot bounded.
Every result is labelled `diagnostic_only` and `environment_dependent`. It is not an isolation boundary: the child runs as the server
user with no OS limit (no job object, OD-145), and production simulation authority stays BLOCKED (`isolation-verdict.md`; the CD-10
501 and `executeAuthoritativeSimulation` unchanged).

Why `app/lib/computation/`: the module executes a `computation` profile and is shared by the worker and two routes; beside the worker
(`app/lib/spice/server/`) it would sit in a SPICE-only folder while the profile registry and the output bounds it reads live here.
It stays out of the MCP routes' runtime closure and out of every B11-scanned file (`b22-a3-single-spawner` case 4; `b20-b4` case 2).

## 1. Each B22-A bullet for the local runner: what enforces it

`b22-a3-diagnostic-runner` pins each **runner** row at the fake seams; **none** is stated, never claimed.

| bullet | enforced by | how (and what is not) |
|---|---|---|
| Executable | runner | the pinned install only: `SIRKIT_NGSPICE_INSTALL_ROOT` + `bin/ngspice_con.exe`, its `sirkit-install-tree-sha256/1` digest equal to `SIRKIT_NGSPICE_INSTALL_SHA256` before every spawn; `NGSPICE_BIN` and PATH choose nothing (case 2, 3) |
| Arguments | runner | the profile's templates only: `-b -n deck.cir` and `-n -v`; `deck.cir` is the server's name, relative to the run directory; no caller slot (case 1, 2; the B22-A2 validator) |
| Input mount | none | the deck is written by the server into the run directory; a local process can write there too (no OS mount) |
| Output directory | runner | one `mkdtemp` directory per run under `<os temp>/sirkit-ngspice-runs`, removed in `finally` on every path and again after a late close (case 8, 9) |
| Network | none | no OS network denial for a local process; the deck screens (SEC-1, B22-A1) refuse include, lib and XSPICE paths: prevention, not a boundary |
| Environment | runner | the map passed is EXACTLY `LC_ALL=C`, `TZ=UTC`, `PATH=<install>/bin`, `SystemRoot`, and `TEMP`/`TMP` = the run directory, with no HOME or USERPROFILE in it (case 2); on win32 Node (libuv) then copies the server's value of eight variables the map lacks into the child, named on every record (`hostAddedEnvironment`, section 6; OD-156) |
| CPU | none | no job object (OD-145); the wall clock bounds the run |
| Memory | none | no job object (OD-145) |
| Processes | none | no job object; the deck screens refuse every construct that runs a command (prevention) |
| File size | none | the process may write files of any size into its directory; the runner reads back none over the bound |
| Output | runner | stdout and stderr redacted as they stream (a host path split across pipe reads is still replaced), each held to twice `DIAGNOSTIC_OUTPUT_MAX_BYTES` and returned within it with A1's marker; the raw file through the bounded reader, an over-bound file refused whole and unread (case 5, 11) |
| Wall clock | runner | the profile's 120 s, or a caller's tighter bound (`/api/simulate` and the smoke test 10 s, the `-v` probe 2 s); then the tree kill (case 6). It starts at the spawn: a request's wait for a slot is bounded separately (section 4) |
| Locale | runner | `LC_ALL=C` and `TZ=UTC` in the exact environment; on Windows the C runtime reads the OS settings, so the effect there is INFERRED |
| Seed | runner | `.options seed=1` immediately before every run deck's final `.end` (`seedDiagnosticDeck`); the runner refuses a run deck without it, and one that sets its own `seed` or `rndseed` option (case 1, 3); the provenance records the seed (case 12); the lead's probe p24 CONFIRMS the option is accepted |
| Threads | runner | `num_threads=8` in the installed spinit, pinned by the install digest (another spinit is another digest); probe p26 CONFIRMS spinit loads under the exact environment |
| Kill | runner | win32 `taskkill /PID <pid> /T /F` (the runner's own spawn, a fixed argv), then the direct child; POSIX SIGKILL to the process group; terminal only after `close`, else `kill_unconfirmed`, the cause kept as `killReason` (case 6, 7, 8, 12) |

## 2. How the owner pins the local install (OD-135)

1. Print the digest of the install folder - the `Spice64` folder, whole (`bin/`, `share/ngspice/scripts/spinit`, the code-model
   libraries, docs and examples):
   `tsx scripts/print-install-tree-digest.ts C:\Users\robsa\Tools\ngspice-46\Spice64`
   (stdout: the 64 hex characters; stderr: the algorithm, the file count and the byte count). The script reads files only.
2. Set the two server settings, e.g. in `.env.local`: `SIRKIT_NGSPICE_INSTALL_ROOT` = that folder (absolute), and
   `SIRKIT_NGSPICE_INSTALL_SHA256` = the printed digest. `NGSPICE_BIN` no longer chooses the binary.
3. Any change to the tree (an update, a changed spinit, a replaced DLL) is a new digest: every run is refused
   `NGSPICE_DIAGNOSTIC_DIGEST_MISMATCH` until the setting is re-pinned.

An unpinned install (no or a malformed digest setting) is refused with `NGSPICE_DIAGNOSTIC_UNPINNED`, whose text names
`SIRKIT_NGSPICE_INSTALL_SHA256`; an unset or relative root with `NGSPICE_DIAGNOSTIC_INSTALL_ROOT_UNSET`, naming
`SIRKIT_NGSPICE_INSTALL_ROOT`; a tree with a link or that is not a directory with `NGSPICE_DIAGNOSTIC_INSTALL_UNREADABLE`; another
platform with `NGSPICE_DIAGNOSTIC_PLATFORM_UNSUPPORTED`; [B22-A3 review] a run directory the runner cannot prepare (a full or
unwritable temp volume) with `NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED`, naming the errno only. No value or path is echoed. Until the
owner pins it, every ngspice path fails closed: `/api/simulate` answers 503 with the closed text, a Studio run's record fails with it,
the smoke test answers 422 with it (each pinned by `b22-a3-diagnostic-runner` case 13).

**The digest cache (measured).** The full digest is computed once per process and cached with a stat fingerprint of the tree (every
entry's path, type, size, modification and change times and file id, from exact bigint stats; no file read). Before every spawn the
fingerprint is re-taken; equal, the cached digest stands; any difference re-hashes. Measured 2026-10-01 on this host (a scratch script,
not in the repository) on a synthetic tree shaped like the local install (778 files, 52,281,044 bytes): the full digest 469 ms; the
first check 620 ms (fingerprint, digest, fingerprint); each cached check 67-78 ms (five runs). RECORDED limit: a rewrite in place that
restores size, both times and the file id is not seen between hashes (the A2 digest's own limit), and the check-to-spawn window is the
time between the fingerprint and the spawn call (no awaited step between them but building the argv and environment). A Studio run
takes the fingerprint twice (the worker's early check before it compiles, the run's own before the spawn; the version lookup reuses
the first): about 140 ms per run on that tree, beside the run itself. [B22-A3 review] security-2: the worker's early check runs outside
the cap, so concurrent early checks now share one check in flight: six at once on a cold cache made six full digests before the fix
(the red run), one after (case 4).

`DIAGNOSTIC_RUNNER_MAX_RUNNING` = 4
`DIAGNOSTIC_RUNNER_MAX_QUEUED` = 64
`DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER` = 3
`DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER` = 32
`DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS` = 2000000
`DIAGNOSTIC_KILL_CONFIRM_MS` = 5000
`DIAGNOSTIC_VERSION_WALL_CLOCK_MS` = 2000

## 3. Kill semantics and terminal states (OD-145)

A run ends in exactly one outcome: `exited` (the child's `close` observed, with its exit code), `timeout` or `cancelled` (the runner
killed the tree and then observed `close`), `kill_unconfirmed` (the tree was killed and no `close` came within
`DIAGNOSTIC_KILL_CONFIRM_MS`), or `spawn_failed` (the child never started). [B22-A3 review] coverage-1: the record keeps why the runner
killed the tree (`killReason`: `timeout` or `cancelled`; null when it killed nothing), so a cancel is never reported as a timeout. A run
is never reported cancelled while its process may live. The answers, each pinned by `b22-a3-diagnostic-runner` case 13:

| outcome | Studio worker (record) | `/api/simulate` | smoke test |
|---|---|---|---|
| a refusal before any process | the run fails with the closed text | 503, the closed text | 422, the closed text |
| `spawn_failed` | the run fails: "ngspice could not be started from the pinned install" | 500, the same text | 422, the same text |
| `timeout` | failed: "Simulation timed out after <ms> ms" | 504 "Simulation timed out" | 422, check "Smoke test timed out." |
| `cancelled` (close observed) | cancelled | 500 "Simulation cancelled" | 422, check "Smoke test cancelled." |
| `kill_unconfirmed`, wall clock | failed: "Simulation stopped (kill_unconfirmed) at the wall clock ..." | 504 "Simulation timed out; ... (kill_unconfirmed)" | 422, check naming `kill_unconfirmed` |
| `kill_unconfirmed`, abort | failed: "Simulation stopped (kill_unconfirmed) after a cancel ..." | 500 "Simulation cancelled; ... (kill_unconfirmed)" | 422, check naming `kill_unconfirmed` |

The slot of a `kill_unconfirmed` run stays held until its `close` (the cap counts processes that may live), and its directory is
removed again then. [B22-A3 review] security-3: once a run has settled, what the surviving child still prints reaches no callback (the
Studio worker turned each chunk into a "running" event), and the job store drops any non-terminal event for a terminal record, so a
cancelled or failed Studio record is never reopened (case 8).

win32: the runner spawns `<SystemRoot>\System32\taskkill.exe` with the fixed argv `/PID <pid> /T /F` (the child's pid; no caller input;
`windowsHide`, no shell, `SystemRoot` its only variable passed - Node adds the ten libuv-required variables its map lacks [B22-A3 lead: ten, not eight - PATH and TEMP too]), then kills the direct
child once taskkill ends. POSIX: the child is spawned `detached` (a process-group leader) and the runner sends SIGKILL to the group,
the direct child only when the group is gone. No POSIX profile exists, so the POSIX branch is pinned by `killDiagnosticProcessTree`'s
own case (7), never reached by a run. [B22-A3 review] coverage-5, tests-4: whether `taskkill /T` reaches a real descendant of ngspice
stays **INFERRED** (taskkill's documented `/T`; discovery 9.5 item 20); no case shows it. The opt-in live case 4 runs a deck that
starts no descendant, so it shows only that the direct child is killed and its close observed (`timeout`, never
`kill_unconfirmed`); a benign descendant probe, if this build has one without a shell, is the lead's to design.

## 4. The global cap, shared by tenant (OD-155)

One counter in the runner (on `globalThis`, as the job store keeps its state) bounds the ngspice processes across every entry point and
batch: `DIAGNOSTIC_RUNNER_MAX_RUNNING` run at once and `DIAGNOSTIC_RUNNER_MAX_QUEUED` wait; one more is refused
`NGSPICE_DIAGNOSTIC_BUSY` (closed). [B22-A3 review] security-2, regressions-1, coverage-3, tests-6:

- **Holders.** Every request names its holder, the server-derived tenant (`/api/simulate` and the smoke test the request context's
  tenant, a Studio run its batch scope's tenant; none for a caller with no tenant). One holder runs at most
  `DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER` at once - so one tenant never holds every slot - and has at most
  `DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER` waiting - so one tenant never fills the queue; one more of that holder is refused BUSY at
  once (case 10).
- **Order.** A freed slot goes to a waiter whose holder is under its share, the holder with the fewest running first, and FIFO within a
  holder (case 10: tenant B's later request is granted before tenant A's earlier ones, and A's waiters in the order they came).
- **Every wait is bounded.** A request waits for a slot at most its own wall clock by default (`/api/simulate` and the smoke test 10 s,
  so a queued request is answered within about 10 s of waiting plus 10 s of running), then is refused BUSY with nothing run (case 10, a
  request that names no signal). A Studio point is a background job and asks for `DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS` - a full queue
  drained by slots each held one profile wall clock plus the kill-confirm wait, (64 / 4) x (120 s + 5 s); a longer wait means slots
  are held by processes whose exit was not observed, and the point fails BUSY then. Its cancel withdraws it at once. Before the review a
  wait had no time limit, and four `kill_unconfirmed` runs whose close never came would have held every later smoke test forever.
- **Aborts.** An abort while waiting ends the request `cancelled` with nothing spawned; the smoke test now declares
  `exposeAbortSignal`, so a client that leaves withdraws its queued run or stops its process (case 13).

Chosen: queue, then refuse - the Studio already runs up to eight points of a batch at once. RECORDED trade-offs: a single tenant runs at
most three at once (the fourth slot is kept for another tenant); a Studio point refused BUSY fails, and its batch moves on to the next
point (the job store's loop, unchanged), so a tenant over its queue share sees points fail fast rather than wait.

## 5. The three entry points (OD-136)

- **The Studio worker** (`app/lib/spice/server/worker.ts`): checks the pin first (`verifyDiagnosticInstall`, no process; concurrent
  checks share one in flight), compiles, seeds the deck and runs SEC-1's final screen on the seeded deck - the deck screened is the deck
  written and the deck recorded; probes the version once per observed install digest (`-n -v` through the runner), runs, and records
  the runner's opaque run id as `artifactId` (it was the absolute artifact directory, D22-8) and its provenance in the manifest
  (`simulator.runner`: the profile, the observed install digest, the labels, the seed, the host-added variable names). It passes its
  tenant as the holder and waits for a slot up to `DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS`. It writes no file of its own any more (it
  wrote the deck, the manifest, the source map, both logs and the scalars into a directory it never removed).
- **`/api/simulate`**: seeds and screens its deck (`assertNetlistSafe`), runs it (10 s, raw bound 20 MB, its tenant as the holder),
  answers as before, adds `runner` (the provenance) to a success, and answers 503 with the closed text when the runner refuses before
  any process. It no longer creates or removes a directory or defines a reader; `readBoundedRawFile` lives in the runner and is
  re-exported here.
- **The smoke test**: seeds and screens its deck as before (SEC-1's final screen, no control block), runs it (10 s, no raw file, its
  tenant as the holder, its request's abort passed through) and adds `runner` to its answer; a refusal is the route's closed 422.
- **The reproducibility bundle** (`/api/spice/runs/[id]/bundle`) reads no file any more: its whole read of `result.raw` from the
  artifact directory is gone (D22-8). [B22-A3 review] regressions-3: the raw file is not kept, but the worker records its SHA-256 and
  size as the runner read them in the manifest (`rawOutput`), the README names them, and `docs/spice-studio.md` no longer promises a
  "complete" or "reproducible" bundle. RECORDED loss: the vectors ngspice wrote - including the non-finite values the parser drops
  (D22-10) [B22-C review, 2026-10-02] (the parsers no longer drop them: such an output is refused whole and the run fails with its
  closed code, keeping its logs, its manifest and `rawOutput`) - are not in the bundle; `waveforms.json` is the parsed record. Today a completed Studio run's result is dropped before it
  reaches the record (D22-7, B22-C), so `rawOutput` is visible in a record only once B22-C lands. [B22-C, 2026-10-02] It lands: the
  job store attaches the result before it publishes the terminal status, so a completed record carries its manifest and `rawOutput`
  (`simulation-authority.md`).

## 6. Results: labels, provenance, no host path

Every runner record carries `labels: ["diagnostic_only", "environment_dependent"]`, the profile id, the profile's digest, the observed
install digest (`sirkit-install-tree-sha256/1:<hex>`; null only when nothing ran), `killReason`, and `hostAddedEnvironment`; the
provenance a response or manifest carries adds the seed. The run id is `diagrun_<uuid>`.

**No host path.** The run directory and the install root are redacted from stdout, stderr and every progress chunk (`{runDir}`,
`{installRoot}`, either slash). [B22-A3 review] security-4, coverage-4, tests-7: redaction runs on the stream, not on each pipe read -
a trailing piece that could begin one of those paths is held (at most the longest path less one character) until the next read
completes or disproves it, a trailing fragment at the end is replaced by its placeholder, and the collector receives redacted text only,
so neither a path split across reads (red: the streamed chunks carried `l\Temp\` and `Temp\si`) nor the output bound's cut (red: the
kept tail began inside the install root and kept its folder name) leaves a fragment (case 11). coverage-2, tests-5: the runner's own
`mkdir`, `mkdtemp` and deck write are wrapped - Node's messages name the absolute path, the refusal names the errno only (red: the smoke
test's 422 carried `EACCES: permission denied, open 'C:\Users\...\deck.cir'`; case 9, 13). So no record or response carries the run
directory or the install root (case 11, 13). Nothing in a record calls the run a sandbox or authoritative.

**The environment the child sees.** [B22-A3 review] security-1: on win32 Node (libuv `required_vars`, src/win/process.c) copies the
server's value of each required variable the passed map lacks. The map passes PATH, SystemRoot and TEMP, so the child also receives the
server's `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN`, `USERNAME`, `USERPROFILE` and `WINDIR` (RECORDED from
libuv; CONFIRMED on this host by the review's benign probe, which this increment did not repeat). Every record names them
(`hostAddedEnvironment`; case 2, 12) and the provenance carries the names, never a value. None is a secret; `USERPROFILE` means a home
`.spiceinit` would be found, so `-n` (p23) is the one layer that keeps it from running, not a second one (D22-5's environment half is
reopened for these eight, OD-156). Giving each an explicit neutral value would need A2's validator to admit `USERPROFILE`,
`HOMEDRIVE` and `HOMEPATH` keys and the lead's probes of ngspice under them; not done here.

## 7. Test-first record, measurements and gates

Every run under the global heavy-job lock (`run.sh`, two workers; `heavy.sh` for tsc, eslint and tsx), every exit code captured; no
live suite, no browser spec, no full suite; no real process was started by the work or by any suite.

- **Baseline** on the clean tree `c037627` before any edit: A (computation, spice, simulate, CI guard) 18 files, 476 passed, 3 skipped,
  exit 0; B (`app/api/__tests__`, 27 files) 1 failed / 1,058 passed, exit 1 - `b16-0-identity-header-gate` "no browser/client module
  imports the server auth core" timed out at 120 s (the synchronous case ran 1,468 s), on the clean tree, before any edit; C (14 auth
  confinement and classification gates) 159 passed; D (MCP server and import gates) 22 files, 220 passed; E (B21 orchestration) 49
  files, 460 passed.
- **Red first.** The runner module was drafted before its suite; it was moved out of the tree for the red run. Red 1 (runner absent):
  `b22-a3-diagnostic-runner` failed to load (no module); `b22-a3-single-spawner` 4 failed of 4 (three SPICE files imported
  `child_process`; one failure was a test bug - the SPICE-tree count bound, 40, was wrong at 34 - fixed before any production edit);
  exit 1. Red 2 (runner restored, the profile and the callers unmodified): 7 failed / 11 passed (cases 1, 2, 10, 13 on the missing `-n`
  and the legacy spawns, 14 on the missing page; single-spawner 1, 2 on the legacy spawns); exit 1. An unhandled rejection in case 3 (two
  refusals created before either was awaited) was a test bug, fixed.
- **Green**: `b22-a3-diagnostic-runner` 14 passed, `b22-a3-single-spawner` 4 passed, `b22-a3-runner-live` 4 skipped (opt-in); the
  timing-bounded cases repeated three times with `b22-a1-diagnostic-bounds` and SEC-1's suite: 291 passed each time (SEC-1's 268 cases
  unchanged), exit 0.
- **Deliberate breakages** (each applied to the source, run against the two A3 suites, then restored and checked by hash:
  `diagnostic-runner.ts` and `runtime-profile.ts` identical before and after): MA `-n` dropped from the run template (runner cases 1,
  2, 13); MB the server environment spread into the child's (2, 13; single-spawner 3); MC the digest comparison disabled (3, 4, 9); MD
  a run settled at the kill, before the child's close (6, 8, 12); ME no removal in `finally` (3, 8, 9); MF the cap ignored (10); MG
  no redaction (11); MH taskkill without `/T` (6; single-spawner 3); MI an unseeded deck admitted (3); MJ the cached digest trusted
  without its fingerprint (4). Ten of ten caught, each exit 1.
- **The review's fixes (2026-10-01).** The suite was strengthened inside its fourteen cases and run on the reviewed tree first: 12
  failed / 2 passed (exit 1; cases 5 and 7 passed - case 5's new assertions pin a property the code already held, tests-1). The cases
  stop at their first failure, so a temporary probe suite (nine isolated reproductions, deleted after its one run) recorded each
  defect red on the reviewed tree: a queued request still waiting after 1,000 ms (regressions-1); no `rawOutput` (regressions-3); a
  chunk delivered after `kill_unconfirmed` and a cancelled Studio record back at "running" (security-3); streamed chunks carrying
  `l\Temp\` and `Temp\si` and a cut output keeping the install folder's name (coverage-4, tests-7); an abort's unconfirmed kill answered
  504 "timed out" (coverage-1); no tree kill after the smoke request's abort (security-2); the smoke 422 carrying the absolute deck path
  (coverage-2, tests-5); the stale records (coverage-5, coverage-8, security-1). One red was a test bug (case 13 started a Studio plan
  from a second project with the first project's plan id), fixed before the page; then green: `b22-a3-diagnostic-runner` 14 passed,
  `b22-a3-single-spawner` 4 passed, `b22-a3-runner-live` 5 skipped (opt-in; case 5 is new), exit 0.
- **The review's deliberate breakages** (each applied to the FIXED source, run against `b22-a3-diagnostic-runner`, then restored and
  checked by hash; every touched file identical before and after): N1 `tighter` without `Math.min` (cases 5, 8; tests-1); N2 a tie
  goes to the later waiter (10; tests-6); N3 no abort check after the pin check (4; tests-10); N4 the helper's `mkdtempSync` without
  `confined` (9; tests-8); N5 the worker reports `kill_unconfirmed` as cancelled (13; tests-2, coverage-1); N6 `/api/simulate`'s 503
  branch removed (13; tests-3); N7 the worker's early pin check removed (13; tests-3); N8 output after settling reaches the callback
  (8; security-3); N9 the job store's terminal-event guard removed (8; security-3); N10 no held path prefix in the stream redactor (11;
  security-4, coverage-4, tests-7); N11 the raw fs error rethrown (9, 13; coverage-2, tests-5); N12 a wait bounded only by the
  longest wait (10; regressions-1, coverage-3); N13 no per-holder running share (10; security-2); N14 a deck's own seed admitted (1;
  regressions-4); N15 no shared pin check (4; security-2); N16 no host-added names (2, 12, 13; security-1); N17 no `rawOutput` (13;
  regressions-3). Seventeen of seventeen caught, each exit 1. The first attempt at this pass called `bash` from Python, which on
  Windows resolved to `System32\bash.exe` (the WSL launcher): seventeen calls exited 1 at once, no test ran, and the WSL VM started
  (13:44:43) and shut itself down within three minutes; nothing of this work ran inside it. The pass was rerun with Git Bash by
  absolute path (RECORDED).

## 8. Pin moves (each reviewed; the same property re-pinned at the runner)

- `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts` - `APP_SPAWNERS` moved ONCE to the new exact list (the diagnostic
  runner, FreeRouting's runner, kicad-cli's runner): the three ngspice sites became one spawner (OD-136); case 1's title follows.
  Line-neutral.
- `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` - line-neutral (the discovery's `:744`, `:781-789`, `:879-885`, `:925-933`
  still resolve): the literal allowlist (`:744-745`) became the runner's exact environment keys (HOME and USERPROFILE gone, D22-5;
  LC_ALL and TZ added, D22-11); "equal across three spawners" (`:925-933`) became "one runner": the three sites carry no allowlist and
  the runner passes the profile's map; the env cases now also pin the keys exactly; the `-v` probe is found by `-v` anywhere (its argv
  is `-n -v`); the deck is `deck.cir` (was `executed.cir` and `smoke.cir`); the suite pins a fake install. Its 268 cases are unchanged.
- `app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts` `:84-94` and `b16-0-24-tranche17-confinement-gate.test.ts`
  `:119-147` - line-neutral: the spawn, argv, `windowsHide`, no shell, per-run directory and cleanup are re-pinned at the runner, the
  routes pinned to spawn nothing; the B16.0.23 gate now pins the environment too (D22-5's open item); `/api/simulate` keeps
  `PROCESS_TIMEOUT_MS` and `MAX_RAW_BYTES` as its constants, `NGSPICE_EXECUTABLE` and `MAX_OUTPUT_BYTES` are gone.
- `app/api/__tests__/b16-0-24-1-security-correction.test.ts` SOURCE GATE - the route passes `readBackBytes: MAX_RAW_BYTES` and the
  runner reads `result.raw` with `readBoundedRawFile` (no `readFile` anywhere); the reader's own seven cases are unchanged (the route
  re-exports it).
- `app/api/__tests__/b16-0-23-tranche-parity.test.ts` - the smoke spawn's executable is the pinned install's and its argv
  `-b -n deck.cir` (was the worker's `NGSPICE_EXECUTABLE` stub and two elements); `b16-0-24-tranche-parity`, `b19-d-deck-injection`,
  `b22-a1-diagnostic-bounds` and `b22-a1-model-screen` pin a fake install (`_pinned-ngspice.ts`); `b22-a1-diagnostic-bounds` serves the
  raw file through a file handle (the runner's bounded reader) and finds the probe by `-v` anywhere; `b22-a1-model-screen` reads
  `deck.cir`.
- `app/lib/computation/__tests__/b22-a2-runtime-profile.test.ts` - the ngspice argv templates gain `-n` (revision 2); case 13: the three
  sites keep no allowlist and the profile records no legacy spawn (was each site's allowlist equal to the record).
- `app/lib/computation/__tests__/b22-a2-process-census.test.ts` and `threat-model.md`'s census table - the ngspice spawner is the
  runner (reached through the job store and the worker by the four record routes); the bundle's exemption reason no longer says it zips
  files.
- `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md` section 10 - the citations into the smoke test, the worker and the
  bundle route moved to the lines that hold them now; C39-C43 name the code that replaced what they cited (marked in the row).
  [B22-A3 review] The review's edits moved them again (the worker, the job store, the smoke test, the bundle route and the runner):
  each moved row says so, with its former line.

- Records given a dated `[B22-A3]` note (records, not pins): `/api/simulate`'s header,
  `artifacts/ai-control-plane-b16-0-23/simulator-execution-boundary.md` (it listed no environment),
  `artifacts/ai-control-plane-b16-0-24/human-truth-contract.md` (the changed failure texts), `runtime-profiles.md` (revision 2, no
  legacy spawn) and `threat-model.md` (T3, T4, T6, T7, T9, T14, T15 and section 5). `.env.example` and `docs/spice-studio.md` document
  the two settings in place of `NGSPICE_BIN`. The opt-in `worker-integration` suite's artifact-id pin moved to the opaque run id.
  [B22-A3 review] coverage-8: `artifacts/ai-control-plane-b16-0-24/simulate-process-security-proof.md` and
  `artifacts/ai-control-plane-b16-0-24-1/bounded-file-read-proof.md` gained a dated "SUPERSEDED IN PART - B22-A3" section; the threat
  model's control cells for T4, T6, T7, T9 and T14 and its adversary paragraph now state the runner as current (they kept pre-A3
  facts); `docs/spice-studio.md` lost the `engine_missing` sentence (no code emits it), the "complete" bundle and "the same worker";
  security-1: `simulator-execution-boundary.md`, `runtime-profiles.md` (the `environmentInheritance` row and the home `.spiceinit`
  sentence) and threat-model T3 and T4 name Node's eight win32 additions; regressions-4: the profile's seed note and
  `runtime-profiles.md` say a deck with its own seed is refused (the note said "overridden, INFERRED").

## 9. What stays open (recorded, not closed here)

- **No OS limit of any kind** (CPU, memory, processes, file size, network) on this Windows host: no job object (OD-145). The runner is
  prevention plus bounds, not isolation; production authority stays BLOCKED (LB-10).
- **The Studio record's cancel** (`job-store.ts` `cancelInternal`, pinned by B16.0.23 §E/§F): the record is marked `cancelled` at the
  request; the runner's process ends after (or as `kill_unconfirmed`), and the worker's later result is dropped by the terminal guard.
  The record-level ordering is B22-C's, with D22-7. [B22-C, 2026-10-02] D22-7 is closed (the result is attached before the terminal
  status is published); the cancel-at-request ordering itself is unchanged and stays recorded (B16.0.23 §E/§F pins it).
- **Node's win32 environment additions** (section 6; OD-156): the eight variables are recorded, not removed. Whether ngspice's own
  `echo` sees `USERPROFILE` is the live suite's new case 5 (yes/no answers only).
- **Descendant reach** of `taskkill /T` (section 3): **INFERRED**; no case shows it.
- **Fairness is by tenant only** (OD-155): within one tenant, one project's batch can make another project's smoke test wait (at most
  its 10 s) and then refuse it BUSY; a refused Studio point fails and the batch moves on (the job store's loop). Two server processes
  have two counters.
- **Links**: the runner root is created with `mkdir`; a pre-planted link there, or a raw file that is a link, is not refused (B22-D
  item 4). The run directory itself is `mkdtemp`'s. [B22-D, 2026-10-02] Closed for both: the runner creates its root or, when one
  exists, runs only if `lstat` shows a plain directory (a link, a junction or a file is refused `NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED`),
  and reads the raw file only when `lstat` shows a plain file with one name (a link, a junction, a hardlink, a directory, a FIFO or a
  device is `not-a-plain-file`, never opened; `adversarial-matrix.md` G2, G3; `b22-d-adversarial` cases 3, 4). RECORDED: a process of
  the server user can still swap either between the check and its use, and a link it plants before the spawn redirects ngspice's own
  write (the lead's live case 4).
- **Redaction** covers the run directory and the install root as the runner spells them (either slash), across pipe reads and the
  output cut; a short-name or differently cased spelling printed by ngspice is not redacted (INFERRED rare).
- **The seed line**: a deck that sets its own seed is refused at the runner, so a Studio plan whose solver profile carries a `seed=`
  custom option fails each point with the closed text rather than at `POST /api/spice/runs` (the run-plan preflight is the job
  store's, B22-C); [superseded 2026-10-02 by the B22 closeout (OD-157): B22-C added no run-plan seed preflight - a Studio plan whose solver profile sets seed= or rndseed still fails each point at the runner; recorded open] a deck whose model text carries its own `.end` ends there for ngspice, before the seed line (such a deck is broken
  anyway).
- **The raw file** is kept only as its digest (section 5); [B22-C, 2026-10-02] the parsed output is now refused whole instead of dropping, through the one output validator; before: the parsed waveforms drop non-finite values (D22-10, B22-C).
- **Version**: whether `-n -v` prints the version line under the exact environment is the live suite's (case 2); a failed probe
  degrades to a fixed text, as before.
- **Dev reload**: the counter lives on `globalThis` and survives a module reload; two server processes have two counters.
- FreeRouting and kicad-cli keep their legacy spawns (direct-child kill, host allowlists, before-exit resolution at `runner.ts:166, :171`
  and `kicad-cli-runner.ts:57`): B22-B/D [superseded 2026-10-02 by the B22 closeout (D22-9, OD-145): neither B22-B nor B22-D took them - both runners still kill the direct child and resolve before its exit (`adversarial-matrix.md` section 8, finding 2); open]; not the same two lines as the ngspice fix, so not done here.
- The B16.0.24 "sandbox" sentences in `/api/simulate`'s header stay for the closeout (D22-14); the route's header carries a dated
  B22-A3 note. [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): done: the header and the B16.0.24 records carry the closeout's dated notes]

## 10. Final runs

All on the final tree after the review's fixes, each under the lock with its exit code captured.

- **A** - `app/lib/computation/__tests__`, `app/lib/spice/__tests__`, `app/api/simulate/__tests__`, the CI guard
  (`b19-e-ci-job-scope`), the B16.0.23 and B16.0.24 tranche parity suites, `b16-0-24-1-security-correction`, the B16.0.23 and B16.0.24
  confinement gates and `b20-b4-process-gate`: 25 files passed, 2 skipped (the opt-in `worker-integration` and `b22-a3-runner-live`),
  610 passed, 8 skipped (the live suite's new case 5); exit 0. The three A3 suites ride the existing `app/lib/computation/__tests__`
  filter (OD-146): no CI line added, the guard green.
- **B** - `app/api/__tests__` but `b16-0-identity-header-gate` (26 files): 1,053 passed; exit 0 (the baseline's 1,058 + 1 failed
  minus that gate's 6). That gate timed out on the clean tree before any edit (section 7); run alone on the final tree it passed: 6
  passed, exit 0, 61.0 s (its one case is a synchronous scan of about 50 s, which two busy workers pushed past its 120 s bound). It
  reads client modules and the server auth core, which A3 does not touch.
- **C** - the auth confinement, classification, route-tree, CSRF and body gates (16 files, including `b16-0-20`'s 501 pins, the
  B16.0.2 CSV byte pin and, for the smoke test's new `exposeAbortSignal`, `b16-0-22-tranche15-confinement-gate`): 183 passed; exit 0.
- **D** - `app/lib/mcp/server/__tests__` (the process gate, the MCP closure, `b20-d3`) and the B14.4, B15.3 and B18-B import gates: 22
  files, 220 passed; exit 0. The runner is not in the MCP routes' closure.
- **E** - B21's `app/lib/agent/orchestration/__tests__`: 49 files, 460 passed; exit 0.
- The timing-bounded cases (the fake-timer jumps of cases 8 and 13, the queue deadline of case 10) repeated three times with
  `b22-a1-diagnostic-bounds` and SEC-1's suite: 291 passed each time, exit 0. A later single run of the runner suite failed cases 6
  (a 5 s test timeout at 7.7 s) and 13 (529.8 s): the host entered Modern Standby during that run (the System log's Kernel-Power
  506/507 events: 14:00:07, 14:00:17 to 14:09:04), and case 13's duration is that window (RECORDED). Rerun after wake with the
  other A3 suites, `b22-a1-diagnostic-bounds` and SEC-1's: 295 passed, 5 skipped, exit 0.
- `tsc --noEmit -p tsconfig.json`: exit 0. `eslint` on the 27 changed or new TypeScript files: exit 0.
- Generators `generate-b16-0-2-artifacts.ts`, `generate-b16-0-4-artifacts.ts` (165 + 165 rows), `generate-b16-0-7-artifacts.ts`
  (165 / 162 / 3 / 0) and `generate-b16-0-8-baseline.ts` (3 -> 3): each exit 0, zero drift (the status, the diff and every untracked
  file's hash identical before and after). No route was added; the census stays 165 = 162 canonical + 3 factories + 0 raw.
- `b11-5-capture-exactness` case 12 ("NO test anywhere in the repository writes under app/, lib/, scripts/ or artifacts/") fails on
  the clean tree on `b22-a1-tool-output-bounds` and `b22-a2-runtime-profile` (their temporary fixture writes; RECORDED, not in A1's or
  A2's gates, not in CI). That case scans `*.test.ts` files only, so it never reads `_pinned-ngspice.ts`, where A3's fixture writes
  live: [B22-A3 review] tests-8 - the helper's confinement is asserted by `b22-a3-diagnostic-runner` case 9 instead (every write
  primitive takes its path through `confined`, which refuses a path outside the OS temporary directory before any write).
- Files are LF only, with no control byte; the reserved files are untouched.

## 11. The review (2026-10-01): what each confirmed finding changed

The adversarial review's confirmed findings, each fixed test-first (section 7):

| finding | fixed by | pinned in `b22-a3-diagnostic-runner` |
|---|---|---|
| regressions-1, coverage-3 | every wait for a slot bounded: the request's wall clock by default (10 s for `/api/simulate` and the smoke test), `DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS` for a Studio point, then BUSY (OD-155) | 1, 10, 13 |
| security-2 | per-tenant shares (3 running, 32 waiting), fewest-running-first order, the smoke test's abort wired, the early pin check single-flight (OD-155) | 1, 4, 10, 13 |
| regressions-3 | the raw file's SHA-256 and size in the manifest (`rawOutput`) and the bundle README; the Studio docs corrected | 13, 14 |
| regressions-4 | a deck that sets its own seed refused (closed), the seed in the provenance | 1, 3, 12, 13 |
| security-1 | Node's eight win32 additions recorded per run (`hostAddedEnvironment`) and every record that claimed "nothing inherited" corrected; D22-5's environment half reopened for them (OD-156) | 2, 12, 14 |
| security-3 | no callback after a run settles; the job store never reopens a terminal record | 8 |
| security-4, coverage-2, tests-5 | the runner's fs steps refused closed (`NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED`, the errno only) | 9, 13 |
| security-4, coverage-4, tests-7 | redaction on the stream, before the collector | 11 |
| coverage-1, tests-2, tests-3 | `killReason` on every record; each entry point's answer to every outcome and refusal pinned (section 3's table) | 6, 8, 12, 13 |
| tests-1 | a looser wall clock, read-back bound and kill-confirm wait each held to the profile's | 5, 8 |
| tests-6 | two live waiters of one holder granted in order | 10 |
| tests-8 | the fixture helper's writes confined and asserted | 9 |
| tests-10 | an abort during the pin check: cancelled, nothing spawned | 4 |
| coverage-5, tests-4 | live case 4 and this page say what it shows (the direct child); descendant reach INFERRED | 14 |
| coverage-8 | the B16.0.24 proofs, the threat model's cells and the Studio docs corrected | 14 |

## 12. The B22 closeout's export record (2026-10-02)

[B22 closeout, 2026-10-02] The B22-A3 exports no production source calls, each with why it exists (D22-16's closeout record;
`closeout-statements.md` section 3, re-derived from the tree by `b22-closeout-statements` case 8). **CONFIRMED** by `git grep` and
that case on `c9fbbb0` with the closeout's edits:

- `__setDiagnosticRunnerHostForTests` and `__resetDiagnosticRunnerCachesForTests`: **test seams** - the runner suites' scripted host
  and the reset of the cached digest, the check in flight and the version lines between cases; production never replaces the host.
- `diagnosticRunnerState`: a **test oracle** - the load and digest counts the runner suites assert. Its comment says "for tests and
  diagnostics"; no diagnostics surface reads it (**RECORDED**).
- `readBoundedRawFile`, re-exported by `app/api/simulate/route.ts`: a **test seam** for the B16.0.24.1 suite that pins it
  (`b16-0-24-1-security-correction`); the production read is the runner's own (section 6). Repointing that suite would be a pin move
  of an older chapter's suite, so the re-export stays.
- `print-install-tree-digest.ts` (`scripts/`): an **operator tool** - how the owner pins the install (section 2, OD-135); the
  runner's refusal text points to it; no package script names it, by design.
- The mock key `b16-0-2-spice-scope-isolation.test.ts` still sets for the worker module's executable export, which B22-A3 removed:
  dead, kept so the range the discovery cites (`:72-233`) does not move; noted in place on its line.
