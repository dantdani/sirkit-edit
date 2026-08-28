# B16.0.17 §H — Callback & import confinement (CONFIRMED)

The gate suite strips comments AND string literals before matching — prose and
strings can neither satisfy nor defeat a gate.

| Gate | Status |
|---|---|
| all 10 methods classify `canonical-wrapper` (analyzer provenance) | CONFIRMED |
| every route uses `authenticatedJsonRoute`; none imports/calls `scopedJson` | CONFIRMED |
| no direct `authorizeRequest` / bounded reader / `scopedTrustedJson` | CONFIRMED |
| no `: Request` param, `new URL(`, `request.*` body APIs, `.headers.get(`, `x-forwarded-host`, `.cookies/.origin/.host` | CONFIRMED |
| no `.json()/.text()/.formData()/.arrayBuffer()/.blob()` | CONFIRMED |
| the scope projector is Request-free (`schematicCompilerScopeFromContext(context: …)`) | CONFIRMED |
| every scope-consuming route builds its scope from the projector | CONFIRMED |
| reverting any route to a raw handler fails CI | CONFIRMED — ratchet `TRANCHE_10` + analyzer classification gate |
| fake/alias wrapper laundering fails | CONFIRMED — classifier requires the canonical module + `APPROVED_ROUTE_WRAPPERS` |

## `_scope.ts` — extended, not weakened

`scopedJson`, `object`, `SchematicCompilerApiScope`,
`SCHEMATIC_COMPILER_API_MAX_BYTES` UNCHANGED and retained. Added:
`SCHEMATIC_COMPILER_API_DEADLINE_MS = 30_000` and
`schematicCompilerScopeFromContext(context)` (delegates to `flatScopeOf`).
