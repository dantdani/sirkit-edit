# B16.0.12 §C/§D — Query & parameter confinement

## Callback inputs (all 12 methods)

| Group | Receives | Never receives |
|---|---|---|
| `publicRoute` no-body (ai/runtime) | `{ meta }` | Request, Headers, cookies, Authorization, raw URL/URLSearchParams, streams, identity |
| `publicRoute({ query: true })` (atomic catalog, resolve, search) | `{ meta }` with the **bounded frozen** `meta.query` | raw URL objects (`new URL(req.url)` gone from all migrated files) |
| `publicRoute({ routeParams: ["id"] })` (parts detail, footprint detail) | `{ params }` — bounded declared plain record | the Next context object |
| `publicRoute({ routeParams, query })` (alternates) | both projections | — |
| `publicJsonRoute` ×4 | `{ body, bytes, meta }` | raw streams |
| `kicadLibraryRoute({ routeParams })` | `{ params, meta }` | the Authorization header, the Request |

## Canonical bounds (wrapper-authoritative)

- ≤ 64 projected query keys; ≤ 2,048 chars per projected value; first value
  wins for duplicates; the projection is frozen.
- Declared route params only; ≤ 512 chars; missing / array-valued / oversized
  declared params fail closed (400 `AUTH_ROUTE_PARAM_INVALID`) before the
  callback.

## Historical behavior inside the bounds — preserved and pinned

- atomic catalog `limit` (clamp 1..100, default 50) and `after` cursor;
- alternates `kind` (`drop_in`/`fff`/default both) and `limit` (clamp 1..50,
  default 10);
- footprint resolve `hint` (`Lib:Name` shape check);
- footprint search `q` (required, ≤ 500 chars), `limit` (1..100, default 20),
  `padCount` (non-negative integer), `smd` (`true`/`false`);
- KiCad category id `.json` suffix stripping.

## Beyond-bounds behavior (reproduced, documented)

Pre-migration, a raw handler would happily read a query value of ANY length
(e.g. a multi-megabyte `q` was cut only by the route's own 500-char check where
one existed; `after`/`hint`/`kind` had no length cap at all) and any number of
query keys. Post-migration the wrapper truncates every projected value at 2,048
chars and caps keys at 64 BEFORE the callback, so an unbounded query can no
longer propagate into database or embedding calls. All in-bounds pinned
behavior is unchanged (route-level checks like the 500-char `q` limit still
fire first within the projection). Duplicate-key first-wins matches
`URLSearchParams.get` semantics, so no observable change for the pinned
parameters.

## Structural gates

The adoption classifier + ratchet TRANCHE_5 pins prove the exact 12 methods
are canonical and revert-proof; the migrated sources contain no
`new URL(req…)` / `searchParams` / `ctx.params` access (boundary analyzer +
flow gates stay green over the whole tree).
