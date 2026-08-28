# B16.0.20 §G — Proposal-only proof (CONFIRMED)

`/propose` is DETERMINISTIC — it calls no LLM and was not converted into a
provider-backed route (statically gated: no `llmRouter` import).

| Rule | Evidence |
|---|---|
| allowed kinds exactly `model_binding, testbench, measurement, assertion, scenario, diagnostic` | the route's kind set unchanged; unknown kind → 400 (pinned) |
| typed actions / target refs / assumptions / warnings | filtered typed pass-through into `createSimulationChangeProposal` (unchanged) |
| `proposedBy` from trusted context ONLY | pinned: an attacker `proposedBy` body field is IGNORED; the proposal carries `{ actorId: "u1", actorKind: "human", sessionId, role }` from scope |
| `requiresHumanReview: true` | pinned + gate-asserted literal |
| no execution / registry mutation / schematic-PCB mutation | the route constructs a proposal object only; no store, runner, or mutation surface exists (statically gated) |
| no provider call | statically gated |
