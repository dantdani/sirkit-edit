# B16.0.23 §C — SPICE compilation confinement

The public compile route (`publicJsonRoute`, 8 MB / 30 s) is a pure in-memory
transform: `compileCanonicalIr` → `auditCompiledIr` → `compileNgspiceNetlist`.

- **No simulator, no fs, no network, no process, no env** in the compile call
  graph. Gate: `app/lib/spice/{ir,netlist,readiness,report,run-plan}.ts`
  import no `node:child_process`/`node:fs`/`node:net`/`node:http`/`undici`;
  the route imports no job-store/worker/fs/process/network module.
  **CONFIRMED**.
- **Deterministic for identical pinned inputs** modulo the readiness audit's
  `checkedAt` wall-clock stamp (the ONLY volatile token in the compile
  response — the netlist text and IR summary are stable). The §A pin
  normalizes `checkedAt` and byte-compares the rest across two calls.
  **CONFIRMED**; the volatility is documented, not hidden.
- **Compile success ≠ simulation success**: the compile response carries
  `readiness`, `netlist`, and `irSummary` but NO `run` and NO simulation
  `status` field (pinned). A caller can never read a compile 200 as an
  executed/converged simulation. **CONFIRMED**.
- **Directive injection refused at emission**: `assertSafeDirective`
  (netlist.ts) refuses any custom directive that is not `.`-prefixed or
  matches `.control|.endc|.shell|.source|.cd|.quit|.destroy|.remcirc` or
  contains `!`/backtick — surfaced as 422. **CONFIRMED**.
- **Corpus confinement**: the compile route passes ONLY `analysisId` and
  `pinNodes` to `compileNgspiceNetlist` — never `modelPaths` or a raw output
  path — so it emits NO `.include` line and NO `.control` block; inline model
  text is the only path, embedded verbatim into netlist TEXT that this
  endpoint never executes. **CONFIRMED**.
- **No schematic/PCB authority mutation**: compile reads the caller-supplied
  project blob and returns a rendered artifact; it writes nothing durable
  (store untouched, pinned). **CONFIRMED**.

## Recorded scope note (INFERRED, unchanged this stage)

`assertSafeDirective` does NOT blocklist `.include`/`.inc`/`.lib` names
themselves — a custom directive `.include /etc/passwd` passes the emission
guard and is written into netlist TEXT. It is never executed by the compile
route (which spawns nothing). The EXECUTION path's separate
`assertModelSafeForExecution` (worker-only) refuses absolute include paths and
unresolved dependencies before any spawn. This pre-existing division of labor
is preserved exactly; it is recorded here as a known property, not introduced
by this migration. **INFERRED / owner-visible.**
