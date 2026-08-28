# B16.0.7 — Post-edit results (R1–R11 fail closed)

Same probe, re-run against the corrected analyzer. All R1–R11 now fail closed;
the 121 protected methods still pass and the §C flow gate still reports 0
offenders across production routes.

| ID | PRE-EDIT | POST-EDIT |
|---|---|---|
| R1 work between auth and refusal | accepted | **REJECT** — "work runs between authorization and its refusal: a durable/provider call (getDb.select) precedes the authorization boundary" |
| R2 work inside the refusal branch | accepted | **REJECT** — "protected work inside the refusal branch: …" |
| R3 body read inside the refusal branch | flagged | **flagged** (`request body consumed via .json()`) |
| R4 unawaited async boolean binding | accepted | **REJECT** — "async boolean boundary asyncBool bound WITHOUT await — the Promise is truthy and never refuses" |
| R5 `consume({ request })` | `[]` | **REJECT** — "Request used in a disallowed position (aggregate/container/store/escape)" |
| R6 `const box = { request }; consume(box)` | `[]` | **REJECT** — disallowed position |
| R7 `new Response(request.body).text()` | `[]` | **REJECT** — "request body stream passed to a non-canonical consumer" |
| R8 `for await (const chunk of request.body)` | `[]` | **REJECT** — "request/body iterated (for-of/for-await)" |
| R9 `return { request }` | `[]` | **REJECT** — non-canonical consumer + disallowed position |
| R10 `store.request = request` | `[]` | **REJECT** — "Request stored to a property (store.request)" |
| R11 `box.request = request; box.request.json()` | `[]` | **REJECT** — stored to a property + disallowed position |
| array push / Map set / callback closure | partial/miss | **REJECT** — unresolved consumer / body consumed |

## How each was closed (analyzer / flow gate)

- **R1/R2**: `analyzeHandlerBody` now, after finding an awaited guard binding,
  locates the refusal statement and rejects if (a) any forbidden
  durable/provider/body/mutation call runs BETWEEN the binding and the refusal,
  or (b) the refusal branch contains any such work. The inline-boundary path gets
  the same branch check.
- **R4**: an async boolean boundary binding must be awaited; a bare
  `const allowed = asyncBool(req)` (no `await`) is rejected.
- **R5–R11**: `requestFlowViolations` gained (i) a value-reference context check —
  a tainted-request identifier is permitted ONLY as a metadata property object, a
  call/new argument, or a simple identifier-alias RHS; any object/array literal
  element, aggregate return, or store is a violation; (ii) constructor-argument
  handling (`new Response(request.body)`); (iii) for-of / for-await over the
  request or its body stream; (iv) property-write detection (`x.y = request`).
  Property NAMES (`body.request`) are excluded so real metadata reads are not
  false-flagged (all 121 methods still pass).

## Honest scope note

These are the ANALYZER/gate closures (defense in depth). The mandate's PRIMARY
fix — mandatory canonical wrappers so ordinary routes cannot express handwritten
guards or raw Request at all — is the architecture in
[canonical-wrapper-architecture.md](canonical-wrapper-architecture.md); its
route migration is NOT complete (see [final-verdict.md](final-verdict.md) and
[migration-and-rollback.md](migration-and-rollback.md)).
