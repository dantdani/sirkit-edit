# B16.0.23 §F — simulator execution boundary

The execution authority is `app/lib/spice/server/worker.ts` (`executeRunPoint`,
`spawn` from `node:child_process`) driven by the in-process async pool in
`app/lib/spice/server/job-store.ts`. The only in-tranche route that spawns is
`models/smoke-test` (an isolated fixture spawn); run execution is reached only
indirectly via `startRunPlan`.

Proven (pins + source gates; no live simulator in any test):

- **Authorization + validation dominate execution**: smoke-test authorizes
  (WRITE_EDITORS + reviewer, CSRF) in the wrapper, then
  `assertModelSafeForExecution` + the fixture build, and ONLY then
  `execute()` — gate asserts the `assertModelSafeForExecution` index precedes
  the `execute(...)` index in source. Every refusal (auth, media, size,
  `.control`, unresolved dependency) returns with **zero `spawn` calls**
  (pinned via the fake-child seam's call log). **CONFIRMED**.
- **No shell, ever**: `spawn(NGSPICE_EXECUTABLE, ["-b", path], { ...,
  windowsHide: true })`; gate asserts no `shell: true` in the route or the
  worker, and there is no `exec`/`execSync`/`spawnSync` anywhere in the SPICE
  tree. **CONFIRMED**.
- **Server-owned process configuration**: executable = `NGSPICE_EXECUTABLE`
  (server env `NGSPICE_BIN` or platform default — never caller input); args =
  the fixed literal `["-b", <server-generated temp path>]`; cwd = a
  server-`mkdtemp` directory; timeout = server constant (10 s smoke / worker
  `DEFAULT_WORKER_LIMITS.timeoutMs` 120 s); output ceilings = server constants
  (100 KB smoke log cap / worker `maxOutputBytes` 100 MB / `maxWaveformPoints`
  5,000,000). Caller input reaches the process ONLY as validated model text
  written into the fixture deck — never as argv, env, path, or shell.
  **CONFIRMED**.
- **Pre-abort / cancellation**: a pre-aborted smoke-test request refuses in
  the wrapper's bounded read (400 AUTH_BODY_ABORTED) before any spawn (pinned).
  Run cancellation aborts the job's `AbortController`; the worker observes
  `signal`; and — the §E/§F correction — a late worker settlement can never
  overwrite a terminal record. **CONFIRMED**.
- **No live simulator invoked during tests**: the worker module is mocked to a
  controllable fake, and `node:child_process.spawn` is a scripted fake child
  (emits a canned close code). No real ngspice process is ever started.
  **CONFIRMED**.

## Not changed

Authoritative run execution is NOT expanded, enabled, or re-implemented in
this migration. The existing in-process worker/pool and its server-owned
limits are preserved exactly; no new runner was introduced. **CONFIRMED.**
