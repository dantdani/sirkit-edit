# B16.0.16 §F — Transaction semantics (CONFIRMED)

`/transaction` migrated to the wrapper; the in-memory deterministic transaction
semantics are unchanged.

| Requirement | Status | Evidence |
|---|---|---|
| required state, operations, reason, idempotencyKey, baseStateDigest | CONFIRMED | empty body → 400 exact message (pinned) |
| state validation | UNCHANGED | `validateCalculationProjectState(state)` gate unchanged |
| project/branch scope binding | CONFIRMED | `state.projectId/branchId !== scope` → 422 before any transaction (pinned) |
| transaction actor from trusted context ONLY | CONFIRMED | captured actor = `{actorId:"u1", actorKind:"human", sessionId:<derived>, role:"pcb_editor"}`; body actor/role/session ignored (pinned) |
| accepted/conflict/refused status mapping | UNCHANGED | `result.record.state` → 200 / 409 / 403 |
| idempotency + base-digest conflict semantics | UNCHANGED | `applyCalculationTransaction` internals untouched (domain suite green) |
| no new durable persistence | CONFIRMED | the route remains the in-memory `createCalculationTransaction` + `applyCalculationTransaction` deterministic pair; no store was introduced |
| operations confined to the `CalculationOperation` union | UNCHANGED | typed `body.operations as CalculationOperation[]`; validated inside the domain functions |

The transaction actor is now `{ actorId: scope.actorId, actorKind: scope.actorKind,
sessionId: scope.sessionId, role: scope.role }` where `scope =
calculationScopeFromContext(context)` — identical to the pre-migration
`flatScopeOf`-derived actor, now sourced from the wrapper's trusted context.
