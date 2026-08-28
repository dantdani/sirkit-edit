# B16.0.6 — Unknowns, owner decisions, and the analyzer's REAL guarantees

## What the analyzer now guarantees (accurately)

- **Authorization**: for every protected exported method, a boundary whose
  RESULT CONTRACT is established by provenance (union / boolean), refused with
  the contract-correct discriminant (`!x.ok` awaited for union; `!x` for
  boolean, awaited if async), on a terminating branch that dominates all
  body/durable/provider/process/mutation work. A boundary of unknown contract is
  rejected. Wrong polarity, unrelated bindings, partial branches, ignored
  results, and unauthorized fallthrough are rejected.
- **Body/request flow**: a raw Request (or its body/stream/clone/methods) reaches
  a body sink ONLY through a canonical authority resolved by exact module +
  exported symbol; every other flow — including one the analyzer cannot resolve —
  is a violation. There is no traversal-depth limit that can return clean; the
  safe-consumer check is a memoized fixed point with cycles and unresolved
  callees rejected.

## Honest boundaries (what it does NOT claim)

- It is a **conservative, fail-CLOSED** static analysis, not a proof of runtime
  behavior. It errs toward rejection: an unusual-but-safe construct it cannot
  classify is rejected, never silently accepted.
- **Module identity** is trusted from the repository's own path resolution
  (`@/…` / relative). A build-time path-alias remapping that made a different
  file resolve to a canonical module path is out of scope.
- **Genuine boolean boundaries** are recognized only when they reach a
  provenance-pinned boolean terminal (`node:crypto` `timingSafeEqual`,
  `worker-principal.ts` `verifyWorkerSecret`). A new boolean boundary must reach
  one of those, or be added to `BOOLEAN_RESULT_TERMINALS` by exact provenance —
  never inferred from a name.
- **Reflection / dynamic dispatch** (`Reflect.get(request,'json')`, computed
  member names, a request escaping to a global) is not modeled as a safe path;
  such a construct causes a violation (unresolved) — fail closed.

## Owner decisions

1. **Boolean-boundary metadata.** The worker route's local `authorized` is
   accepted because it reaches `node:crypto` `timingSafeEqual`. If the owner
   prefers, the worker route can adopt the canonical `workerJsonRoute` wrapper
   (authorization + bounded body by construction) and drop the local boundary
   entirely — a follow-up, not required here.
2. **New canonical sinks / boundaries** must be added to `CANONICAL_REQUEST_SINKS`
   / the terminal contract lists by exact provenance when introduced.

## Residual risk carried forward

- **R9 live-Supabase production auth remains UNKNOWN** — no live database was
  contacted.
- Wall-clock perf tests remain load-sensitive (green in isolation and under the
  bounded-fork run); the vitest `onTaskUpdate` worker timeout under maximal
  parallelism is an infra artifact, not a test failure — see
  [test-and-validation-report.md](test-and-validation-report.md).

## Scope adherence

- Work confined to `C:\Users\robsa\Desktop\sirkit-edit`; `C:\Users\robsa\sirkit`
  untouched.
- No provider credits; no live database writes.
- No security test weakened — the §C tripwire updates adapt to the new
  flow-violation contract (detection unchanged in intent, stronger in fact); the
  b11-5 admission ADDS an OS-temp-confinement invariant.
- **B16.1, MCP, multi-agent, manufacturing integration, provider expansion,
  migrations, and new tool exposure NOT started**; exactly **12** exposed tools,
  replay pins, authoritative hashes, and internal-only release preserved.
