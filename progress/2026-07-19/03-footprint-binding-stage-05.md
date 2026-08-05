# Footprint Binding Stage 5 — Project Passive-Package Policy

## What changed

- Added versioned passive facts, explicit package profiles, policy/rule/exclusion/exception contracts, deterministic results, manufacturing gaps, trace, lifecycle/audit/invalidation, and canonical digests.
- Added a bounded SI value parser and explicit metric/imperial chip identity parser; bare `0603` is rejected.
- Added conservative deterministic evaluation for ordinary nonpolar resistor/MLCC profiles with mandatory specialized/safety exclusions.
- Added draft/validate/submit/approve/publish/revoke/successor service, complete read-only preview, scope locks, optimistic revisions, and idempotency.
- Added default-off rank-6 Stage 2 adapter; Stage 1 selection wins and policy results remain manufacturing-not-ready.
- Added precise Stage 3 plan invalidation without board mutation.
- Added scoped API, read-only UI component, pseudonymous metrics, rollout gate, tests, evidence, documentation, and Stage 6 contract.

## Why

Legacy refdes/value/package-token defaults could silently turn generic passives into ambiguous 0603 footprints. Stage 5 replaces that concept only in a qualification path with explicit facts, approved profiles, current Stage 4 mappings, deterministic conflicts, human policy lifecycle, and permanent manufacturing gaps.

## Safety/deployment state

`SIRKIT_PASSIVE_POLICY_STAGE5` defaults to `off`; the UI is not mounted and default Stage 2 policy `1.0.0` remains unchanged. Strict verdict is `BLOCKED` because Stages 1–4 and the new policy/invalidation service do not yet share a durable crash-safe transaction/restart-qualified PostgreSQL path. Original `C:\Users\robsa\sirkit` was not modified.

## Evidence

- Focused Stage 5 corpus covers identity/value semantics, ordinary/excluded components, modes, conflicts, mapping freshness, lifecycle/concurrency/idempotency, preview, Stage 2 precedence, Stage 3 invalidation, API security, UI truth, determinism, rollout, and 1,000-component performance.
- `artifacts/footprint-binding-stage-05/qualification-evidence.json` records p95 evaluation and full-preview measurements.
- Full final command results are in `SIRKIT_FOOTPRINT_BINDING_STAGE_05_IMPLEMENTATION.md`.
