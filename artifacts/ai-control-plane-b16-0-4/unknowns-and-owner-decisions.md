# B16.0.4 — Unknowns, owner decisions, analyzer soundness boundary, and scope adherence

Truthful limits of what this stage proves, and the decisions left to the owner.

## Owner decisions

1. **Media-type (415) enforcement was NOT retrofitted onto the 49 migrated
   routes.** The stage's refusal standardization names 415 for unsupported
   media types; the audited wrapper supports it (`requireJsonContentType` →
   415), but retrofitting a Content-Type check onto every existing route would
   change accepted behavior mid-stage (clients that post JSON without the
   header today would start being refused) and risk exactly the functional
   regressions the stop condition forbids. The bounded reader enforces the
   load-bearing bounds regardless of the header (wire ceiling, deadline, fatal
   UTF-8, JSON parse — a non-JSON body is refused 400 either way). **Owner
   decision:** whether to adopt strict 415 semantics per route family (the
   wrapper makes it a one-line opt-in) in a later stage.
2. **Request-rate / quota limiting on public compute routes** is outside this
   stage's per-request bounds and remains an infrastructure concern
   ([public-body-abuse-surface.md](public-body-abuse-surface.md)).
3. **Adopting the audited wrappers for existing guard-first routes** — the 118
   guard-first methods pass the analyzer as-is; migrating them to
   `authenticatedJsonRoute` would upgrade their dominance guarantee from
   "analyzer-verified" to "true by construction". Optional, incremental.
4. **R9** (below) still needs a live-Supabase owner verification session.

## What is proven

- Every protected exported HTTP method (**121**) proves its own load-bearing,
  dominant authorization boundary; 10 negative tripwires fail if the analyzer
  regresses.
- Every `app/api` handler (**49 migrated**) reads its body through the one
  bounded reader; **0** direct unbounded reads remain, enforced by an automatic
  discovery gate with no allowlist.
- The bounded-body contract (ceiling, deadline, abort, UTF-8/JSON refusal,
  exactly-one settlement) holds behaviorally on real handlers per family.

## Analyzer soundness boundary (honest)

`analyzeMethodBoundary` is a **conservative static** analysis, not a theorem
prover. Its guarantees and limits:

- It **fails closed**: any method whose guard shape it cannot positively
  classify is rejected. This can produce false *rejections* (a genuinely safe
  but unusual shape), never silent false *acceptance* of the modelled hazards.
- It recognises a **closed set** of audited shapes (wrapper, guard-first A/B,
  factory delegation up to depth 4). A new authorization idiom must be added to
  the audited set (or use the wrapper) — it will not be auto-accepted.
- Factory following resolves imports from disk with **bounded depth and
  memoisation**; an opaque/unresolvable factory is treated as dangerous.
- Purity is computed over **module-top-level** declarations; a pathological
  handler that reassigns module state through aliasing the analyzer cannot see
  would be rejected (fail closed), not accepted.
- The dominance check reasons about **method-entry ordering of awaited
  side-effecting calls**, not arbitrary runtime control flow. The audited
  wrapper is the strongest guarantee because it makes dominance true **by
  construction** (the callback cannot run until the boundary succeeds); routes
  that want a proof independent of AST heuristics should adopt it.

## Residual risk carried forward

- **R9 live-Supabase behaviour is UNKNOWN** — production auth-mode paths are
  proven by injected principals and stubbed membership, never against a live
  Supabase project (the stage forbids contacting a live database). Live
  production verification remains open, as recorded since B16.0.1.
- Perf tests (e.g. `route-tool` "catastrophic slowdown") are **wall-clock
  sensitive** and can false-positive under heavy parallel load; they pass in
  isolation and under bounded-worker validation. See
  [test-and-validation-report.md](test-and-validation-report.md).
- The `onTaskUpdate` worker-timeout surfaced by vitest under maximal
  parallelism is a **reporter/worker infra artifact**, not a test failure;
  bounded-worker validation exits clean.

## Scope adherence (STOP CONDITION)

Confirmed NOT done, by explicit stage instruction:

- No work on **B16.1**, **MCP**, **multi-agent orchestration**, **manufacturing
  expansion**, **provider expansion**, or **new AI-tool exposure**.
- Work confined to `C:\Users\robsa\Desktop\sirkit-edit`;
  `C:\Users\robsa\sirkit` was never modified.
- **No provider credits spent**; **no live database contacted or mutated**.
- **No security test weakened, deleted, skipped, or broadly excluded** — the one
  security-test edit (admitting this stage's factory-fixture test into the
  b11-5 §D test-write gate) *adds* an enforced OS-temp-confinement invariant via
  the gate's own documented `justified` mechanism.
