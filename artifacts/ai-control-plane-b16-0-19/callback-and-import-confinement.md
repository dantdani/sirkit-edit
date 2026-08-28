# B16.0.19 §H — Callback & import confinement (CONFIRMED)

Gates strip comments AND string literals before matching.

| Gate | Status |
|---|---|
| all 9 routes classify `canonical-wrapper` (analyzer provenance) | CONFIRMED |
| every route uses `authenticatedJsonRoute`; none imports/calls `scopedJson` | CONFIRMED |
| no direct `authorizeRequest` / bounded reader / `scopedTrustedJson` | CONFIRMED |
| no `: Request`, `new URL(`, `request.*` APIs, `.headers.get(`, cookies/origin/host | CONFIRMED |
| no `.json()/.text()/...` body API; no `fetch(` | CONFIRMED |
| both scope projectors Request-free; used by every scope-consuming route | CONFIRMED |
| reverting any route to raw fails CI | CONFIRMED — TRANCHE_12 revert pins + analyzer gate |
| fake wrapper/alias laundering fails | CONFIRMED — canonical provenance check |

## Both `_scope.ts` files — extended, not weakened

`scopedJson`, `object`, both scope interfaces and max-bytes constants UNCHANGED
and retained. Added per family: the deadline constant (30_000) and the
Request-free projector.
