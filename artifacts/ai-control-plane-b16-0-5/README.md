# B16.0.5 — Analyzer soundness, request-taint body bounds, media-type & wrapper integrity

Independent verification REJECTED B16.0.4's security verdict. B16.0.5 reproduces
each counterexample against the current tree, closes it fail-closed, and adds a
permanent regression for it.

## The five closures

| # | Reported defect | Closure |
|---|---|---|
| A1 | `analyzeMethodBoundary` accepted wrong-polarity (`if (a.ok) return`) and unrelated-binding guards | Polarity-correct, load-bearing refusal recognition ([method-scoped-authorization-proof.md](method-scoped-authorization-proof.md)) |
| A2 | wrapper recognized by local name → `./evil` and aliased-symbol laundering passed | Canonical module + original-symbol resolution; re-export/same-named/aliased all REJECT |
| B | `directBodyReads` missed helper-forwarding, destructuring, property extraction, nested alias, call/apply, element access, clone | Interprocedural request-taint engine ([request-body-taint-tracking.md](request-body-taint-tracking.md)) |
| C | JSON routes accepted text/plain & missing Content-Type (400, not 415) | 415 before the first body pull at the reader chokepoint + the 2 stream routes ([media-type-enforcement.md](media-type-enforcement.md)) |
| D | audited wrapper passed the raw `Request` to callbacks | Callbacks receive only `{ context/principal, body, bytes, meta }` |

## Results at a glance

| Metric | Value |
|---|---|
| Reproduced counterexamples now failing closed | **all** (C1, C1b, C1c, C2, C2b, C3a–h, media types) |
| Protected methods still load-bearing (no over-rejection) | **121 / 121** (0 rejects) |
| Direct unbounded body reads across production routes (taint-aware) | **0** |
| JSON routes enforcing 415 before body pull | all (49 reader routes + 2 stream routes + scoped/wrapper) |
| Media-type fallout fixed by sending correct Content-Type | 7 tests / 5 files (no assertion weakened) |

## Documents

| Doc | Section |
|---|---|
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Recorded PRE-EDIT reproductions |
| [post-edit-results.md](post-edit-results.md) | Recorded POST-EDIT (all fail closed) |
| [method-scoped-authorization-proof.md](method-scoped-authorization-proof.md) | §A polarity + canonical wrapper/factory |
| [request-body-taint-tracking.md](request-body-taint-tracking.md) | §B taint engine |
| [media-type-enforcement.md](media-type-enforcement.md) | §C 415 enforcement |
| [wrapper-integrity.md](wrapper-integrity.md) | §D callback surface |
| [method-authorization-matrix.csv](method-authorization-matrix.csv) | Regenerated per-method verdict (corrected analyzer) |
| [request-body-boundary-matrix.csv](request-body-boundary-matrix.csv) | Regenerated per-method body matrix |
| [changed-files.md](changed-files.md) | Every file changed, with why |
| [superseded-claims.md](superseded-claims.md) | What B16.0.4 claims are corrected |
| [test-and-validation-report.md](test-and-validation-report.md) | Suite counts + exit code, tsc, eslint, generators |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | Soundness boundary, R9, scope |
| [final-verdict.md](final-verdict.md) | Stop-condition item-by-item |

## Reproduce

```bash
npx vitest run app/lib/auth/__tests__/b16-0-5-analyzer-hardening.test.ts
npx vitest run app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts
npx vitest run app/lib/auth/__tests__/b16-0-2-gates.test.ts   # §A loop over all 121 + §C body gate
npx vitest run app/lib/http/__tests__/b16-0-2-bounded-json.test.ts
```

## Scope

No provider credits, no live DB, `C:\Users\robsa\sirkit` untouched. B16.1 / MCP
/ multi-agent / manufacturing integration / provider expansion / new tool
exposure NOT started. R9 live-Supabase UNKNOWN.
