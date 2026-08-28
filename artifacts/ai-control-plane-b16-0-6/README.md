# B16.0.6 — Security-by-construction route boundaries

B16.0.5 was PARTIALLY ACCEPTED (its 415, wrapper provenance, and raw-Request
removal are kept). Its analyzer-soundness verdict was REJECTED: independent
verification found eight more fail-open counterexamples. B16.0.6 reproduces each,
closes it permanently, and states the analyzer's real guarantees.

## The three closures

| § | Defect | Closure |
|---|---|---|
| B | R1 bare object negation `if (!authorized)`; R2 unawaited inline `if (!authorizeRequest(req))` — refusal never runs | Result-CONTRACT analysis by provenance: union ⇒ awaited `.ok`; boolean ⇒ bare negation (awaited-if-async); unknown ⇒ reject ([authorization-result-contract.md](authorization-result-contract.md)) |
| C | R3/R4 readers trusted by name (`/^readBounded/`, forged local `readBoundedJsonObject`) | Exact module + exported-symbol provenance; name rules deleted ([canonical-reader-provenance.md](canonical-reader-provenance.md)) |
| D | R5–R8 + extras missed; depth-4 traversal returned clean past its limit | Fail-closed request/stream flow: a Request may reach only a canonical sink; helpers proven safe to a fixed point; cycles/unresolved reject ([request-and-stream-flow-enforcement.md](request-and-stream-flow-enforcement.md)) |

## Results at a glance

| Metric | Value |
|---|---|
| R1–R8 + extras now failing closed | **all** |
| Protected methods still load-bearing (no over-rejection) | **121 / 121** |
| §C flow violations across production routes | **0** |
| Full bounded-fork suite | **3366 pass / 0 fail / exit 0** |
| Runtime closures preserved (415, no-store, charset, bounds, wrapper isolation) | intact |

## Documents

| Doc | § |
|---|---|
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | recorded PRE-EDIT |
| [post-edit-results.md](post-edit-results.md) | recorded POST-EDIT (all fail closed) |
| [authorization-result-contract.md](authorization-result-contract.md) | B |
| [canonical-reader-provenance.md](canonical-reader-provenance.md) | C |
| [request-and-stream-flow-enforcement.md](request-and-stream-flow-enforcement.md) | D |
| [method-authorization-matrix.csv](method-authorization-matrix.csv) | regenerated (corrected) |
| [request-body-boundary-matrix.csv](request-body-boundary-matrix.csv) | regenerated (corrected) |
| [changed-files.md](changed-files.md) | — |
| [test-and-validation-report.md](test-and-validation-report.md) | G |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | real guarantees, R9 |
| [superseded-claims.md](superseded-claims.md) | withdraws B16.0.5's soundness claims |
| [final-verdict.md](final-verdict.md) | stop-condition item-by-item |

## Reproduce

```bash
npx vitest run app/lib/auth/__tests__/b16-0-6-analyzer-hardening.test.ts
npx vitest run app/lib/auth/__tests__/b16-0-2-gates.test.ts   # §A loop over 121 + §C flow gate
```

## Scope

No provider credits, no live DB, `C:\Users\robsa\sirkit` untouched, no route
source changed. B16.1 / MCP / multi-agent / manufacturing integration / provider
expansion / migrations / new tool exposure NOT started. R9 UNKNOWN.
