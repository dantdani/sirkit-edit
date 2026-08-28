# B16.0.18 §H — Callback & import confinement (CONFIRMED)

Gates strip comments AND string literals before matching.

| Gate | Status |
|---|---|
| all 10 methods classify `canonical-wrapper` (analyzer provenance) | CONFIRMED |
| every route uses `authenticatedJsonRoute`; none imports/calls `scopedJson` | CONFIRMED |
| no direct `authorizeRequest` / bounded reader / `scopedTrustedJson` | CONFIRMED |
| no `: Request` param, `new URL(`, `request.*` body APIs, `.headers.get(`, `x-forwarded-host`, `.cookies/.origin/.host` | CONFIRMED |
| no `.json()/.text()/.formData()/.arrayBuffer()/.blob()` | CONFIRMED |
| no `fetch(` / URL scheme / distributor identifier introduced | CONFIRMED |
| scope projector Request-free; every scope-consuming route uses it | CONFIRMED |
| reverting any route to a raw handler fails CI | CONFIRMED — ratchet `TRANCHE_11` + the analyzer classification gate |
| fake wrapper/alias laundering fails | CONFIRMED — canonical-module + `APPROVED_ROUTE_WRAPPERS` provenance |

## `_scope.ts` — extended, not weakened

`scopedJson`, `object`, the scope interface, and the max-bytes constant
UNCHANGED and retained. Added: `COMPONENT_SELECTION_API_DEADLINE_MS = 30_000`
and `componentSelectionScopeFromContext(context)` (delegates to `flatScopeOf`).
