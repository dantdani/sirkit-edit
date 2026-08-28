# B16.0.16 §F — Feedback semantics (CONFIRMED)

`/feedback` migrated to the wrapper (`{ body }` callback). Behavior unchanged.

| Requirement | Status | Evidence |
|---|---|---|
| `createCalculationFeedback` behavior | UNCHANGED | the callback calls `createCalculationFeedback(body as never)` verbatim (domain suite green) |
| exact consequence string | CONFIRMED | success → `{ ok:true, feedback, consequence: "invalidate_only_the_pinned_dependency_successors_and_recompile" }` with `no-store` |
| failure status + response shape | CONFIRMED | invalid input → 422 `{ ok:false, error }` (pinned via empty-body 422) |
| feedback is not a mutation or approval | CONFIRMED | the route returns a feedback descriptor + the invalidation consequence only; it performs no state write, no approval, and touches no durable store |

The migration changed only the boundary prologue; the feedback computation and
its response shape are byte-identical.
