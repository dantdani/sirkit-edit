# B16.0.19 §C — Trusted scope & actor proof (CONFIRMED)

Both projectors delegate to `flatScopeOf(context)` — all seven scope fields
server-derived.

| Requirement | Evidence |
|---|---|
| ck/problem tenant/branch + 4× projectId binding | foreign body → 403 (pinned); actor built from `{ …scope… }` into `compileCircuitKnowledgeProblem` |
| ck/propose scope binding | foreign → 403 `circuit proposal scope mismatch` before source validation and the provider (pinned, provider ZERO) |
| ck/propose extraction actor | constructed as `{ actorId: scope.actorId, actorKind: "ai", sessionId: scope.sessionId, role: "automation" }` — trusted identity, honestly labeled as AI extraction; caller fields cannot enter provenance (the callback receives only `{ context, body }`) |
| cv/problem scope + actor | `schematicProject.projectId/branchId` vs scope → 403; actor from trusted scope into `compileCircuitVerificationProblem` |
| cv/run integrity + scope + pins | combined 422 gate: validators + projectId/branchId + `semanticGraphDigest`/`ruleRegistryDigest` binding (pinned) |
| cv/readiness scope | foreign → 403 `readiness scope mismatch` (pinned) |
| cv/propose scope + run binding | foreign/stale/tampered/non-full → 422 before the provider (pinned, provider ZERO); `proposedBy` actor from trusted scope |
| attacker identity/role/session ignored | callbacks receive only `{ context, body }`; no body identity field is read anywhere in the nine routes |
