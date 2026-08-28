# B16.0.11 §G — External-work zero-call evidence

All repository, distributor, pricing and cache dependencies are faked in the
pin suite: `buildBomRows` / `buildBom` (the distributor-pricing entry points),
`bomToCsv`, and the whole BOM repository via `setBomRepositoryFactory`. **No
live distributor call, no database write, no provider credit occurs in any
test.**

## Zero external calls proven for

| Refusal | Public ×6 | Authenticated body methods ×4 | Auth GETs ×2 |
|---|---|---|---|
| invalid media (415) | 0 business calls | 0 repo calls | — |
| malformed JSON (400) | 0 | 0 | — |
| oversized body (413) | 0 | 0 | — |
| stalled body / deadline | settled by the shared reader (standing B16.0.4 behavior suite) before any callback — no external work reachable | same | — |
| authentication refusal (401) | — | 0 repo calls, 0 pulls | 0 repo calls |
| CSRF refusal (403) | — | 0 repo calls, 0 pulls | — |
| forbidden ownership claims (400) | — | 0 repo calls | — |
| validation failure before external work (missing state / from-to / id) | 0 business calls | 0 repo calls (snapshot POST pinned explicitly) | — |

## Valid-path call counts and ordering (historical, preserved)

- `/api/bom`: `buildBomRows` ×1 → response passthrough;
- carts ×3: `buildBomRows` ×1 → real CSV formatter;
- export-csv: `buildBom` ×1 → `bomToCsv` ×1 (order pinned);
- procurement-packet: `buildBomRows` ×1 → real packet formatter;
- snapshot POST: `buildBomRows` ×1 → `createSnapshot` ×1 (trusted scope);
- diff owned→owned: `getSnapshot` ×2, no writes; diff to=current:
  `getSnapshot` ×1 + `buildBomRows` ×1, **no `createSnapshot`** (unpersisted);
- notifications: exactly one repository call per operation, scope-carried.
