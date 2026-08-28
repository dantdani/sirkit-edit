# B16.0.18 §C — Trusted scope & actor proof (CONFIRMED)

`scope = componentSelectionScopeFromContext(context)` = `flatScopeOf(context)`
— tenant/project/branch/actorId/actorKind/role/sessionId ALL server-derived.

| Requirement | Evidence |
|---|---|
| problem/state project+branch must match trusted context | problem: 7-way projectId + tenant/branch check → 403 `component selection problem scope mismatch`; solve/export/transaction/propose: `projectId/branchId !== scope` → 422 (pinned for transaction/export/propose) |
| actor provenance only from trusted context | transaction actor CAPTURED = `{actorId:"u1", actorKind:"human", sessionId:<derived>, role:"pcb_editor"}`; attacker body actor/role/session ignored (pinned). solve + problem build `actor: { …scope… }` identically (source-identical construction) |
| attacker identity/role/session fields ignored | the pinned transaction case posts a full attacker actor object — the created transaction carries only the trusted one |
| foreign content fails before results | transaction → 422 before `createComponentSelectionTransaction` (zero calls pinned); propose → 422 before the provider (zero calls pinned); export → 422 before candidate lookup |
