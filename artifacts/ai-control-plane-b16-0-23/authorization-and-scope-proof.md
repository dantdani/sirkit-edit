# B16.0.23 — authorization & trusted-scope proof

Evidence: `b16-0-23-tranche-parity` (44/44 pre AND post) + the standing
`b16-0-2-spice-scope-isolation` route suite (unchanged, green through the
migrated wrappers) + pinned policy rows.

- **Public vs protected proven from behavior**: the trio serves anonymous
  callers (pinned 400-not-401) and its call graph is pure compute (gate:
  no store/worker/fs/process/network imports). Every run/model/AI method
  requires authentication with the exact role sets in
  [wrapper-and-policy-matrix.csv](wrapper-and-policy-matrix.csv). **CONFIRMED**.
- **Trusted scope is the only run authority**: `startRunPlan` receives
  `spiceRunScopeFromContext(context)` — the body's `project.id` remains a
  display-only client assertion (standing pin). Foreign scope on every
  reader/cancel surface → the uniform byte-exact
  `{ ok:false, code:"SPICE_RUN_NOT_FOUND", error:"Run not found" }` 404 — no
  existence oracle. **CONFIRMED**.
- **Header-less selector surfaces preserved**: the NEW wrapper option
  `querySelector: true` derives the per-request `?tenantId&projectId&branchId`
  selector INSIDE the wrapper (exact port of the historical `_scope.ts`
  parsing: projectId required, trimmed, empty→undefined) and hands it to
  `authorizeRequest` — a selector is never authority; membership is loaded
  server-side for exactly that scope. Pinned: selector-only list 200; FOREIGN
  selector 403 with zero listeners; repo-wide gate proves only the five
  run-family GET readers declare the option. **CONFIRMED**.
- **Run ids are bounded route params**: `routeParams: ["id"]` — the callback
  receives only the resolved, length-capped parameter (the wrapper's
  `AUTH_ROUTE_PARAM_INVALID` refusal now also bounds absurd ids — canonical
  hardening, recorded). **CONFIRMED**.
- **No identity-header reads introduced**: the migrated files carry no
  `x-sirkit-role`/`x-sirkit-actor-*` reads (standing LEGACY_HEADER pin stays
  green). **CONFIRMED**.
