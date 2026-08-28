# B16.0.20 §B/§C — Trusted scope & actor proof (CONFIRMED)

`modelSimulationScopeFromContext(context)` = `flatScopeOf(context)` — all
seven fields server-derived. Callbacks receive `{ context, body }` (or
`{ body }`) only.

| Requirement | Evidence |
|---|---|
| problem/denominator/readiness scope binding | foreign → 403 exact messages (pinned) |
| problem actor forced human with trusted identity | captured `{ actorId: "u1", actorKind: "human", sessionId, role }` (pinned) |
| propose `proposedBy` trusted-only | attacker body `proposedBy` IGNORED (pinned) |
| execute actor gate | non-human refused (post-§C-correction; the corrected condition + policy verified together) |
| attacker identity/role/session ignored | no body identity field is read anywhere in the six routes |
