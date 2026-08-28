# B16.0.10 §C — Trusted scope & actor proof

## What these routes use (historical, preserved exactly)

The 8 schematic AI routes are PROMPT-BASED surfaces: their business logic never
consumed project scope or actor identity from the request body, and never
derived scope from caller input. There are no body `projectId`/`branchId`
fields, no body actor/role/tenant fields, and no scope-selecting reads.

- **Authority**: the wrapper's `authorizeRequest` establishes the trusted
  context (project membership, role, CSRF) BEFORE anything else; the callback
  receives `context` (unused by these routes — they take only `body`), and the
  policy still binds each call to the authenticated project selector.
- **No caller-supplied identity**: the callback input is
  `{ context, body, bytes, meta }` — a body cannot smuggle actor/role/
  membership/tenant fields into authority because nothing reads them; the
  wrapper never lets body fields reach the trusted context.
- **No mutation authority from model output**: these routes PROPOSE
  (netlists, edit-op lists, findings, critiques); the client-side apply paths
  and the sealed-proposal machinery (B12–B15) remain the only mutation
  authority. `/api/schematic/edit` drops ops targeting unknown components;
  `/api/schematic/layout-critic` applies a re-layout only when the
  deterministic validator reproduces connectivity; `/api/schematic/review`
  drops findings contradicted by the ground-truth floating list — all pinned.

## AI-artifact lineage

None of the 8 routes records an actor identity in its output (unlike the
design-family propose routes, which record an AI actor via their proposal
compilers). No lineage behavior existed here, and none was added or removed.

## Proof

- The 57-pin suite passes identically pre/post (no scope behavior changed).
- Callback isolation is structural: `AuthenticatedJsonInput` carries no
  Request/Headers; the §D wrapper-integrity test (B16.0.5) and the adoption
  classifier both stay green.
