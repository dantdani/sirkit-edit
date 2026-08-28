# B16.0.22 §C — assignment-queue authority proof

All pins pre = post (except the ONE documented supersession in
[query-projection-deltas.md](query-projection-deltas.md)).

- **Feature gate fail-closed**: default state `off` → 503
  `AQ_STAGE6_DISABLED` (GET no-store; POST identical) before any durable
  work. **CONFIRMED**.
- **Commit is doubly gated**: `state === "opt_in"` AND the exact header
  `x-sirkit-assignment-commit: apply_exact_plan` — header-without-state and
  state-without-header both → 403 `AQ_COMMIT_OPT_IN_REQUIRED` with the
  `commit` service spy UNCALLED. Post-migration the header travels ONLY
  through the declared `safeHeaders` projection (`meta.headers`), which the
  forbidden-safe-header pattern verified is legal (`…assignment-commit`
  matches no credential token). **CONFIRMED**.
- **Forbidden authoritative keys**: `sourceBundle, binding, mappingRecord,
  policyRecord, board, path, url` → 400 `AUTH_AUTHORITATIVE_INPUT_FORBIDDEN`
  with the EXACT generic historical message (no key suffix) — preserved via
  `assignmentForbiddenAuthorityRefusal` in-callback, running BEFORE
  feature-state work (source-order gate). **CONFIRMED**.
- **Scope forcing**: preview/commit requests are rebuilt with the TRUSTED
  tenant/project/branch/actorContext and `mode` derived from the operation —
  browser-supplied identity fields and `mode:"commit"` smuggling are
  overwritten (spy-argument pin). **CONFIRMED**.
- **Query surface**: itemId/variant/history/lifecycle/category/risk/assignee/
  q/cursor/limit all single-valued via first-value-wins projection (identical
  to the historical `searchParams.get`); `limit` clamp `Math.min(200,
  Math.max(1, …))` pinned at 999→200. Unknown item → 200 `item:null`
  (recorded contract). **CONFIRMED**.
- **Materialize/revalidate worker routes**: separate policy rows, NOT part of
  this tranche, untouched. **CONFIRMED**.
