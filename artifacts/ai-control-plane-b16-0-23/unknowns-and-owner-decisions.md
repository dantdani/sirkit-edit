# B16.0.23 — Unknowns & owner decisions

## Decisions taken

1. **New `querySelector` wrapper option** instead of dropping the header-less
   selector surfaces (EventSource/anchor downloads cannot send `x-sirkit-*`
   headers). The parsing is an exact port of the historical `_scope.ts`
   `querySelector`, lives INSIDE the wrapper, and is repo-wide gated to the
   five run-family GET readers only. **CONFIRMED**.
2. **Public trio stays public** — proven from behavior (serves anonymous
   callers today; pure compute call graph with no durable/execution reach).
   Adding authentication would be a behavior change to offline/client report
   and compile flows; not done. **CONFIRMED**.
3. **Two reproduced corrections** (§E/§F terminal guard, §G error split) —
   reproduced verbatim pre-edit, superseded with in-test notes and dedicated
   artifacts. **CONFIRMED**.
4. **Tool schemas relocated, not rewritten** — the 20 schemas are byte-
   identical to the former inline array (adapter parity proves reference
   identity); only their home moved beside the validator. **CONFIRMED**.
5. **Family scope helper retained** (`spiceRunScope`) for the standing
   scope-isolation + worker-integration suites; routes use the Request-free
   projector. **CONFIRMED**.

## Unknowns / owner-visible items carried forward

- **R9 live-Supabase production auth remains UNKNOWN** (no live network).
- **Remaining migration: 5 raw methods** (baseline 8) — the chat family and
  misc routes, plus the 3 factory routes. **CONFIRMED**.
- **smoke-test / /api/simulate spawns inherit the full server env** (no
  `safeEnvironment()` allowlist — unlike the run worker). This is a
  server-owned env, NOT caller-influenced, so it is not a caller-injection
  surface; consolidating it onto the worker's env allowlist would change the
  unavailable-runtime message and timeout/output caps and is therefore OUT OF
  SCOPE for a pure wrapper migration. Recorded for an owner decision.
  **INFERRED / owner-visible.** [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): no ngspice child inherits the server environment - every one gets the diagnostic runner's exact map (SEC-1, B22-A3; Node's eight win32 additions recorded, OD-156)]
- **`assertSafeDirective` does not blocklist `.include`/`.lib` names** — the
  compile route emits such directives into netlist TEXT it never executes; the
  execution path's separate `assertModelSafeForExecution` refuses absolute
  include paths + unresolved dependencies before any spawn. Pre-existing
  division of labor, preserved, recorded in
  [compilation-confinement-proof.md](compilation-confinement-proof.md).
  **INFERRED / owner-visible.**
- **/api/simulate is NOT in this tranche** (explicitly excluded by the
  mandate) and remains raw — it is one of the 5 remaining raw methods'
  siblings under `read`-class policy; untouched. **CONFIRMED**.

## Scope adherence

No provider credits, live simulators, real processes, network, or DB writes.
Protected original `C:\Users\robsa\sirkit` untouched. chat/simulate/auth
migration, B16.0.24, B16.1, MCP, multi-agent orchestration, provider
expansion, external model downloads, and simulator-runner expansion NOT
started.
