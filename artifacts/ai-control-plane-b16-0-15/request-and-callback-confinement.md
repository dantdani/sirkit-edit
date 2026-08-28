# B16.0.15 §B/§I — Request & callback confinement (CONFIRMED)

## Callback inputs

Both callbacks receive `{ context, body }` (plus `bytes`, `meta` which they do
not use). Neither receives or retains Request, Headers, cookies, raw URL, host,
origin, or any client-provided identity/role authority.

## Trusted scope construction

- the repository/authority scope is built ONLY from `pcbSyncScopeFromContext(context)`
  (`context.tenantId/projectId/branchId/actor`) plus the validated
  `body.boardId`/`body.designId`;
- the manufacturing actor comes only from `context.actor` (qualify's
  `authority.actor = scope.actor.actorId`);
- no `x-sirkit-*` identity/role header is read (the shared `_scope` chokepoint
  already forbade that; the wrapper preserves it).

## Structural gates (negative tripwires — §I)

Comments stripped, both route sources are asserted to contain NONE of:

- `export async function POST` (raw handler),
- `scopedPcbSyncJson(` / `pcbSyncScope(` / `authorizeRequest(`,
- `readBoundedJsonObject(` / `readBoundedJsonBody(` / `scopedTrustedJson(`,
- `request.headers|url|json|text|body|signal`, `new URL(`, `.headers.get(`,

and to CONTAIN `authenticatedJsonRoute(` imported from
`@/app/lib/auth/route-handlers`, plus `pcbSyncScopeFromContext(context)`. A
fake/aliased wrapper fails the analyzer's provenance check (canonical module +
`APPROVED_ROUTE_WRAPPERS`). The ratchet's TRANCHE_8 pins fail CI if either
method leaves the canonical set.

## Shared helper preserved

`scopedPcbSyncJson` / `pcbSyncScope` remain in `pcb-sync/_scope.ts` — the
`/api/pcb-sync` route still depends on `scopedPcbSyncJson` (its suite passes
unchanged). Only the two manufacturing routes stopped using it; the new
Request-free companions (`pcbSyncScopeFromContext`,
`pcbSyncForbiddenAuthorityRefusal`, `PCB_SYNC_API_DEADLINE_MS`) were ADDED, not
substituted.
