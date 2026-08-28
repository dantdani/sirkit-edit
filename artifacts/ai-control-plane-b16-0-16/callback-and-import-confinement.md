# B16.0.16 §H — Callback & import confinement (AST-backed, CONFIRMED)

The gate suite strips comments AND all string literals before matching, so
neither prose nor a string can satisfy or defeat a gate.

| Gate | Status |
|---|---|
| all 8 methods classify `canonical-wrapper` (analyzer provenance) | CONFIRMED |
| every route uses `authenticatedJsonRoute` from `@/app/lib/auth/route-handlers` | CONFIRMED |
| no route imports or calls `scopedJson` | CONFIRMED |
| no direct `authorizeRequest` | CONFIRMED |
| no direct bounded-body reader (`readBoundedJsonObject/Body`, `scopedTrustedJson`) | CONFIRMED |
| no `: Request` param, `new URL(`, `request.headers/url/json/text/formData/arrayBuffer/blob/body/signal`, `.headers.get(`, `x-forwarded-host`, `.cookies/.origin/.host` | CONFIRMED |
| no `.json()/.text()/.formData()/.arrayBuffer()/.blob()` | CONFIRMED |
| `_scope.ts` projector is Request-free (`calculationScopeFromContext(context: …)`, no `new URL(`) | CONFIRMED |
| every scope-consuming route builds scope from `calculationScopeFromContext(context)` | CONFIRMED |
| reverting any route to a raw handler fails CI | CONFIRMED — ratchet `TRANCHE_9` revert pins + the analyzer classification gate |
| a fake/aliased wrapper fails the analyzer provenance check | CONFIRMED — the classifier requires the canonical module + `APPROVED_ROUTE_WRAPPERS` |

## `_scope.ts` — extended, not weakened

`scopedJson`, `object`, `CalculationApiScope`, and `CALCULATION_API_MAX_BYTES`
are UNCHANGED. Added: `CALCULATION_API_DEADLINE_MS = 30_000` and
`calculationScopeFromContext(context)` (delegates to the shared `flatScopeOf`).
`scopedJson` is retained for any other consumer.
