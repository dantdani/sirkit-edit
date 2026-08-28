# B16.0.17 §C — Trusted scope & actor proof (CONFIRMED)

`scope = schematicCompilerScopeFromContext(context)` = `flatScopeOf(context)` —
tenant/project/branch/actorId/actorKind/role/sessionId are ALL server-derived.
Body fields with those names are untrusted data.

| Requirement | Evidence |
|---|---|
| graph.projectId === trusted projectId | graph/validate foreign → 403 `graph scope mismatch` (pinned); diff/layout/variants/propose/compare all check `projectId !== scope.projectId` → 422 |
| project-state branchId === trusted branchId | export/transaction check `state.branchId !== scope.branchId`; problem checks `input.branchId` |
| caller actor/role cannot enter provenance or transactions | transaction actor CAPTURED = `{actorId:"u1", actorKind:"human", sessionId:<derived>, role:"pcb_editor"}`; attacker body actor/role/session ignored (pinned) |
| transaction tenant/project/branch from trusted context | captured args: `tenantId:"local", projectId:"proj-1", branchId:"main"` (pinned) |
| problem compiler actor from trusted context | `actor: { …scope… }` passed to `compileSchematicCompilationProblem` (source construction, unchanged) |
| foreign content fails before any result | problem → 403 before compile; transaction → 422 before `createSchematicTransaction` (pinned zero calls); propose → 422 before the provider (pinned zero calls) |
