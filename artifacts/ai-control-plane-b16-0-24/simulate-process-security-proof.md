# B16.0.24 §G — /api/simulate process security proof

`POST /api/simulate` → `authenticatedJsonRoute({ maxBytes: 8_000_000,
deadlineMs: 30_000, exposeAbortSignal: true })`, hardened into a confined
ngspice sandbox.

- **Zero process work before authorization + validation**: the wrapper runs
  identity + membership + role + CSRF and the bounded 8 MB / 30 s object read
  BEFORE the callback; the callback then runs semantic validation (components /
  source / ground), the input control-char guard, netlist generation, and the
  netlist include/shell screen — and ONLY THEN `mkdtemp` + `spawn`. Gate: the
  guard-call indices precede the `runNgspice` call in source. Pinned:
  unauthenticated → 401 and every validation refusal → 400, each with ZERO
  spawns. **CONFIRMED**.
- **Server-owned executable**: `NGSPICE_EXECUTABLE` (env `NGSPICE_BIN` or the
  platform default) — a module constant, never body-derived. **CONFIRMED**.
- **Fixed argument vector**: `["-b", netlistPath]` where `netlistPath` is the
  server-created path inside the isolated dir. **CONFIRMED**.
- **`shell: false`** (explicit); no `exec`/`spawnSync`/shell anywhere.
  **CONFIRMED**.
- **Server-created isolated temporary directory**: `mkdtemp(join(tmpdir(),
  "sirkit-simulate-"))` per request (never the shared `tmpdir()` cwd);
  server-owned filenames `netlist.cir` / `result.raw`; cwd = the isolated dir;
  the raw path is the RELATIVE `result.raw`. **CONFIRMED**.
- **Minimal allowlisted environment**: `safeEnvironment()` — the exact worker
  allowlist (PATH/Path/PATHEXT/SystemRoot/WINDIR/TEMP/TMP/HOME/USERPROFILE/
  LD_LIBRARY_PATH + NODE_ENV), never the full inherited server env.
  **CONFIRMED**.
- **No network**: the deck carries no network directive (screened), and the
  runner performs no network I/O. **CONFIRMED**.
- **Strict timeout**: a server `PROCESS_TIMEOUT_MS` (10 s) kills the child →
  504. **CONFIRMED**.
- **Bounded stdout/stderr**: accumulation is `slice(-MAX_OUTPUT_BYTES)`
  (1 MB); the raw file read is `slice(0, MAX_RAW_BYTES)` (20 MB); the error
  body uses `stderr.slice(-3000)`. **CONFIRMED**.
- **Cancellation reaches the runner**: the wrapper's `signal` (via
  `exposeAbortSignal`) is wired to `child.kill()` on abort, without double
  settlement. **CONFIRMED**.
- **Deterministic cleanup in every path**: `finally { rm(directory,
  {recursive,force}) }` runs on success, refusal, timeout, abort, spawn-error,
  parse-error, and disconnect. **CONFIRMED**.
- **Unsupported/unavailable execution fails closed**: ENOENT →
  "ngspice executable not found on PATH" (500); no data → 500; no output file →
  500. **CONFIRMED**.
- **No live simulator in tests**: `node:child_process.spawn` (and the bare
  `child_process`) plus `fs/promises` are mocked; the §A success pin asserts
  exactly one no-shell spawn of the server exe. **CONFIRMED**.

---

## [SUPERSEDED IN PART — B16.0.24.1 §1]

"the raw file read is `slice(0, MAX_RAW_BYTES)` (20 MB)" claimed a memory
bound that did not hold: the full file was buffered before truncation.
Corrected in B16.0.24.1 to a truly bounded handle/chunked reader with an
explicit over-limit refusal — see
`artifacts/ai-control-plane-b16-0-24-1/bounded-file-read-proof.md`.
