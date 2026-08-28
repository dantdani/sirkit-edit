> **PARTIALLY SUPERSEDED BY B16.0.6 (2026-08-25).** Independent verification
> found eight more fail-open analyzer counterexamples (bare object negation,
> unawaited inline boundary, name-trusted/forged readers, assignment alias,
> body-stream forwarding, returned alias, and helper-depth escape). This stage's
> ANALYZER-SOUNDNESS items are therefore WITHDRAWN and re-established in
> `artifacts/ai-control-plane-b16-0-6/`; its runtime closures (415, wrapper
> provenance, raw-Request removal, the original counterexample closures) remain
> ACCEPTED. Retained as the historical B16.0.5 record.

# B16.0.5 — Final verdict (stop condition, item by item)

Every stop-condition item with its evidence. This verdict SUPERSEDES the
withdrawn B16.0.4 "all MET" verdict.

| # | Stop-condition item | Verdict | Evidence |
|---|---|---|---|
| 1 | Every protected HTTP method proves its own load-bearing boundary | **MET** | 121/121 protected methods pass the corrected `analyzeMethodBoundary` (the §A gate loop over the real tree is green); wrong-polarity/ignored/unrelated now REJECT |
| 2 | The actual `!authorized.ok` refusal branch is proven to terminate | **MET** | `bindingIsRefused`/`inlineBoundaryGuard` require a canonical NEGATION test with a terminating branch; C1/C1b fail closed ([method-scoped-authorization-proof.md](method-scoped-authorization-proof.md)) |
| 3 | Wrong polarity, unrelated binding, partial branch, unauthorized fallthrough rejected | **MET** | C1 (positive), C1b (compound/unrelated), C1c (partial branch) all REJECT — permanent tests in `b16-0-5-analyzer-hardening.test.ts` |
| 4 | Successful authorization dominates body/provider/db/durable/process/mutation | **MET** | guard-first dominance walk + taint-aware body-read check; a durable/provider/body call before the boundary REJECTS |
| 5 | Approved wrapper & factory imports resolve to exact canonical module + symbol | **MET** | `isCanonicalWrapper` resolves the exact `route-handlers.ts` path + original export name; factory uses the original imported name |
| 6 | `./evil`, aliased, same-named, re-export-laundered wrappers rejected | **MET** | C2 (`./evil`), C2b (aliased), same-named-local, and a re-export barrel fixture all REJECT |
| 7 | Request flow followed transitively through local/imported helpers | **MET** | interprocedural taint engine ([request-body-taint-tracking.md](request-body-taint-tracking.md)); C3a helper-forwarding detected |
| 8 | Aliases, destructuring, closures, property extraction, bind/call/apply, `request.body`/getReader tracked | **MET** | C3b–h + `request.body!.getReader()` all detected |
| 9 | Body consumption permitted only inside the canonical bounded reader | **MET** | canonical readers are the only unflagged sink; §C gate reports **0** offenders across production routes |
| 10 | Automatic negative tripwires for every reproduced bypass | **MET** | `b16-0-5-analyzer-hardening.test.ts` — one permanent test per counterexample |
| 11 | Every JSON POST/PUT/PATCH: application/json (±charset) accepted; text/plain, missing, other → 415 before first body pull, no-store, zero downstream | **MET** | reader chokepoint + 2 stream routes; per-family behavioral proof with 0 counted body pulls ([media-type-enforcement.md](media-type-enforcement.md)) |
| 12 | Intentionally non-JSON endpoints classified explicitly (not JSON-required) | **MET** | `requireJsonContentType` defaults true; explicit `false` opt-out pinned by a unit test; no production route opts out today |
| 13 | Wrapper callbacks receive no Request/Headers/Cookie/Authorization/raw body — only context/principal, parsed body, byte count, non-secret metadata | **MET** | callback inputs are `{ context/principal, body, bytes, meta:{method,pathname} }` — asserted in the §D test ([wrapper-integrity.md](wrapper-integrity.md)) |
| 14 | Supersede the inaccurate final-verdict and memory; do not delete history | **MET** | B16.0.4 `final-verdict.md` annotated + WITHDRAWN in place; [superseded-claims.md](superseded-claims.md); memory updated |
| 15 | Regenerate both CSVs only after the analyzer is corrected | **MET** | regenerated post-correction, byte-stable ×2 (121/32/0) |
| 16 | Full validation: B16.0–B16.0.5, tsc, ESLint, git diff --check, generators ×2, bounded-fork full suite | **MET** | suite 3348 pass / 0 fail / exit 0; tsc 0; eslint 0; git clean; 4 generators byte-stable ×2 ([test-and-validation-report.md](test-and-validation-report.md)) |
| 17 | Preserve exactly 12 exposed tools, replay pins, authoritative hashes, internal-only manufacturing release | **MET** | the B16.0.1 ci-gates / tool-registry / manufacturing-release gates passed within the 3348 |

## Out of scope / not started

- **B16.1, MCP, multi-agent, manufacturing integration, provider expansion, new
  tool exposure** — NOT started.
- **R9 live-Supabase production auth** — UNKNOWN (no live DB contacted).
- `C:\Users\robsa\sirkit` — untouched.

## Verdict

**All independently reproduced counterexamples fail closed.** B16.0.5 is
complete under its stop condition. Stopping here for independent verification.
