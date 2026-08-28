# B16.0.16 §C — Trusted scope & actor proof

Every route derives `scope = calculationScopeFromContext(context)` =
`flatScopeOf(context)` = `{ tenantId, projectId, branchId, actorId, actorKind,
role, sessionId }` — ALL server-derived. Body fields with those names are
untrusted data and never become authority.

| Requirement (§C) | Status | Evidence |
|---|---|---|
| problem `requirementsPackage.projectId` vs trusted projectId | CONFIRMED | foreign body → 403 `calculation problem scope mismatch` (pinned) |
| problem `componentSelectionState.projectId` vs trusted projectId | CONFIRMED | same check `input.componentSelectionState.projectId !== scope.projectId` |
| problem/state/graph `branchId` vs trusted branchId | CONFIRMED | problem/report/transaction/propose all compare `branchId !== scope.branchId` |
| transaction actor from trusted context only | CONFIRMED | pin captures `createCalculationTransaction` actor = `{actorId:"u1", actorKind:"human", sessionId:<derived>, role:"pcb_editor"}`; body `actor`/`actorId`/`role`/`sessionId` = attacker values are IGNORED |
| report actor from trusted context only | CONFIRMED (by construction) | callback builds `actor: { actorId: scope.actorId, actorKind: scope.actorKind, sessionId: scope.sessionId, role: scope.role }` (source gate) — scope is the context projection |
| problem compiler actor from trusted context only | CONFIRMED (by construction) | same `actor: { …scope… }` shape passed to `compileCircuitCalculationProblem` |

## Fail-before-result

Foreign project/branch content fails BEFORE any calculation result, report, or
transaction:

- problem scope mismatch → 403 before `compileCircuitCalculationProblem`;
- propose scope mismatch → 422 before the provider call (pinned, provider zero);
- report/transaction/export scope mismatch → 422 before materialize/apply/handoff
  (pinned for transaction; identical pattern for report/export).
