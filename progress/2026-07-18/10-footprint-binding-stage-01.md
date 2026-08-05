# Footprint Binding Stage 01 — Authoritative Data Model and Readiness

## Changed

- Added one versioned project physical-binding aggregate with stable component/variant scope.
- Kept exact parts, supplier SKUs, packages, footprint assets/digests and pin-pad mappings as separate concepts.
- Added independent lifecycle, applicability, approval, technical, freshness and conflict axes.
- Added immutable successor transitions, role authorization, audit events, idempotency and optimistic concurrency.
- Added deterministic canonical SHA-256 digests and digest-scoped approval/validation.
- Added complete deterministic layout/manufacturing readiness gates.
- Added transactional PostgreSQL tables/repository and additive migration `0022`.
- Added non-destructive legacy migration, redacted compatibility view and disabled-by-default shadow comparison.
- Added scoped API, telemetry, Stage 2 handoff and executable qualification/security/performance tests.

## Why

Footprint hints, package strings, catalog identity, approved atomic bundles and live PCB-sync heuristics previously existed at several boundaries. They could describe useful facts but did not provide one project-level record capable of representing alternatives, uncertainty, approval, freshness and readiness without guessing. Stage 1 creates that truth layer while preserving current sync behavior.

## Safety boundary

The legacy assigner, netlist bridge, PCB geometry, routing, placement, copper, DRC, manufacturing exporters and AI editor guard were not changed. Generic `J1`, `100n` and migrated footprint strings remain unresolved/unapproved until later stages supply and authorize physical facts.

## Verification

- TypeScript strict type check.
- Focused Stage 1 Vitest corpus including actual `syncFromSchematic` shadow equivalence.
- Additive SQL migration inspection.
- Broader lint/build/regression results are recorded in the task completion evidence.
