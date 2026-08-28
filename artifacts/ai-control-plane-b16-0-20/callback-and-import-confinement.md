# B16.0.20 §I — Callback & import confinement (CONFIRMED)

Gates strip comments AND string literals.

| Gate | Status |
|---|---|
| all 6 methods classify `canonical-wrapper` (analyzer provenance) | CONFIRMED |
| every route uses `authenticatedJsonRoute`; none imports/calls `scopedJson` | CONFIRMED |
| no direct `authorizeRequest` / bounded reader / raw body API / URL-origin-host-cookie | CONFIRMED |
| no child_process / spawn / exec / Worker / docker / container / fetch / provider-router | CONFIRMED |
| `modelSimulationScopeFromContext` Request-free; used by every scope-consuming route | CONFIRMED |
| reverting any route to raw fails CI | CONFIRMED — TRANCHE_13 revert pins + analyzer gate |

## `_scope.ts` — extended, not weakened

`scopedJson`, `object`, the scope interface, and the max-bytes constant
UNCHANGED. Added: `MODEL_SIMULATION_API_DEADLINE_MS = 30_000` + the projector.
