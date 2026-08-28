# B16.0.6 — Pre-edit counterexamples (recorded, current tree)

The eight reported fail-open counterexamples (plus the additional forms) were
reproduced against the B16.0.5 analyzer BEFORE any B16.0.6 edit, via the
disposable probe `scripts/_b16-0-6-repro.ts` (deleted after recording; the
permanent regressions live in
[`app/lib/auth/__tests__/b16-0-6-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-6-analyzer-hardening.test.ts)).

## A — Authorization (`analyzeMethodBoundary`)

| ID | Counterexample | PRE-EDIT actual |
|---|---|---|
| R1 | `const a = await authorizeRequest(req); if (!a) return …; <durable>` (bare object negation — a union result object is always truthy) | **ACCEPTED** — `ok:true` via guard-first ("authorizeRequest → authorized.ok refused") |
| R2 | `if (!authorizeRequest(req)) return …; <durable>` (unawaited — the Promise is truthy, the refusal never runs) | **ACCEPTED** — `ok:true` ("inline boundary guard returns on refusal") |

## B — Body/request flow (`directBodyReads`)

Each returned **`[]` (no offenders)** pre-edit:

| ID | Counterexample | PRE-EDIT |
|---|---|---|
| R3 | forged bounded-reader prefix `readBoundedEvil(request)` → `input.json()` | `[]` MISSED |
| R4 | forged EXACT reader name — local `readBoundedJsonObject` doing `input.json()` | `[]` MISSED |
| R5 | assignment alias `let alias; alias = request; alias.json()` | `[]` MISSED |
| R6 | body-stream forwarding `consume(request.body)` → `stream.getReader().read()` | `[]` MISSED |
| R7 | returned request alias `identity(request)` → `alias.json()` | `[]` MISSED |
| R8 | five-hop helper chain ending in `request.json()` (depth-4 escape) | `[]` MISSED |
| — | namespace-imported helper `helpers.read(request)` | `[]` MISSED |
| — | array container `[request]` → `arr[0].json()` | `[]` MISSED |
| — | destructure-assign `({ json } = request)` → `json.call(request)` | `[]` MISSED |
| — | stream returned from helper `getBody(request)` → `s.getReader()` | `[]` MISSED |

## Root causes

- **R1/R2**: the analyzer inferred refusal polarity from syntax without knowing
  the boundary's RESULT CONTRACT — `authorizeRequest` returns a discriminated
  object (`{ ok }`), so `!binding`/`!call` are never the refusal, and an
  unawaited async call is a truthy Promise.
- **R3/R4**: canonical bounded readers were trusted by NAME (`/^readBounded/`,
  `/^scoped…Json$/`, or a bare matching identifier), so any local or
  non-canonical function with a matching name bypassed the gate.
- **R5–R8 + extras**: the taint engine did not track assignment aliases, array
  containers, or destructure-assignment, did not treat "request passed to an
  arbitrary helper" as a failure, and silently returned CLEAN at its depth-4
  limit / on unresolved (namespace) flow.

Post-edit results, all fail-closed, are recorded in
[post-edit-results.md](post-edit-results.md).
