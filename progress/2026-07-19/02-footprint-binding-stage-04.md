# Footprint binding Stage 4 — pin-pad mapping verification

Implemented in the protected copy only. Added a provider-independent, deterministic three-layer verifier for logical symbol pins, manufacturer package terminals and exact footprint pads. It models hidden/multi-unit pins, equivalence/permutation, repeated/common pads, NC/DNC, shield, mechanical and exposed thermal intent; reports full coverage/findings/conflicts/ambiguities; and never approves itself or mutates schematic/PCB state.

Added immutable unreviewed/publish/approve/reject/revoke/stale lifecycle adapters with optimistic concurrency, locks, idempotency, audit, Stage 1 mapping projection and Stage 3 plan invalidation. Added a default-off API, pseudonymous telemetry, read-only UI panel, representative electrical corpus, security/property/performance tests and machine-readable evidence.

Safety corrections made during qualification: numeric/name/order mappings now produce explicit ambiguity; AI/API/vendor/legacy graphs cannot earn a tier; conflicting evidence becomes a first-class conflict; required electrical identities cannot be waived through `explicitUnmapped`; inspection redacts confidential evidence locators.

Strict status remains `BLOCKED`. The checked-in route is qualification-only/in-memory. Sirkit still lacks one durable transaction spanning mapping publication, Stage 1 reference, audit/idempotency and Stage 3 invalidation, plus live PostgreSQL apply/rollback/restart proof. Rollout remains `off`; no legacy production path or original `C:\Users\robsa\sirkit` content was changed.
