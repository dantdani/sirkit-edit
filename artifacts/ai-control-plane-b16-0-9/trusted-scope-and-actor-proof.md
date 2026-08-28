# B16.0.9 — Trusted scope & actor proof

## The rules (§C) and how each is preserved

1. **`context.projectId` / `context.branchId` are authoritative.** Every
   callback derives `projectId`/`branchId`/`tenantId` ONLY from the wrapper's
   `context` (the same `TrustedRequestContext` the handwritten guards used —
   the business code moved verbatim).
2. **Actor identity only from `context.actor`.** All compiles construct actors
   from `context.actor.actorId/actorKind/sessionId/role`. No body field feeds
   an actor.
3. **Body project/branch fields are cross-checks only.** Each route's scope
   check compares body-carried problem/candidate ids AGAINST the trusted
   context and refuses 403 on mismatch — pinned per route with the exact error
   strings ([pre-edit-route-contracts.md](pre-edit-route-contracts.md)). The
   body can never SELECT the scope.
4. **Body identity/role/tenant/actor can never override.** The parsed body is a
   plain object; no route reads an actor/role/tenant from it into any decision.
   The callback has no `Request`/`Headers`, so header-smuggled identity is
   structurally impossible past `authorizeRequest`.
5. **Scope mismatch fails BEFORE provider/domain execution.** The 403 scope
   refusals show `generate` 0-call (propose routes) and precede all compiler
   invocations (the refusal returns first — pinned).
6. **AI lineage preserved exactly.** The three `propose` routes still record
   the compiled artifact with `actorKind: "ai"` (the deliberate AI-produced
   lineage), while `candidates`/`problem`/`compare`/etc. keep the human
   `context.actor.actorKind`. The `alternatives` routes keep their historical
   `automated_engine` synthesis actors with fixed session ids
   (`architecture-alternatives`, `power-alternatives`,
   `interface-alternatives`, `pin-allocation`). None of these were altered.

## Structural guarantee

Callback inputs are exactly `{ context, body, bytes, meta }` (no opt-ins were
declared for these 17 — none needed `params`, `query`, headers, or the signal).
The B16.0.5 §D wrapper-integrity test pins that set and its
no-Request/no-Headers property; the B16.0.8 capability suite pins that secret
headers are structurally unavailable.
