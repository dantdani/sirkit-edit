# B16.0.22 §E — pcb-sync GET proof (Request-free board-load core)

- **Without `boardId`**: the callback returns the static feature-gated
  capability document (authority `durable_owner_repository_feature_gated`,
  `arbitraryKicadPcb:false`, `routedStructuralChanges:false`,
  `authoritativeBoardLoad:true`, state header) with the board repository
  UNTOUCHED (spy pin). **CONFIRMED**.
- **With `boardId`**: dispatch through the bounded first-value-wins query
  projection into `createPcbSyncBoardGetCore` — a NEW Request-free core in
  `app/api/pcb-sync/handler.ts` that receives `(trustedScope, query)` and
  performs the identical validation + durable read:
  - unknown query key → 422 `PS_API_UNKNOWN_FIELD` (preserved),
  - malformed ids → 422 `PS_BOARD_ID_INVALID` / `PS_BOARD_REVISION_INVALID`
    / `PS_BOARD_DIGEST_INVALID`,
  - unknown board → **404 with `ok:true` result `status:"not_found"`** and
    the TRUSTED scope echoed (spy pin: `getBoard` called once with
    `{tenantId, projectId, branchId, boardId}` from the trusted context),
  - digest-rebuild mismatch → `PS_BOARD_RECORD_DIGEST_MISMATCH` (409 mapper),
    conditional `not_modified`, and `found` paths — logic UNCHANGED
    (moved verbatim; covered by the standing factory suite).
- **Legacy adapter retained**: `createPcbSyncBoardGetHandler` (the standing
  `route.test.ts` seam) now authorizes via `pcbSyncScope`, keeps the
  HISTORICAL duplicated-key refusal, projects the query, and delegates to the
  core — one logic body, two boundaries. Gated: the canonical route must use
  the core and NOT the legacy adapter.
- **Duplicated-key supersession** at the canonical route:
  [query-projection-deltas.md](query-projection-deltas.md) #1.
- POST remains the `createPcbSyncPostHandler` factory (NOT in this tranche);
  passive-policy POST likewise (`createPassivePolicyPostHandler`).
  **CONFIRMED** untouched.
